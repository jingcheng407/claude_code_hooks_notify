const { SessionManager } = require('../../src/session');

describe('Session Manager', () => {
  let sessionManager;
  let mockRedisClient;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      scan: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn()
    };
    
    sessionManager = new SessionManager(mockRedisClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Session Creation', () => {
    test('should create new session', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      
      const result = await sessionManager.createSession('user1', {
        userAgent: 'Mozilla/5.0...',
        ipAddress: '192.168.1.1'
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId.length).toBe(32); // UUID without hyphens
      
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `session:${result.sessionId}`,
        expect.any(String),
        'EX',
        3600 // 1 hour default
      );
    });

    test('should handle Redis connection error', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await sessionManager.createSession('user1', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Redis connection failed');
    });

    test('should validate session metadata', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      
      const metadata = {
        userAgent: 'a'.repeat(1000), // Too long
        ipAddress: 'invalid-ip'
      };
      
      const result = await sessionManager.createSession('user1', metadata);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });

  describe('Session Retrieval', () => {
    test('should get existing session', async () => {
      const validSessionId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'; // 32 hex characters
      const sessionData = {
        userId: 'user1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        metadata: { userAgent: 'Mozilla/5.0...' }
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result = await sessionManager.getSession(validSessionId);
      
      expect(result.success).toBe(true);
      expect(result.session.userId).toBe('user1');
      expect(result.session.createdAt).toBeDefined();
    });

    test('should handle non-existent session', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      
      const result = await sessionManager.getSession('non-existent-id');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle corrupted session data', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result = await sessionManager.getSession('corrupted-id');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('corrupted');
    });

    test('should refresh session TTL on access', async () => {
      const sessionData = {
        userId: 'user1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);
      
      await sessionManager.getSession('test-session-id');
      
      expect(mockRedisClient.expire).toHaveBeenCalledWith('session:test-session-id', 3600);
    });
  });

  describe('Session Validation', () => {
    test('should validate active session', async () => {
      const sessionData = {
        userId: 'user1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result = await sessionManager.validateSession('test-session-id');
      
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user1');
    });

    test('should reject expired session', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRedisClient.exists.mockResolvedValue(0);
      
      const result = await sessionManager.validateSession('expired-session-id');
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    test('should reject invalid session format', async () => {
      const result = await sessionManager.validateSession('invalid-format');
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid session ID');
    });

    test('should handle session validation with user check', async () => {
      const sessionData = {
        userId: 'user1',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result1 = await sessionManager.validateSession('test-session-id', 'user1');
      expect(result1.valid).toBe(true);
      
      const result2 = await sessionManager.validateSession('test-session-id', 'user2');
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('access denied');
    });
  });

  describe('Session Management', () => {
    test('should update session activity', async () => {
      mockRedisClient.get.mockResolvedValue('{"userId":"user1"}');
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.expire.mockResolvedValue(1);
      
      const result = await sessionManager.updateActivity('test-session-id');
      
      expect(result.success).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalled();
      expect(mockRedisClient.expire).toHaveBeenCalled();
    });

    test('should destroy session', async () => {
      mockRedisClient.del.mockResolvedValue(1);
      
      const result = await sessionManager.destroySession('test-session-id');
      
      expect(result.success).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith('session:test-session-id');
    });

    test('should handle destroy non-existent session', async () => {
      mockRedisClient.del.mockResolvedValue(0);
      
      const result = await sessionManager.destroySession('non-existent-id');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should cleanup expired sessions', async () => {
      mockRedisClient.scan.mockResolvedValueOnce([
        '0',
        ['session:id1', 'session:id2', 'session:id3']
      ]);
      
      // Mock some expired sessions
      mockRedisClient.exists
        .mockResolvedValueOnce(0) // id1 expired
        .mockResolvedValueOnce(1) // id2 exists
        .mockResolvedValueOnce(0); // id3 expired
      
      mockRedisClient.del.mockResolvedValue(1);
      
      const result = await sessionManager.cleanupExpiredSessions();
      
      expect(result.success).toBe(true);
      expect(result.cleanedCount).toBe(2);
      expect(mockRedisClient.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('User Session Management', () => {
    test('should get user sessions', async () => {
      mockRedisClient.scan.mockResolvedValueOnce([
        '0',
        ['session:id1', 'session:id2', 'session:id3']
      ]);
      
      const sessions = [
        { userId: 'user1', createdAt: new Date().toISOString() },
        { userId: 'user2', createdAt: new Date().toISOString() },
        { userId: 'user1', createdAt: new Date().toISOString() }
      ];
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(sessions[0]))
        .mockResolvedValueOnce(JSON.stringify(sessions[1]))
        .mockResolvedValueOnce(JSON.stringify(sessions[2]));
      
      const result = await sessionManager.getUserSessions('user1');
      
      expect(result.success).toBe(true);
      expect(result.sessions.length).toBe(2);
      expect(result.sessions.every(s => s.userId === 'user1')).toBe(true);
    });

    test('should destroy all user sessions', async () => {
      mockRedisClient.scan.mockResolvedValueOnce([
        '0',
        ['session:id1', 'session:id2', 'session:id3']
      ]);
      
      const sessions = [
        { userId: 'user1', createdAt: new Date().toISOString() },
        { userId: 'user2', createdAt: new Date().toISOString() },
        { userId: 'user1', createdAt: new Date().toISOString() }
      ];
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(sessions[0]))
        .mockResolvedValueOnce(JSON.stringify(sessions[1]))
        .mockResolvedValueOnce(JSON.stringify(sessions[2]));
      
      mockRedisClient.del.mockResolvedValue(1);
      
      const result = await sessionManager.destroyUserSessions('user1');
      
      expect(result.success).toBe(true);
      expect(result.destroyedCount).toBe(2);
      expect(mockRedisClient.del).toHaveBeenCalledWith('session:id1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('session:id3');
    });

    test('should enforce concurrent session limit', async () => {
      const maxSessions = 3;
      sessionManager.setMaxSessionsPerUser(maxSessions);
      
      // Mock existing sessions
      mockRedisClient.scan.mockResolvedValue([
        '0',
        ['session:id1', 'session:id2', 'session:id3']
      ]);
      
      const existingSessions = Array(maxSessions).fill(null).map(() => ({
        userId: 'user1',
        createdAt: new Date().toISOString()
      }));
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(existingSessions[0]))
        .mockResolvedValueOnce(JSON.stringify(existingSessions[1]))
        .mockResolvedValueOnce(JSON.stringify(existingSessions[2]));
      
      const result = await sessionManager.createSession('user1', {});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('maximum sessions');
    });
  });

  describe('Session Statistics', () => {
    test('should get session statistics', async () => {
      mockRedisClient.scan.mockResolvedValueOnce([
        '0',
        ['session:id1', 'session:id2', 'session:id3']
      ]);
      
      const sessions = [
        { userId: 'user1', createdAt: new Date().toISOString() },
        { userId: 'user2', createdAt: new Date().toISOString() },
        { userId: 'user1', createdAt: new Date().toISOString() }
      ];
      
      mockRedisClient.get
        .mockResolvedValueOnce(JSON.stringify(sessions[0]))
        .mockResolvedValueOnce(JSON.stringify(sessions[1]))
        .mockResolvedValueOnce(JSON.stringify(sessions[2]));
      
      const stats = await sessionManager.getStatistics();
      
      expect(stats.totalSessions).toBe(3);
      expect(stats.uniqueUsers).toBe(2);
      expect(stats.averageSessionsPerUser).toBe(1.5);
    });
  });

  describe('Security Features', () => {
    test('should detect session hijacking attempts', async () => {
      const originalMetadata = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ipAddress: '192.168.1.1'
      };
      
      const sessionData = {
        userId: 'user1',
        metadata: originalMetadata,
        createdAt: new Date().toISOString()
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      
      const suspiciousMetadata = {
        userAgent: 'curl/7.68.0',
        ipAddress: '10.0.0.1'
      };
      
      const result = await sessionManager.validateSession('test-session-id', null, suspiciousMetadata);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('security violation');
    });

    test('should track failed validation attempts', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      
      await sessionManager.validateSession('invalid-session-1');
      await sessionManager.validateSession('invalid-session-2');
      await sessionManager.validateSession('invalid-session-3');
      
      const attempts = sessionManager.getFailedAttempts();
      expect(attempts).toBeGreaterThanOrEqual(3);
    });

    test('should implement rate limiting for session operations', async () => {
      const sessionId = 'rate-limit-test';
      
      // Simulate rapid session access
      const promises = Array(100).fill(null).map(() => 
        sessionManager.validateSession(sessionId)
      );
      
      const results = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimited = results.filter(r => r.error && r.error.includes('rate limit'));
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});