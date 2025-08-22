require('dotenv').config();
const { HealthChecker } = require('./monitoring');
const { AuthManager } = require('./auth');
const { TerminalManager } = require('./terminal');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", // Required for inline scripts
        "cdn.jsdelivr.net" // For xterm.js and socket.io CDN
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", // Required for dynamic CSS
        "cdn.jsdelivr.net" // For xterm.js CSS
      ],
      connectSrc: [
        "'self'", 
        "ws:", 
        "wss:",
        `ws://localhost:${process.env.PORT || 3000}`,
        `wss://localhost:${process.env.PORT || 3000}`
      ],
      fontSrc: ["'self'", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Allow WebSocket connections
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many login attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    error: 'Too many requests, please try again later'
  }
});

app.use(globalLimiter);

// Initialize components
const healthChecker = new HealthChecker();
const terminalManager = new TerminalManager();

// Initialize auth manager with default admin user
const authManager = new AuthManager();

// Initialize admin user synchronously for testing
async function initializeAuth() {
  try {
    await authManager.addUser('admin', process.env.ADMIN_PASSWORD || 'admin123');
  } catch (error) {
    // User already exists or other error - ignore
  }
}

// Call initialization immediately
initializeAuth();

// Socket.IO authentication middleware
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const result = authManager.verifyToken(token);
    
    if (!result.valid) {
      return next(new Error('Invalid token'));
    }

    // Attach user info to socket
    socket.user = result.decoded;
    socket.userId = result.decoded.username;
    
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected via WebSocket`);

  // Send welcome message
  socket.emit('authenticated', {
    message: 'Successfully connected to Web Terminal',
    user: socket.user
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User ${socket.userId} disconnected: ${reason}`);
    
    // Clean up user terminals on disconnect (optional)
    // terminalManager.cleanupUserTerminals(socket.userId);
  });

  // Terminal creation
  socket.on('terminal:create', async (data) => {
    try {
      const options = {
        cols: data.cols || 80,
        rows: data.rows || 24,
        shell: data.shell,
        cwd: data.cwd
      };

      const result = await terminalManager.createTerminal(socket.userId, options);
      
      if (result.success) {
        // Join terminal-specific room
        socket.join(`terminal:${result.terminalId}`);
        
        socket.emit('terminal:created', {
          terminalId: result.terminalId,
          pid: result.pid
        });

        // Set up terminal data forwarding
        const terminal = terminalManager.getTerminal(result.terminalId);
        if (terminal) {
          // Override the emit methods to forward to WebSocket
          const originalEmitData = terminalManager.emitTerminalData;
          const originalEmitExit = terminalManager.emitTerminalExit;

          terminalManager.emitTerminalData = (terminalId, data) => {
            io.to(`terminal:${terminalId}`).emit('terminal:data', { data });
            originalEmitData.call(terminalManager, terminalId, data);
          };

          terminalManager.emitTerminalExit = (terminalId, exitInfo) => {
            io.to(`terminal:${terminalId}`).emit('terminal:exit', exitInfo);
            originalEmitExit.call(terminalManager, terminalId, exitInfo);
          };
        }
      } else {
        socket.emit('terminal:error', { message: result.error });
      }
    } catch (error) {
      socket.emit('terminal:error', { message: 'Failed to create terminal' });
    }
  });

  // Terminal input
  socket.on('terminal:input', (data) => {
    try {
      const { terminalId, input } = data;
      
      if (!terminalId || !input) {
        socket.emit('terminal:error', { message: 'Missing terminalId or input' });
        return;
      }

      const result = terminalManager.writeToTerminal(terminalId, socket.userId, input);
      
      if (!result.success) {
        socket.emit('terminal:error', { message: result.error });
      }
    } catch (error) {
      socket.emit('terminal:error', { message: 'Failed to write to terminal' });
    }
  });

  // Terminal resize
  socket.on('terminal:resize', (data) => {
    try {
      const { terminalId, cols, rows } = data;
      
      if (!terminalId || !cols || !rows) {
        socket.emit('terminal:error', { message: 'Missing terminalId, cols, or rows' });
        return;
      }

      const result = terminalManager.resizeTerminal(terminalId, socket.userId, cols, rows);
      
      if (result.success) {
        socket.emit('terminal:resized', { terminalId, cols, rows });
      } else {
        socket.emit('terminal:error', { message: result.error });
      }
    } catch (error) {
      socket.emit('terminal:error', { message: 'Failed to resize terminal' });
    }
  });

  // Terminal kill
  socket.on('terminal:kill', async (data) => {
    try {
      const { terminalId } = data;
      
      if (!terminalId) {
        socket.emit('terminal:error', { message: 'Missing terminalId' });
        return;
      }

      const result = await terminalManager.killTerminal(terminalId, socket.userId);
      
      if (result.success) {
        socket.leave(`terminal:${terminalId}`);
        socket.emit('terminal:killed', { terminalId });
      } else {
        socket.emit('terminal:error', { message: result.error });
      }
    } catch (error) {
      socket.emit('terminal:error', { message: 'Failed to kill terminal' });
    }
  });

  // List user terminals
  socket.on('terminal:list', () => {
    try {
      const userTerminals = terminalManager.getUserTerminals(socket.userId);
      const terminalList = userTerminals.map(terminal => ({
        id: terminal.id,
        cols: terminal.cols,
        rows: terminal.rows,
        shell: terminal.shell,
        createdAt: terminal.createdAt,
        status: terminal.status
      }));

      socket.emit('terminal:list', { terminals: terminalList });
    } catch (error) {
      socket.emit('terminal:error', { message: 'Failed to list terminals' });
    }
  });
});

