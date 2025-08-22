const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

class AuthManager {
  constructor(jwtSecret = null, users = {}) {
    this.jwtSecret = jwtSecret || process.env.JWT_SECRET || 'default-secret-change-in-production';
    this.users = users;
    this.tokenExpiry = process.env.JWT_EXPIRY || '1h';
    this.saltRounds = 10;
    
    if (!jwtSecret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
  }

  async login(username, password) {
    try {
      // Validate input
      if (!username || !password) {
        return {
          success: false,
          token: null,
          message: 'Invalid credentials'
        };
      }

      // Check if user exists
      const userHash = this.users[username];
      if (!userHash) {
        return {
          success: false,
          token: null,
          message: 'Invalid credentials'
        };
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, userHash);
      if (!isValidPassword) {
        return {
          success: false,
          token: null,
          message: 'Invalid credentials'
        };
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          username,
          iat: Math.floor(Date.now() / 1000)
        },
        this.jwtSecret,
        { expiresIn: this.tokenExpiry }
      );

      return {
        success: true,
        token,
        message: 'Login successful'
      };

    } catch (error) {
      return {
        success: false,
        token: null,
        message: 'Authentication error'
      };
    }
  }

  verifyToken(token) {
    try {
      if (!token) {
        return {
          valid: false,
          decoded: null,
          error: 'No token provided'
        };
      }

      const decoded = jwt.verify(token, this.jwtSecret);
      
      return {
        valid: true,
        decoded,
        error: null
      };

    } catch (error) {
      let errorMessage = 'Invalid token';
      
      if (error.name === 'TokenExpiredError') {
        errorMessage = 'Token has expired';
      } else if (error.name === 'JsonWebTokenError') {
        errorMessage = 'Invalid token signature';
      }

      return {
        valid: false,
        decoded: null,
        error: errorMessage
      };
    }
  }

  createMiddleware() {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'No token provided'
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      const result = this.verifyToken(token);

      if (!result.valid) {
        return res.status(401).json({
          error: 'Invalid token'
        });
      }

      // Add user info to request
      req.user = result.decoded;
      next();
    };
  }

  async generateHash(password) {
    try {
      return await bcrypt.hash(password, this.saltRounds);
    } catch (error) {
      throw new Error(`Failed to generate password hash: ${error.message}`);
    }
  }

  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return false;
    }

    // Username must be 2-50 characters, alphanumeric plus underscore
    const usernameRegex = /^[a-zA-Z0-9_]{2,50}$/;
    return usernameRegex.test(username);
  }

  validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return false;
    }

    // Password must be at least 6 characters and contain at least one number
    return password.length >= 6 && /\d/.test(password);
  }

  // Add a user (for testing and setup)
  async addUser(username, password) {
    if (!this.validateUsername(username)) {
      throw new Error('Invalid username format');
    }

    if (!this.validatePassword(password)) {
      throw new Error('Invalid password format');
    }

    const hash = await this.generateHash(password);
    this.users[username] = hash;
    
    return { success: true, username };
  }

  // Remove a user
  removeUser(username) {
    if (this.users[username]) {
      delete this.users[username];
      return { success: true, username };
    }
    return { success: false, error: 'User not found' };
  }

  // List all users (usernames only, no hashes)
  listUsers() {
    return Object.keys(this.users);
  }

  // Check if user exists
  userExists(username) {
    return Boolean(this.users[username]);
  }
}

module.exports = { AuthManager };