const { AuthManager } = require('../../src/auth');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

describe('Authentication Manager', () => {
  let authManager;
  const testSecret = 'test-jwt-secret';
  const testUsers = {
    admin: '$2b$10$...' // Will be set up in beforeAll
  };

  beforeAll(async () => {
    testUsers.admin = await bcrypt.hash('admin123', 10);
    authManager = new AuthManager(testSecret, testUsers);
  });

  describe('Login', () => {
    test('should authenticate valid credentials', async () => {
      const result = await authManager.login('admin', 'admin123');
      
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.message).toBe('Login successful');
      
      // Verify token is valid JWT
      const decoded = jwt.verify(result.token, testSecret);
      expect(decoded.username).toBe('admin');
      expect(decoded.exp).toBeDefined();
    });

    test('should reject invalid username', async () => {
      const result = await authManager.login('nonexistent', 'password');
      
      expect(result.success).toBe(false);
      expect(result.token).toBeNull();
      expect(result.message).toBe('Invalid credentials');
    });

    test('should reject invalid password', async () => {
      const result = await authManager.login('admin', 'wrongpassword');
      
      expect(result.success).toBe(false);
      expect(result.token).toBeNull();
      expect(result.message).toBe('Invalid credentials');
    });

    test('should handle empty credentials', async () => {
      const result1 = await authManager.login('', 'password');
      const result2 = await authManager.login('admin', '');
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });

    test('should handle null/undefined credentials', async () => {
      const result1 = await authManager.login(null, 'password');
      const result2 = await authManager.login('admin', undefined);
      
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe('Token Verification', () => {
    let validToken;

    beforeAll(async () => {
      const loginResult = await authManager.login('admin', 'admin123');
      validToken = loginResult.token;
    });

    test('should verify valid token', () => {
      const result = authManager.verifyToken(validToken);
      
      expect(result.valid).toBe(true);
      expect(result.decoded.username).toBe('admin');
      expect(result.error).toBeNull();
    });

    test('should reject invalid token', () => {
      const result = authManager.verifyToken('invalid-token');
      
      expect(result.valid).toBe(false);
      expect(result.decoded).toBeNull();
      expect(result.error).toBeDefined();
    });

    test('should reject expired token', () => {
      const expiredToken = jwt.sign(
        { username: 'admin' },
        testSecret,
        { expiresIn: '-1h' }
      );
      
      const result = authManager.verifyToken(expiredToken);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    test('should reject token with wrong secret', () => {
      const wrongToken = jwt.sign(
        { username: 'admin' },
        'wrong-secret',
        { expiresIn: '1h' }
      );
      
      const result = authManager.verifyToken(wrongToken);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle null/undefined token', () => {
      const result1 = authManager.verifyToken(null);
      const result2 = authManager.verifyToken(undefined);
      
      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
    });
  });

  describe('Middleware', () => {
    test('should create authentication middleware', () => {
      const middleware = authManager.createMiddleware();
      
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });

    test('should authenticate valid request', async () => {
      const loginResult = await authManager.login('admin', 'admin123');
      const middleware = authManager.createMiddleware();
      
      const req = {
        headers: {
          authorization: `Bearer ${loginResult.token}`
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('admin');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should reject request without token', () => {
      const middleware = authManager.createMiddleware();
      
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No token provided'
      });
      expect(next).not.toHaveBeenCalled();
    });

    test('should reject request with invalid token', () => {
      const middleware = authManager.createMiddleware();
      
      const req = {
        headers: {
          authorization: 'Bearer invalid-token'
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid token'
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Password Hash Generation', () => {
    test('should generate password hash', async () => {
      const hash = await authManager.generateHash('testpassword');
      
      expect(hash).toBeDefined();
      expect(hash).not.toBe('testpassword');
      expect(hash.startsWith('$2b$')).toBe(true);
      
      // Verify hash can be used for login
      const isValid = await bcrypt.compare('testpassword', hash);
      expect(isValid).toBe(true);
    });

    test('should generate different hashes for same password', async () => {
      const hash1 = await authManager.generateHash('testpassword');
      const hash2 = await authManager.generateHash('testpassword');
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Security Validation', () => {
    test('should validate username format', () => {
      expect(authManager.validateUsername('admin')).toBe(true);
      expect(authManager.validateUsername('user123')).toBe(true);
      expect(authManager.validateUsername('test_user')).toBe(true);
      
      expect(authManager.validateUsername('')).toBe(false);
      expect(authManager.validateUsername('a')).toBe(false); // too short
      expect(authManager.validateUsername('a'.repeat(51))).toBe(false); // too long
      expect(authManager.validateUsername('admin@test')).toBe(false); // invalid chars
      expect(authManager.validateUsername('admin space')).toBe(false); // spaces
    });

    test('should validate password strength', () => {
      expect(authManager.validatePassword('admin123')).toBe(true);
      expect(authManager.validatePassword('StrongPass123!')).toBe(true);
      
      expect(authManager.validatePassword('')).toBe(false);
      expect(authManager.validatePassword('123')).toBe(false); // too short
      expect(authManager.validatePassword('password')).toBe(false); // no numbers
    });
  });
});