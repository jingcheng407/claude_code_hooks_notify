const pty = require('node-pty');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

class TerminalManager {
  constructor(redisClient = null, sessionManager = null) {
    this.redisClient = redisClient;
    this.sessionManager = sessionManager;
    this.terminals = new Map(); // Active terminals
    this.maxTerminalsPerUser = parseInt(process.env.MAX_TERMINALS_PER_USER) || 5;
    this.maxConcurrentUsers = parseInt(process.env.MAX_CONCURRENT_USERS) || 50;
    this.inactivityTimeout = parseInt(process.env.TERMINAL_TIMEOUT) || 2 * 60 * 60 * 1000; // 2 hours
    this.commandQueue = new Map(); // For backpressure management
    this.maxQueueSize = 1000;
    this.allowedShells = ['/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/fish'];
    this.basePath = process.env.BASE_DIR || os.homedir();
  }

  async createTerminal(userId, options = {}) {
    try {
      // Validate user terminal limit
      const userTerminalCount = this.getUserTerminalCount(userId);
      if (userTerminalCount >= this.maxTerminalsPerUser) {
        return {
          success: false,
          error: `User has reached maximum terminal limit (${this.maxTerminalsPerUser})`
        };
      }

      // Validate terminal options
      const validationResult = this.validateTerminalOptions(options);
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.error
        };
      }