// Authentication endpoints
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    const result = await authManager.login(username, password);

    if (result.success) {
      res.json({
        success: true,
        token: result.token,
        message: result.message
      });
    } else {
      res.status(401).json({
        error: result.message
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const result = authManager.verifyToken(token);

    if (result.valid) {
      res.json({
        valid: true,
        user: result.decoded
      });
    } else {
      res.status(401).json({
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Protected test endpoint
app.get('/api/protected', authManager.createMiddleware(), (req, res) => {
  res.json({
    message: 'This is a protected endpoint',
    user: req.user
  });
});

app.get('/health', async (req, res) => {
  try {
    const status = await healthChecker.check();
    const httpStatus = status.status === 'healthy' ? 200 : 503;
    res.status(httpStatus).json(status);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      message: error.message
    });
  }
});

// Terminal session management endpoints
app.get('/api/terminals', authManager.createMiddleware(), (req, res) => {
  try {
    const userTerminals = terminalManager.getUserTerminals(req.user.username);
    const terminalList = userTerminals.map(terminal => ({
      id: terminal.id,
      cols: terminal.cols,
      rows: terminal.rows,
      shell: terminal.shell,
      createdAt: terminal.createdAt,
      status: terminal.status
    }));

    res.json({ terminals: terminalList });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list terminals' });
  }
});

app.post('/api/terminals/:id/restore', authManager.createMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await terminalManager.restoreSession(id);
    
    if (result.success) {
      res.json({
        success: true,
        terminalId: result.terminalId,
        restored: result.restored || false
      });
    } else {
      res.status(404).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to restore terminal session' });
  }
});

app.get('/api/stats', authManager.createMiddleware(), (req, res) => {
  try {
    const stats = terminalManager.getStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Web Terminal',
    version: '0.1.0',
    status: 'running',
    endpoints: {
      login: 'POST /api/auth/login',
      verify: 'POST /api/auth/verify',
      protected: 'GET /api/protected',
      terminals: 'GET /api/terminals',
      restore: 'POST /api/terminals/:id/restore',
      stats: 'GET /api/stats',
      health: 'GET /health',
      websocket: 'ws://host/socket.io/'
    }
  });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

const port = process.env.PORT || 3000;

// 只在直接运行时启动服务器，测试时不启动
if (require.main === module) {
  server.listen(port, () => {
    console.log(`Web Terminal Server listening on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`WebSocket endpoint: ws://localhost:${port}/socket.io/`);
  });
}

module.exports = { app, server, io };