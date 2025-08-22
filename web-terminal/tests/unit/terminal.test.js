const { TerminalManager } = require('../../src/terminal');

// Mock node-pty
jest.mock('node-pty', () => ({
  spawn: jest.fn(() => ({
    write: jest.fn(),
    kill: jest.fn(),
    onData: jest.fn(),
    onExit: jest.fn(),
    pid: 12345,
    resize: jest.fn()
  }))
}));

describe('Terminal Manager', () => {
  let terminalManager;
  let mockRedisClient;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn()
    };
    
    terminalManager = new TerminalManager(mockRedisClient);
  });

  afterEach(() => {
    terminalManager.cleanup();
    jest.clearAllMocks();
  });

  describe('Terminal Creation', () => {
    test('should create new terminal session', async () => {
      const result = await terminalManager.createTerminal('user1', {
        cols: 80,
        rows: 24,
        shell: '/bin/bash'
      });

      expect(result.success).toBe(true);
      expect(result.terminalId).toBeDefined();
      expect(result.pid).toBe(12345);
      
      const terminal = terminalManager.getTerminal(result.terminalId);
      expect(terminal).toBeDefined();
      expect(terminal.userId).toBe('user1');
    });

    test('should enforce user terminal limit', async () => {
      // Create max terminals for user
      const maxTerminals = 5;
      for (let i = 0; i < maxTerminals; i++) {
        await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      }

      // Try to create one more
      const result = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('maximum');
    });

    test('should validate terminal options', async () => {
      const invalidOptions = [
        { cols: 0, rows: 24 },
        { cols: 80, rows: 0 },
        { cols: 1000, rows: 24 },
        { cols: 80, rows: 1000 },
        { shell: '/invalid/shell' }
      ];

      for (const options of invalidOptions) {
        const result = await terminalManager.createTerminal('user1', options);
        expect(result.success).toBe(false);
      }
    });

    test('should handle PTY spawn errors', async () => {
      const pty = require('node-pty');
      pty.spawn.mockImplementationOnce(() => {
        throw new Error('Failed to spawn');
      });

      const result = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to spawn');
    });
  });

  describe('Terminal Operations', () => {
    let terminalId;

    beforeEach(async () => {
      const result = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      terminalId = result.terminalId;
    });

    test('should write data to terminal', () => {
      const result = terminalManager.writeToTerminal(terminalId, 'user1', 'ls -la\n');
      
      expect(result.success).toBe(true);
      
      const terminal = terminalManager.getTerminal(terminalId);
      expect(terminal.ptyProcess.write).toHaveBeenCalledWith('ls -la\n');
    });

    test('should reject unauthorized write access', () => {
      const result = terminalManager.writeToTerminal(terminalId, 'user2', 'ls -la\n');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('access denied');
    });

    test('should resize terminal', () => {
      const result = terminalManager.resizeTerminal(terminalId, 'user1', 120, 30);
      
      expect(result.success).toBe(true);
      
      const terminal = terminalManager.getTerminal(terminalId);
      expect(terminal.ptyProcess.resize).toHaveBeenCalledWith(120, 30);
      expect(terminal.cols).toBe(120);
      expect(terminal.rows).toBe(30);
    });

    test('should validate resize parameters', () => {
      const invalidSizes = [
        [0, 24], [80, 0], [1000, 24], [80, 1000]
      ];

      for (const [cols, rows] of invalidSizes) {
        const result = terminalManager.resizeTerminal(terminalId, 'user1', cols, rows);
        expect(result.success).toBe(false);
      }
    });

    test('should handle non-existent terminal', () => {
      const result = terminalManager.writeToTerminal('invalid-id', 'user1', 'test');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Session Persistence', () => {
    test('should save terminal session to Redis', async () => {
      const result = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      
      await terminalManager.saveSession(result.terminalId);
      
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `terminal:${result.terminalId}`,
        expect.any(String),
        'EX',
        86400 // 24 hours
      );
    });

    test('should restore terminal session from Redis', async () => {
      const sessionData = {
        userId: 'user1',
        cols: 80,
        rows: 24,
        shell: '/bin/bash',
        cwd: '/home/user1',
        createdAt: new Date().toISOString()
      };
      
      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result = await terminalManager.restoreSession('test-terminal-id');
      
      expect(result.success).toBe(true);
      expect(result.terminalId).toBeDefined();
      
      const terminal = terminalManager.getTerminal(result.terminalId);
      expect(terminal.userId).toBe('user1');
    });

    test('should handle non-existent session', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      
      const result = await terminalManager.restoreSession('non-existent-id');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle corrupted session data', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');
      mockRedisClient.exists.mockResolvedValue(1);
      
      const result = await terminalManager.restoreSession('corrupted-id');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('corrupted');
    });
  });

  describe('Terminal Cleanup', () => {
    let terminalId;

    beforeEach(async () => {
      const result = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      terminalId = result.terminalId;
    });

    test('should kill terminal process', async () => {
      const result = await terminalManager.killTerminal(terminalId, 'user1');
      
      expect(result.success).toBe(true);
      
      // Terminal should be cleaned up after kill
      expect(terminalManager.getTerminal(terminalId)).toBeUndefined();
    });

    test('should clean up Redis session on kill', async () => {
      await terminalManager.killTerminal(terminalId, 'user1');
      
      expect(mockRedisClient.del).toHaveBeenCalledWith(`terminal:${terminalId}`);
    });

    test('should reject unauthorized kill', async () => {
      const result = await terminalManager.killTerminal(terminalId, 'user2');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('access denied');
    });

    test('should cleanup inactive terminals', async () => {
      // Mock inactive terminal (older than timeout)
      const terminal = terminalManager.getTerminal(terminalId);
      terminal.lastActivity = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
      
      await terminalManager.cleanupInactiveTerminals();
      
      expect(terminalManager.getTerminal(terminalId)).toBeUndefined();
    });

    test('should cleanup all user terminals', async () => {
      // Create multiple terminals for user
      await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      
      const userTerminals = terminalManager.getUserTerminals('user1');
      expect(userTerminals.length).toBe(3);
      
      await terminalManager.cleanupUserTerminals('user1');
      
      const remainingTerminals = terminalManager.getUserTerminals('user1');
      expect(remainingTerminals.length).toBe(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should get active terminal count', async () => {
      await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      await terminalManager.createTerminal('user2', { cols: 80, rows: 24 });
      
      const count = terminalManager.getActiveTerminalCount();
      expect(count).toBe(2);
    });

    test('should get user terminal count', async () => {
      await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      await terminalManager.createTerminal('user2', { cols: 80, rows: 24 });
      
      const user1Count = terminalManager.getUserTerminalCount('user1');
      const user2Count = terminalManager.getUserTerminalCount('user2');
      
      expect(user1Count).toBe(2);
      expect(user2Count).toBe(1);
    });

    test('should get terminal statistics', () => {
      const stats = terminalManager.getStatistics();
      
      expect(stats).toBeDefined();
      expect(stats.totalTerminals).toBeDefined();
      expect(stats.activeUsers).toBeDefined();
      expect(stats.memoryUsage).toBeDefined();
    });
  });

  describe('Security and Validation', () => {
    test('should sanitize terminal input', () => {
      const maliciousInputs = [
        '\x1b]0;evil\x07',  // OSC escape sequence
        '\x1b[2J',          // Clear screen
        '\x00\x01\x02',     // Control characters
        'rm -rf /',         // Dangerous command (should not be filtered)
      ];
      
      for (const input of maliciousInputs) {
        const sanitized = terminalManager.sanitizeInput(input);
        expect(sanitized).toBeDefined();
        
        // Dangerous commands should pass through (shell responsibility)
        // But control sequences should be filtered
        if (input.includes('\x1b') || input.includes('\x00')) {
          expect(sanitized.length).toBeLessThan(input.length);
        }
      }
    });

    test('should validate working directory', () => {
      const validDirs = ['/home/user', '/tmp', '/var/log'];
      const invalidDirs = ['../../../etc', '/etc/passwd', '~/.ssh'];
      
      for (const dir of validDirs) {
        expect(terminalManager.isValidWorkingDirectory(dir)).toBe(true);
      }
      
      for (const dir of invalidDirs) {
        expect(terminalManager.isValidWorkingDirectory(dir)).toBe(false);
      }
    });

    test('should enforce rate limiting', async () => {
      const terminal = await terminalManager.createTerminal('user1', { cols: 80, rows: 24 });
      
      // Send many commands rapidly to exceed queue size
      let successCount = 0;
      for (let i = 0; i < 1100; i++) {
        const result = terminalManager.writeToTerminal(terminal.terminalId, 'user1', `echo ${i}\n`);
        if (result.success) successCount++;
      }
      
      // Should implement backpressure - not all commands should succeed
      expect(successCount).toBeLessThan(1100);
    });
  });
});