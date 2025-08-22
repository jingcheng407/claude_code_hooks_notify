const { HealthChecker } = require('../../src/monitoring');

describe('Health Checker', () => {
  let healthChecker;
  
  beforeEach(() => {
    healthChecker = new HealthChecker();
  });
  
  describe('Basic Health Check', () => {
    test('should perform health check', async () => {
      const result = await healthChecker.check();
      
      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|unhealthy/);
      expect(result.timestamp).toBeDefined();
      expect(result.checks).toBeDefined();
    });
    
    test('should check memory usage', () => {
      const result = healthChecker.checkMemory();
      
      expect(result).toBeDefined();
      expect(result.status).toMatch(/healthy|unhealthy/);
      expect(result.usage).toBeDefined();
    });
    
    test('should handle Redis check without client', async () => {
      const result = await healthChecker.checkRedis();
      
      expect(result.status).toBe('unknown');
      expect(result.message).toContain('Redis not configured');
    });
    
    test('should handle terminal check without session manager', () => {
      const result = healthChecker.checkTerminals();
      
      expect(result.status).toBe('unknown');
      expect(result.message).toContain('Session manager not initialized');
    });
  });
  
  describe('Mock Dependencies', () => {
    test('should check Redis with mock client', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockResolvedValue('PONG')
      };
      
      const checker = new HealthChecker(mockRedisClient);
      const result = await checker.checkRedis();
      
      expect(result.status).toBe('healthy');
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });
    
    test('should handle Redis connection error', async () => {
      const mockRedisClient = {
        ping: jest.fn().mockRejectedValue(new Error('Connection failed'))
      };
      
      const checker = new HealthChecker(mockRedisClient);
      const result = await checker.checkRedis();
      
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Connection failed');
    });
    
    test('should check terminals with mock session manager', () => {
      const mockSessionManager = {
        getActiveTerminalCount: jest.fn().mockReturnValue(2)
      };
      
      const checker = new HealthChecker(null, mockSessionManager);
      const result = checker.checkTerminals();
      
      expect(result.status).toBe('healthy');
      expect(result.count).toBe(2);
    });
  });
});