      const terminalOptions = {
        cols: options.cols || 80,
        rows: options.rows || 24,
        shell: options.shell || '/bin/bash',
        cwd: this.validateWorkingDirectory(options.cwd) ? options.cwd : this.basePath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          SHELL: options.shell || '/bin/bash'
        }
      };

      // Generate terminal ID
      const terminalId = crypto.randomBytes(16).toString('hex');

      // Create PTY process
      const ptyProcess = pty.spawn(terminalOptions.shell, [], terminalOptions);

      // Create terminal session
      const terminal = {
        id: terminalId,
        userId,
        ptyProcess,
        cols: terminalOptions.cols,
        rows: terminalOptions.rows,
        shell: terminalOptions.shell,
        cwd: terminalOptions.cwd,
        createdAt: new Date(),
        lastActivity: new Date(),
        status: 'active'
      };

      // Set up PTY event handlers
      this.setupPtyHandlers(terminal);

      // Store terminal
      this.terminals.set(terminalId, terminal);

      // Initialize command queue for this terminal
      this.commandQueue.set(terminalId, []);

      // Save session to Redis if available
      if (this.redisClient) {
        await this.saveSession(terminalId);
      }

      return {
        success: true,
        terminalId,
        pid: ptyProcess.pid
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to create terminal: ${error.message}`
      };
    }
  }

  setupPtyHandlers(terminal) {
    const { ptyProcess, id: terminalId } = terminal;

    ptyProcess.onData((data) => {
      terminal.lastActivity = new Date();
      // Emit data event (will be handled by WebSocket in Phase 3-2)
      this.emitTerminalData(terminalId, data);
    });

    ptyProcess.onExit((code, signal) => {
      terminal.status = 'exited';
      terminal.exitCode = code;
      terminal.exitSignal = signal;
      
      // Clean up
      this.cleanup(terminalId);
      
      // Emit exit event
      this.emitTerminalExit(terminalId, { code, signal });
    });
  }

  emitTerminalData(terminalId, data) {
    // This will be connected to WebSocket in Phase 3-2
    // For now, store events for testing
    if (!this.eventLog) this.eventLog = [];
    this.eventLog.push({ type: 'data', terminalId, data, timestamp: new Date() });
  }

  emitTerminalExit(terminalId, exitInfo) {
    // This will be connected to WebSocket in Phase 3-2
    if (!this.eventLog) this.eventLog = [];
    this.eventLog.push({ type: 'exit', terminalId, exitInfo, timestamp: new Date() });
  }

  writeToTerminal(terminalId, userId, data) {
    try {
      const terminal = this.getTerminal(terminalId);
      if (!terminal) {
        return {
          success: false,
          error: 'Terminal not found'
        };
      }

      // Check user permission
      if (terminal.userId !== userId) {
        return {
          success: false,
          error: 'Terminal access denied'
        };
      }

      // Sanitize input
      const sanitizedData = this.sanitizeInput(data);

      // Check command queue size (backpressure)
      const queue = this.commandQueue.get(terminalId) || [];
      if (queue.length >= this.maxQueueSize) {
        return {
          success: false,
          error: 'Terminal input queue full'
        };
      }

      // Write to PTY
      terminal.ptyProcess.write(sanitizedData);
      terminal.lastActivity = new Date();

      // Add to command queue for monitoring
      queue.push({
        data: sanitizedData,
        timestamp: new Date()
      });

      // Limit queue size
      if (queue.length > this.maxQueueSize) {
        queue.shift();
      }

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: `Failed to write to terminal: ${error.message}`
      };
    }
  }

  resizeTerminal(terminalId, userId, cols, rows) {
    try {
      const terminal = this.getTerminal(terminalId);
      if (!terminal) {
        return {
          success: false,
          error: 'Terminal not found'
        };
      }

      // Check user permission
      if (terminal.userId !== userId) {
        return {
          success: false,
          error: 'Terminal access denied'
        };
      }

      // Validate dimensions
      if (!this.isValidDimensions(cols, rows)) {
        return {
          success: false,
          error: 'Invalid terminal dimensions'
        };
      }

      // Resize PTY
      terminal.ptyProcess.resize(cols, rows);
      terminal.cols = cols;
      terminal.rows = rows;
      terminal.lastActivity = new Date();

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: `Failed to resize terminal: ${error.message}`
      };
    }
  }

  async killTerminal(terminalId, userId) {
    try {
      const terminal = this.getTerminal(terminalId);
      if (!terminal) {
        return {
          success: false,
          error: 'Terminal not found'
        };
      }

      // Check user permission
      if (terminal.userId !== userId) {
        return {
          success: false,
          error: 'Terminal access denied'
        };
      }

      // Kill PTY process
      terminal.ptyProcess.kill();
      terminal.status = 'killed';

      // Clean up
      await this.cleanup(terminalId);

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: `Failed to kill terminal: ${error.message}`
      };
    }
  }

  async cleanup(terminalId) {
    try {
      // Remove from active terminals
      this.terminals.delete(terminalId);

      // Remove command queue
      this.commandQueue.delete(terminalId);

      // Remove from Redis session
      if (this.redisClient) {
        await this.redisClient.del(`terminal:${terminalId}`);
      }

    } catch (error) {
      console.error(`Cleanup failed for terminal ${terminalId}:`, error);
    }
  }

  async saveSession(terminalId) {
    try {
      const terminal = this.getTerminal(terminalId);
      if (!terminal || !this.redisClient) {
        return { success: false, error: 'Terminal not found or Redis not available' };
      }

      const sessionData = {
        userId: terminal.userId,
        cols: terminal.cols,
        rows: terminal.rows,
        shell: terminal.shell,
        cwd: terminal.cwd,
        createdAt: terminal.createdAt.toISOString(),
        lastActivity: terminal.lastActivity.toISOString()
      };

      await this.redisClient.set(
        `terminal:${terminalId}`,
        JSON.stringify(sessionData),
        'EX',
        86400 // 24 hours
      );

      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: `Failed to save session: ${error.message}`
      };
    }
  }

  async restoreSession(terminalId) {
    try {
      if (!this.redisClient) {
        return {
          success: false,
          error: 'Redis not configured'
        };
      }

      const sessionData = await this.redisClient.get(`terminal:${terminalId}`);
      if (!sessionData) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      let parsedData;
      try {
        parsedData = JSON.parse(sessionData);
      } catch (parseError) {
        return {
          success: false,
          error: 'Session data corrupted'
        };
      }

      // Create new terminal with restored session data
      const result = await this.createTerminal(parsedData.userId, {
        cols: parsedData.cols,
        rows: parsedData.rows,
        shell: parsedData.shell,
        cwd: parsedData.cwd
      });

      if (result.success) {
        return {
          success: true,
          terminalId: result.terminalId,
          restored: true
        };
      }

      return result;

    } catch (error) {
      return {
        success: false,
        error: `Failed to restore session: ${error.message}`
      };
    }
  }

  // Utility methods
  getTerminal(terminalId) {
    return this.terminals.get(terminalId);
  }

  getUserTerminals(userId) {
    const userTerminals = [];
    for (const terminal of this.terminals.values()) {
      if (terminal.userId === userId) {
        userTerminals.push(terminal);
      }
    }
    return userTerminals;
  }

  getUserTerminalCount(userId) {
    return this.getUserTerminals(userId).length;
  }

  getActiveTerminalCount() {
    return this.terminals.size;
  }

  async cleanupInactiveTerminals() {
    const now = new Date();
    const toCleanup = [];

    for (const [terminalId, terminal] of this.terminals) {
      if (now - terminal.lastActivity > this.inactivityTimeout) {
        toCleanup.push(terminalId);
      }
    }

    for (const terminalId of toCleanup) {
      await this.cleanup(terminalId);
    }

    return toCleanup.length;
  }

  async cleanupUserTerminals(userId) {
    const userTerminals = this.getUserTerminals(userId);
    
    for (const terminal of userTerminals) {
      try {
        terminal.ptyProcess.kill();
        await this.cleanup(terminal.id);
      } catch (error) {
        console.error(`Failed to cleanup terminal ${terminal.id}:`, error);
      }
    }
  }

  getStatistics() {
    const activeUsers = new Set();
    let totalMemory = 0;

    for (const terminal of this.terminals.values()) {
      activeUsers.add(terminal.userId);
    }

    const memoryUsage = process.memoryUsage();

    return {
      totalTerminals: this.terminals.size,
      activeUsers: activeUsers.size,
      memoryUsage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
      }
    };
  }

  // Validation methods
  validateTerminalOptions(options) {
    if (options.cols !== undefined && (!Number.isInteger(options.cols) || options.cols < 10 || options.cols > 300)) {
      return { valid: false, error: 'Invalid columns dimension' };
    }

    if (options.rows !== undefined && (!Number.isInteger(options.rows) || options.rows < 10 || options.rows > 100)) {
      return { valid: false, error: 'Invalid rows dimension' };
    }

    if (options.shell && !this.allowedShells.includes(options.shell)) {
      return { valid: false, error: 'Shell not allowed' };
    }

    return { valid: true };
  }

  isValidDimensions(cols, rows) {
    return Number.isInteger(cols) && Number.isInteger(rows) &&
           cols >= 10 && cols <= 300 &&
           rows >= 10 && rows <= 100;
  }

  validateWorkingDirectory(dir) {
    if (!dir) return false;
    
    try {
      // Check for path traversal
      const normalizedPath = path.normalize(dir);
      if (normalizedPath.includes('..')) return false;
      
      // Must be absolute path
      if (!path.isAbsolute(normalizedPath)) return false;
      
      // Must be within allowed base paths
      const allowedPaths = [os.homedir(), '/tmp', '/var/tmp', '/home/user', '/var/log'];
      return allowedPaths.some(allowedPath => 
        normalizedPath.startsWith(allowedPath)
      );
    } catch {
      return false;
    }
  }

  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    
    // Remove dangerous escape sequences
    let sanitized = input
      .replace(/\x1b\]0;[^\x07]*\x07/g, '') // Remove OSC sequences
      .replace(/\x1b\[2J/g, '') // Remove clear screen
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove other control chars except \n, \r, \t

    return sanitized;
  }

  isValidWorkingDirectory(dir) {
    return this.validateWorkingDirectory(dir);
  }

  getCommandQueueSize(terminalId) {
    const queue = this.commandQueue.get(terminalId);
    return queue ? queue.length : 0;
  }
}

module.exports = { TerminalManager };