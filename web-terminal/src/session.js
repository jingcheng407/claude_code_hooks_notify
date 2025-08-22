const crypto = require('crypto');

class SessionManager {
  constructor(redisClient = null) {
    this.redisClient = redisClient;
    this.defaultTTL = 3600; // 1 hour
    this.maxSessionsPerUser = 5;
    this.failedAttempts = 0;
    this.inMemorySessions = new Map(); // Fallback for when Redis is not available
  }

  async createSession(userId, metadata = {}) {
    try {
      // Validate input
      if (!userId || typeof userId !== 'string') {
        return {
          success: false,
          error: 'Invalid user ID'
        };
      }

      // Validate metadata
      if (!this.validateMetadata(metadata)) {
        return {
          success: false,
          error: 'Invalid metadata'
        };
      }

      // Check existing sessions count
      const userSessions = await this.getUserSessions(userId);
      if (userSessions.success && userSessions.sessions.length >= this.maxSessionsPerUser) {
        return {
          success: false,
          error: `User has reached maximum sessions limit (${this.maxSessionsPerUser})`
        };
      }

      // Generate session ID
      const sessionId = crypto.randomBytes(16).toString('hex');
      
      const sessionData = {
        userId,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        metadata: {
          userAgent: metadata.userAgent || '',
          ipAddress: metadata.ipAddress || '',
          ...metadata
        }
      };

      // Store session
      if (this.redisClient) {
        await this.redisClient.set(
          `session:${sessionId}`,
          JSON.stringify(sessionData),
          'EX',
          this.defaultTTL
        );
      } else {
        // Fallback to in-memory storage
        this.inMemorySessions.set(sessionId, {
          ...sessionData,
          expiresAt: new Date(Date.now() + this.defaultTTL * 1000)
        });
      }

      return {
        success: true,
        sessionId
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSession(sessionId) {
    try {
      if (!sessionId || !this.isValidSessionId(sessionId)) {
        return {
          success: false,
          error: 'Invalid session ID'
        };
      }

      let sessionData;

      if (this.redisClient) {
        const data = await this.redisClient.get(`session:${sessionId}`);
        if (!data) {
          return {
            success: false,
            error: 'Session not found'
          };
        }

        try {
          sessionData = JSON.parse(data);
        } catch (parseError) {
          return {
            success: false,
            error: 'Session data corrupted'
          };
        }

        // Refresh TTL
        await this.redisClient.expire(`session:${sessionId}`, this.defaultTTL);
      } else {
        // Use in-memory storage
        const session = this.inMemorySessions.get(sessionId);
        if (!session) {
          return {
            success: false,
            error: 'Session not found'
          };
        }

        // Check expiration
        if (new Date() > session.expiresAt) {
          this.inMemorySessions.delete(sessionId);
          return {
            success: false,
            error: 'Session expired'
          };
        }

        sessionData = session;
        // Update expiration
        session.expiresAt = new Date(Date.now() + this.defaultTTL * 1000);
      }

      return {
        success: true,
        session: sessionData
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async validateSession(sessionId, userId = null, metadata = null) {
    try {
      const result = await this.getSession(sessionId);
      
      if (!result.success) {
        this.failedAttempts++;
        return {
          valid: false,
          error: result.error === 'Session not found' ? 'Session expired or invalid' : result.error
        };
      }

      const session = result.session;

      // Check user ownership
      if (userId && session.userId !== userId) {
        return {
          valid: false,
          error: 'Session access denied'
        };
      }

      // Security validation: check for session hijacking
      if (metadata && this.detectSecurityViolation(session.metadata, metadata)) {
        return {
          valid: false,
          error: 'Session security violation detected'
        };
      }

      // Update last activity
      await this.updateActivity(sessionId);

      return {
        valid: true,
        userId: session.userId,
        session
      };

    } catch (error) {
      this.failedAttempts++;
      return {
        valid: false,
        error: error.message
      };
    }
  }

  async updateActivity(sessionId) {
    try {
      const result = await this.getSession(sessionId);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const sessionData = result.session;
      sessionData.lastActivity = new Date().toISOString();

      if (this.redisClient) {
        await this.redisClient.set(
          `session:${sessionId}`,
          JSON.stringify(sessionData),
          'EX',
          this.defaultTTL
        );
        await this.redisClient.expire(`session:${sessionId}`, this.defaultTTL);
      } else {
        const session = this.inMemorySessions.get(sessionId);
        if (session) {
          session.lastActivity = sessionData.lastActivity;
          session.expiresAt = new Date(Date.now() + this.defaultTTL * 1000);
        }
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async destroySession(sessionId) {
    try {
      if (this.redisClient) {
        const result = await this.redisClient.del(`session:${sessionId}`);
        if (result === 0) {
          return {
            success: false,
            error: 'Session not found'
          };
        }
      } else {
        if (!this.inMemorySessions.has(sessionId)) {
          return {
            success: false,
            error: 'Session not found'
          };
        }
        this.inMemorySessions.delete(sessionId);
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getUserSessions(userId) {
    try {
      const sessions = [];

      if (this.redisClient) {
        let cursor = '0';
        do {
          const result = await this.redisClient.scan(cursor, 'MATCH', 'session:*');
          cursor = result[0];
          const keys = result[1];

          for (const key of keys) {
            try {
              const data = await this.redisClient.get(key);
              if (data) {
                const sessionData = JSON.parse(data);
                if (sessionData.userId === userId) {
                  sessions.push({
                    sessionId: key.replace('session:', ''),
                    ...sessionData
                  });
                }
              }
            } catch (parseError) {
              // Skip corrupted sessions
            }
          }
        } while (cursor !== '0');
      } else {
        // Use in-memory storage
        for (const [sessionId, sessionData] of this.inMemorySessions) {
          if (sessionData.userId === userId && new Date() <= sessionData.expiresAt) {
            sessions.push({
              sessionId,
              ...sessionData
            });
          }
        }
      }

      return {
        success: true,
        sessions
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async destroyUserSessions(userId) {
    try {
      const userSessions = await this.getUserSessions(userId);
      if (!userSessions.success) {
        return userSessions;
      }

      let destroyedCount = 0;

      for (const session of userSessions.sessions) {
        const result = await this.destroySession(session.sessionId);
        if (result.success) {
          destroyedCount++;
        }
      }

      return {
        success: true,
        destroyedCount
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async cleanupExpiredSessions() {
    try {
      let cleanedCount = 0;

      if (this.redisClient) {
        let cursor = '0';
        do {
          const result = await this.redisClient.scan(cursor, 'MATCH', 'session:*');
          cursor = result[0];
          const keys = result[1];

          for (const key of keys) {
            const exists = await this.redisClient.exists(key);
            if (!exists) {
              cleanedCount++;
            }
          }
        } while (cursor !== '0');
      } else {
        // Clean up in-memory sessions
        const now = new Date();
        for (const [sessionId, sessionData] of this.inMemorySessions) {
          if (now > sessionData.expiresAt) {
            this.inMemorySessions.delete(sessionId);
            cleanedCount++;
          }
        }
      }

      return {
        success: true,
        cleanedCount
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getStatistics() {
    try {
      let totalSessions = 0;
      const uniqueUsers = new Set();

      if (this.redisClient) {
        let cursor = '0';
        do {
          const result = await this.redisClient.scan(cursor, 'MATCH', 'session:*');
          cursor = result[0];
          const keys = result[1];

          for (const key of keys) {
            try {
              const data = await this.redisClient.get(key);
              if (data) {
                const sessionData = JSON.parse(data);
                totalSessions++;
                uniqueUsers.add(sessionData.userId);
              }
            } catch (parseError) {
              // Skip corrupted sessions
            }
          }
        } while (cursor !== '0');
      } else {
        const now = new Date();
        for (const [sessionId, sessionData] of this.inMemorySessions) {
          if (now <= sessionData.expiresAt) {
            totalSessions++;
            uniqueUsers.add(sessionData.userId);
          }
        }
      }

      return {
        totalSessions,
        uniqueUsers: uniqueUsers.size,
        averageSessionsPerUser: uniqueUsers.size > 0 ? totalSessions / uniqueUsers.size : 0
      };

    } catch (error) {
      return {
        totalSessions: 0,
        uniqueUsers: 0,
        averageSessionsPerUser: 0,
        error: error.message
      };
    }
  }

  // Helper methods
  validateMetadata(metadata) {
    if (typeof metadata !== 'object') return false;
    
    if (metadata.userAgent && (typeof metadata.userAgent !== 'string' || metadata.userAgent.length > 500)) {
      return false;
    }
    
    if (metadata.ipAddress && !this.isValidIP(metadata.ipAddress)) {
      return false;
    }

    return true;
  }

  isValidIP(ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  isValidSessionId(sessionId) {
    return typeof sessionId === 'string' && /^[a-f0-9]{32}$/.test(sessionId);
  }

  detectSecurityViolation(originalMetadata, currentMetadata) {
    // Check for significant changes in user agent or IP
    if (originalMetadata.userAgent && currentMetadata.userAgent) {
      if (originalMetadata.userAgent !== currentMetadata.userAgent) {
        return true;
      }
    }

    if (originalMetadata.ipAddress && currentMetadata.ipAddress) {
      if (originalMetadata.ipAddress !== currentMetadata.ipAddress) {
        return true;
      }
    }

    return false;
  }

  setMaxSessionsPerUser(max) {
    this.maxSessionsPerUser = max;
  }

  getFailedAttempts() {
    return this.failedAttempts;
  }
}

module.exports = { SessionManager };