# Design: Web Terminal (独立网页版终端)

## Requirements

### 核心需求（Must Have）
- **Web终端界面**：基于xterm.js的完整终端体验，支持颜色、光标、滚动
- **安全认证**：JWT基础认证系统，防暴力破解，会话管理
- **会话持久化**：刷新页面不丢失终端状态，支持断线重连
- **多标签管理**：同时管理多个终端会话，独立状态管理
- **文件沙箱**：安全的文件上传下载，路径限制，防止越权访问
- **性能管理**：背压控制，输出节流，资源限制

### 重要需求（Should Have）
- **主题定制**：多种终端主题切换，持久化偏好设置
- **快捷操作**：常用命令快捷按钮、历史命令、自动补全
- **角色权限**：只读/可控两种权限模式
- **tmux集成**：可选的持久会话支持

### 扩展需求（Nice to Have）
- **协作功能**：多人同时查看终端
- **操作审计**：命令记录和回放
- **文件管理器**：图形化文件浏览
- **监控面板**：系统资源实时监控

### 使用场景
1. **本地开发**：开发者在浏览器中访问本机终端
2. **远程访问**：通过HTTPS安全访问远程服务器终端
3. **教学演示**：分享终端会话供他人观看
4. **批量管理**：同时管理多个终端会话

### 技术优势
- **零安装**：浏览器即可使用，无需客户端
- **跨平台**：支持所有主流操作系统和浏览器
- **低延迟**：本地运行，响应速度快
- **易扩展**：基于Web技术，易于添加新功能

### 与Telegram版本对比
| 特性 | Telegram版 | Web版 |
|------|-----------|------|
| 安装复杂度 | 需要Telegram Bot | 仅需Node.js |
| 访问方式 | Telegram App | 任意浏览器 |
| 认证机制 | Telegram用户ID | 密码/Token |
| 网络要求 | 需要中继服务 | 本地直连 |
| 延迟 | 100-200ms | <10ms |
| 部署难度 | 复杂 | 简单 |

## Solution

### 技术架构

```
┌─────────────────────────────────────┐
│         浏览器 (Client)              │
│  ┌─────────────────────────────┐    │
│  │    xterm.js 终端界面         │    │
│  │    Socket.io 客户端          │    │
│  │    文件管理器                │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
                    ↓ WebSocket
┌─────────────────────────────────────┐
│      Node.js Server (本地)          │
│  ┌─────────────────────────────┐    │
│  │    Express Web服务器         │    │
│  │    Socket.io 服务端          │    │
│  │    node-pty 终端管理         │    │
│  │    Session 管理              │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
                    ↓ PTY
┌─────────────────────────────────────┐
│         系统 Shell/tmux              │
└─────────────────────────────────────┘
```

### 安全架构

#### 认证与授权系统
```javascript
// auth.js - JWT认证系统
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

class AuthManager {
  constructor() {
    this.users = new Map(); // 生产环境应使用数据库
    this.sessions = new Map();
    this.failedAttempts = new Map();
  }
  
  // 用户注册
  async register(username, password, role = 'user') {
    const hashedPassword = await bcrypt.hash(password, 10);
    this.users.set(username, {
      username,
      password: hashedPassword,
      role,
      createdAt: new Date()
    });
  }
  
  // 用户登录（含防暴力破解）
  async login(username, password, ip) {
    // 检查失败次数
    const attempts = this.failedAttempts.get(ip) || 0;
    if (attempts >= 5) {
      throw new Error('Too many failed attempts. Please try again later.');
    }
    
    const user = this.users.get(username);
    if (!user || !await bcrypt.compare(password, user.password)) {
      this.failedAttempts.set(ip, attempts + 1);
      setTimeout(() => this.failedAttempts.delete(ip), 15 * 60 * 1000); // 15分钟后重置
      throw new Error('Invalid credentials');
    }
    
    // 生成JWT
    const token = jwt.sign(
      { username, role: user.role },
      AuthManager.getJWTSecret(),
      { expiresIn: '24h' }
    );
    
    // 创建会话
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      username,
      token,
      createdAt: new Date(),
      lastAccess: new Date()
    });
    
    this.failedAttempts.delete(ip);
    return { token, sessionId };
  }
  
  // 验证Token
  verifyToken(token) {
    try {
      return jwt.verify(token, AuthManager.getJWTSecret());
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
  
  // Socket.IO认证中间件
  socketAuthMiddleware() {
    return (socket, next) => {
      const token = socket.handshake.auth.token;
      try {
        const user = this.verifyToken(token);
        socket.user = user;
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    };
  }
  
  // Express认证中间件
  verifyMiddleware() {
    return (req, res, next) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }
      
      try {
        const user = this.verifyToken(token);
        req.user = user;
        next();
      } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
      }
    };
  }
  
  // 读取JWT密钥（支持从文件读取）
  static getJWTSecret() {
    if (process.env.JWT_SECRET_FILE) {
      const fs = require('fs');
      try {
        return fs.readFileSync(process.env.JWT_SECRET_FILE, 'utf8').trim();
      } catch (error) {
        console.error('Failed to read JWT secret file:', error);
        throw new Error('JWT secret file not accessible');
      }
    }
    
    if (process.env.JWT_SECRET) {
      return process.env.JWT_SECRET;
    }
    
    // 生产环境必须提供密钥
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT secret must be provided in production');
    }
    
    console.warn('WARNING: Using default JWT secret. DO NOT use in production!');
    return 'default-dev-secret-change-this';
  }
}

// 限流配置
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 最多5次尝试
  message: 'Too many login attempts'
});
```

#### 会话持久化管理
```javascript
// session.js - 使用Redis存储会话
const Redis = require('ioredis');
const crypto = require('crypto');

class SessionManager {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    this.terminals = new Map(); // terminalId -> pty
  }
  
  // 创建持久会话
  async createSession(userId) {
    const sessionId = crypto.randomUUID();
    const session = {
      userId,
      terminals: [],
      createdAt: Date.now(),
      lastAccess: Date.now()
    };
    
    await this.redis.setex(
      `session:${sessionId}`,
      24 * 3600, // 24小时过期
      JSON.stringify(session)
    );
    
    return sessionId;
  }
  
  // 创建终端（支持多标签）
  async createTerminal(sessionId, options = {}) {
    const terminalId = crypto.randomUUID();
    const session = await this.getSession(sessionId);
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    // 限制每用户最大终端数
    const maxTerminals = parseInt(process.env.MAX_TERMINALS_PER_USER) || 10;
    if (session.terminals.length >= maxTerminals) {
      throw new Error('Maximum terminals limit reached');
    }
    
    // 根据平台选择默认shell
    const defaultShell = process.platform === 'win32' 
      ? 'powershell.exe' 
      : (process.env.SHELL || '/bin/bash');
    
    // 根据tmux策略决定如何创建终端
    let pty;
    if (process.env.USE_TMUX === 'true' && process.platform !== 'win32') {
      // tmux会话命名策略：按用户ID创建持久会话
      const tmuxSession = `web_${session.userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const tmuxWindow = `win_${terminalId.slice(0, 8)}`;
      
      pty = require('node-pty').spawn(
        'tmux',
        ['new-session', '-A', '-s', tmuxSession, '-n', tmuxWindow],
        {
          name: 'xterm-256color',
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: options.cwd || process.env.HOME,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            LANG: process.env.LANG || 'en_US.UTF-8'
          }
        }
      );
    } else {
      // 直接创建shell
      pty = require('node-pty').spawn(
        options.shell || defaultShell,
        [],
        {
          name: 'xterm-256color',
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: options.cwd || process.env.HOME,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            LANG: process.env.LANG || 'en_US.UTF-8'
          }
        }
      );
    }
    
    // 保存终端映射
    this.terminals.set(terminalId, {
      pty,
      sessionId,
      createdAt: Date.now(),
      lastAccess: Date.now()
    });
    
    // 更新会话
    session.terminals.push(terminalId);
    await this.redis.setex(
      `session:${sessionId}`,
      24 * 3600,
      JSON.stringify(session)
    );
    
    // 保存终端状态（用于恢复）
    await this.redis.setex(
      `terminal:${terminalId}`,
      24 * 3600,
      JSON.stringify({
        sessionId,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd
      })
    );
    
    return { terminalId, pty };
  }
  
  // 恢复终端（页面刷新后）
  async restoreTerminal(terminalId) {
    // 检查是否已在内存中
    if (this.terminals.has(terminalId)) {
      const terminal = this.terminals.get(terminalId);
      terminal.lastAccess = Date.now();
      return terminal;
    }
    
    // 从Redis恢复
    const terminalData = await this.redis.get(`terminal:${terminalId}`);
    if (!terminalData) {
      throw new Error('Terminal not found');
    }
    
    const terminal = JSON.parse(terminalData);
    const session = await this.getSession(terminal.sessionId);
    
    // 如果使用tmux且不是Windows，可以重新附加
    if (process.env.USE_TMUX === 'true' && process.platform !== 'win32') {
      // 重新附加到用户的tmux会话
      const tmuxSession = `web_${session.userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const tmuxWindow = `win_${terminalId.slice(0, 8)}`;
      
      const pty = require('node-pty').spawn(
        'tmux',
        ['attach-session', '-t', `${tmuxSession}:${tmuxWindow}`],
        {
          name: 'xterm-256color',
          cols: terminal.cols,
          rows: terminal.rows,
          cwd: terminal.cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            LANG: process.env.LANG || 'en_US.UTF-8'
          }
        }
      );
      
      this.terminals.set(terminalId, {
        pty,
        sessionId: terminal.sessionId,
        createdAt: terminal.createdAt,
        lastAccess: Date.now()
      });
      
      return { terminalId, pty };
    }
    
    // 否则创建新终端
    return this.createTerminal(terminal.sessionId, terminal);
  }
  
  // 获取会话信息
  async getSession(sessionId) {
    const raw = await this.redis.get(`session:${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  }
  
  // 获取活跃终端数量
  getActiveTerminalCount() {
    return this.terminals.size;
  }
  
  // 清理过期会话
  async cleanupSessions() {
    const idleTimeout = parseInt(process.env.SESSION_IDLE_TIMEOUT) || 1800000; // 30分钟
    
    for (const [terminalId, terminal] of this.terminals) {
      // 空闲超过设定时间的终端
      if (Date.now() - terminal.lastAccess > idleTimeout) {
        terminal.pty.kill();
        this.terminals.delete(terminalId);
        await this.redis.del(`terminal:${terminalId}`);
      }
    }
  }
}
```

### 核心组件

#### 1. Web服务器 (server.js)
```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const crypto = require('crypto');
const fs = require('fs');

class WebTerminalServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.terminals = new Map();
    this.authManager = new AuthManager();
    this.sessionManager = new SessionManager();
    this.fileManager = new FileManager();
    
    // 初始化健康检查器
    const { HealthChecker } = require('./monitoring');
    this.healthChecker = new HealthChecker(
      this.sessionManager.redis,
      this.sessionManager
    );
    
    this.setupSecurity();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
  }
  
  // 启动服务器
  start() {
    this.server.listen(this.port, () => {
      console.log(`Web Terminal Server listening on port ${this.port}`);
      console.log(`Health check: http://localhost:${this.port}/health`);
    });
  }
  
  // 获取CORS配置（DRY原则）
  getCorsOrigins() {
    const origins = process.env.CORS_ORIGINS || 'http://localhost:3000';
    return origins.split(',').map(s => s.trim());
  }
  
  setupSecurity() {
    const helmet = require('helmet');
    
    // 安全头设置
    const useCDN = process.env.USE_CDN === 'true';
    const cdnUrl = 'https://cdn.jsdelivr.net';
    
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'", 
            process.env.NODE_ENV !== 'production' ? "'unsafe-eval'" : undefined,
            useCDN ? cdnUrl : undefined
          ].filter(Boolean),
          styleSrc: ["'self'", "'unsafe-inline'", useCDN ? cdnUrl : undefined].filter(Boolean),
          fontSrc: ["'self'", "data:", useCDN ? cdnUrl : undefined].filter(Boolean),
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));
    
    // CORS配置（使用统一方法）
    this.app.use(require('cors')({
      origin: this.getCorsOrigins(),
      credentials: true
    }));
    
    // 限流
    this.app.use(require('express-rate-limit')({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests'
    }));
  }
  
  setupMiddleware() {
    // 解析请求体
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: false }));
    
    // 静态文件服务
    this.app.use(express.static('public'));
  }
  
  setupRoutes() {
    // 登录路由（使用独立的loginLimiter）
    const loginLimiter = require('express-rate-limit')({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: 'Too many login attempts'
    });
    
    this.app.post('/api/login', loginLimiter, async (req, res) => {
      try {
        const { username, password } = req.body;
        const result = await this.authManager.login(username, password, req.ip);
        res.json(result);
      } catch (error) {
        res.status(401).json({ error: error.message });
      }
    });
    
    // 文件上传
    const upload = this.fileManager.getUploadMiddleware();
    this.app.post('/api/upload', 
      this.authManager.verifyMiddleware(),
      upload.array('files', 10),
      (req, res) => {
        res.json({ success: true, files: req.files });
      }
    );
    
    // 文件下载
    this.app.get('/api/download/*', 
      this.authManager.verifyMiddleware(),
      async (req, res) => {
        try {
          const file = await this.fileManager.downloadFile(
            req.params[0], 
            req.user.username
          );
          res.download(file.path, file.name);
        } catch (error) {
          res.status(404).json({ error: error.message });
        }
      }
    );
    
    // 健康检查路由
    this.app.get('/health', async (req, res) => {
      try {
        const status = await this.healthChecker.check();
        const httpStatus = status.status === 'healthy' ? 200 : 503;
        res.status(httpStatus).json(status);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          message: error.message
        });
      }
    });
  }
  
  setupSocketIO() {
    // 使用统一的CORS配置
    this.io = new Server(this.server, {
      cors: {
        origin: this.getCorsOrigins(),
        credentials: true
      },
      // 性能优化
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
      transports: ['websocket', 'polling']
    });
    
    // 认证中间件 - 创建会话
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        const user = this.authManager.verifyToken(token);
        socket.user = user;
        // 创建会话
        socket.sessionId = await this.sessionManager.createSession(user.username);
        next();
      } catch (error) {
        next(new Error('Authentication failed'));
      }
    });
    
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.user.username} connected`);
      
      socket.on('terminal:create', this.createTerminal.bind(this, socket));
      socket.on('terminal:data', this.handleData.bind(this, socket));
      socket.on('terminal:resize', this.handleResize.bind(this, socket));
      socket.on('terminal:restore', this.restoreTerminal.bind(this, socket));
    });
  }
  
  async createTerminal(socket, options) {
    try {
      // 权限检查
      if (socket.user.role === 'readonly') {
        throw new Error('Read-only users cannot create terminals');
      }
      
      // 创建终端
      const { terminalId, pty } = await this.sessionManager.createTerminal(
        socket.sessionId,
        options
      );
      
      // 设置背压管理（传入terminalId）
      const backpressure = new BackpressureManager(socket, pty, terminalId);
      
      this.terminals.set(terminalId, {
        pty,
        socket,
        backpressure,
        userId: socket.user.username,
        lastAccess: Date.now()
      });
      
      // 发送终端ID给客户端
      socket.emit('terminal:created', { terminalId });
      
      // 处理PTY输出
      pty.on('data', (data) => {
        backpressure.send(data);
      });
      
      // 清理
      socket.on('disconnect', () => {
        backpressure.cleanup();
        // 根据策略决定是否立即清理
        if (process.env.CLEANUP_ON_DISCONNECT === 'true') {
          pty.kill();
          this.terminals.delete(terminalId);
        }
      });
      
    } catch (error) {
      socket.emit('terminal:error', error.message);
    }
  }
  
  handleData(socket, { terminalId, data }) {
    const terminal = this.terminals.get(terminalId);
    
    if (!terminal) {
      socket.emit('terminal:error', 'Terminal not found');
      return;
    }
    
    // 权限检查
    if (socket.user.role === 'readonly') {
      socket.emit('terminal:error', 'Read-only mode');
      return;
    }
    
    // 写入限流（防止恶意输入）
    if (data.length > 1024) {
      socket.emit('terminal:error', 'Input too large');
      return;
    }
    
    // 更新最后访问时间
    terminal.lastAccess = Date.now();
    terminal.pty.write(data);
  }
  
  handleResize(socket, { terminalId, cols, rows }) {
    const terminal = this.terminals.get(terminalId);
    
    if (!terminal) {
      socket.emit('terminal:error', 'Terminal not found');
      return;
    }
    
    // 更新PTY尺寸
    terminal.pty.resize(cols, rows);
    terminal.lastAccess = Date.now();
  }
  
  async restoreTerminal(socket, { terminalId }) {
    try {
      const { pty } = await this.sessionManager.restoreTerminal(terminalId);
      
      // 设置背压管理
      const backpressure = new BackpressureManager(socket, pty, terminalId);
      
      this.terminals.set(terminalId, {
        pty,
        socket,
        backpressure,
        userId: socket.user.username,
        lastAccess: Date.now()
      });
      
      socket.emit('terminal:restored', { terminalId });
      
      // 处理PTY输出
      pty.on('data', (data) => {
        backpressure.send(data);
      });
      
    } catch (error) {
      socket.emit('terminal:error', error.message);
    }
  }
}

// 背压管理器（修正版 - 不使用pty.pause/resume）
class BackpressureManager {
  constructor(socket, pty, terminalId) {
    this.socket = socket;
    this.pty = pty;
    this.terminalId = terminalId;
    this.buffer = [];
    this.bufferSize = 0;
    this.maxBufferSize = parseInt(process.env.BACKPRESSURE_HIGH_WATERMARK) || 16384;
    this.chunkSize = parseInt(process.env.OUTPUT_CHUNK_SIZE) || 4096;
    this.sendInterval = null;
    this.droppedBytes = 0;
    
    this.startSending();
  }
  
  send(data) {
    const dataLength = data.length;
    
    // 检查缓冲区是否会溢出
    if (this.bufferSize + dataLength > this.maxBufferSize) {
      // 丢弃最旧的数据直到有空间
      while (this.buffer.length > 0 && 
             this.bufferSize + dataLength > this.maxBufferSize) {
        const dropped = this.buffer.shift();
        this.bufferSize -= dropped.length;
        this.droppedBytes += dropped.length;
      }
      
      // 如果还是太大，截断当前数据
      if (dataLength > this.maxBufferSize) {
        data = data.slice(-this.maxBufferSize);
        this.droppedBytes += dataLength - this.maxBufferSize;
      }
      
      // 发送警告给客户端
      if (this.droppedBytes > 0) {
        this.socket.emit('terminal:warning', {
          terminalId: this.terminalId,
          message: `Output too fast, dropped ${this.droppedBytes} bytes`
        });
        this.droppedBytes = 0;
      }
    }
    
    // 添加到缓冲区
    this.buffer.push(data);
    this.bufferSize += data.length;
  }
  
  startSending() {
    // 定期发送缓冲数据
    this.sendInterval = setInterval(() => {
      if (this.buffer.length === 0) return;
      
      // 批量发送数据（限制每次发送量）
      let bytesToSend = 0;
      const chunks = [];
      
      while (this.buffer.length > 0 && bytesToSend < this.chunkSize) {
        const data = this.buffer.shift();
        this.bufferSize -= data.length;
        bytesToSend += data.length;
        chunks.push(data);
      }
      
      if (chunks.length > 0) {
        const combined = chunks.join('');
        this.socket.emit('terminal:data', {
          terminalId: this.terminalId,
          data: combined
        });
      }
    }, 16); // ~60fps
  }
  
  cleanup() {
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    this.buffer = [];
    this.bufferSize = 0;
  }
}
```

#### 2. 前端终端 (terminal.html)
```html
<!DOCTYPE html>
<html>
<head>
  <title>Web Terminal</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.css" />
  <style>
    body { margin: 0; padding: 0; background: #1e1e1e; }
    .login-form {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #2d2d2d;
      padding: 20px;
      border-radius: 8px;
      color: white;
    }
    .login-form input {
      display: block;
      margin: 10px 0;
      padding: 8px;
      width: 200px;
    }
    #terminal-container { display: none; height: 100vh; }
    .toolbar { 
      background: #2d2d2d; 
      padding: 10px;
      display: flex;
      gap: 10px;
    }
    .tab { 
      padding: 5px 10px;
      background: #3d3d3d;
      color: white;
      border-radius: 4px;
      cursor: pointer;
    }
    .tab.active { background: #0d7377; }
  </style>
</head>
<body>
  <!-- 登录表单 -->
  <div id="login-container" class="login-form">
    <h3>Web Terminal Login</h3>
    <input type="text" id="username" placeholder="Username" />
    <input type="password" id="password" placeholder="Password" />
    <button onclick="login()">Login</button>
    <div id="error-message" style="color: red;"></div>
  </div>
  
  <!-- 终端界面 -->
  <div id="terminal-container">
    <div class="toolbar">
      <button onclick="newTab()">New Tab</button>
      <button onclick="clearTerminal()">Clear</button>
      <select onchange="changeTheme(this.value)">
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="monokai">Monokai</option>
      </select>
      <div id="tabs"></div>
    </div>
    <div id="terminal"></div>
  </div>
  
  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
  <script>
    let socket = null;
    let authToken = null;
    let terminals = new Map();
    let currentTerminalId = null;
    
    // 登录功能
    async function login() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
          const data = await response.json();
          authToken = data.token;
          
          // 隐藏登录，显示终端
          document.getElementById('login-container').style.display = 'none';
          document.getElementById('terminal-container').style.display = 'block';
          
          // 初始化Socket连接
          initSocket();
        } else {
          const error = await response.json();
          document.getElementById('error-message').textContent = error.error;
        }
      } catch (error) {
        document.getElementById('error-message').textContent = 'Login failed';
      }
    }
    
    // 初始化Socket连接
    function initSocket() {
      socket = io({
        auth: {
          token: authToken
        }
      });
      
      socket.on('connect', () => {
        // 创建第一个终端
        createTerminal();
      });
      
      socket.on('terminal:created', ({ terminalId }) => {
        currentTerminalId = terminalId;
        terminals.set(terminalId, {
          term: createXterm(),
          id: terminalId
        });
      });
      
      socket.on('terminal:restored', ({ terminalId }) => {
        currentTerminalId = terminalId;
        if (!terminals.has(terminalId)) {
          terminals.set(terminalId, {
            term: createXterm(),
            id: terminalId
          });
        }
      });
      
      socket.on('terminal:data', ({ terminalId, data }) => {
        const terminal = terminals.get(terminalId);
        if (terminal) {
          // 总是写入对应终端的缓冲区，不管是否是当前标签
          terminal.term.write(data);
        }
      });
      
      socket.on('terminal:error', (error) => {
        console.error('Terminal error:', error);
      });
      
      socket.on('terminal:warning', ({ message }) => {
        console.warn('Terminal warning:', message);
      });
    }
    
    // 创建xterm实例
    function createXterm() {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Monaco, monospace'
      });
      
      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));
      fitAddon.fit();
      
      term.onData((data) => {
        if (currentTerminalId) {
          socket.emit('terminal:data', {
            terminalId: currentTerminalId,
            data: data
          });
        }
      });
      
      window.addEventListener('resize', () => {
        fitAddon.fit();
        if (currentTerminalId) {
          socket.emit('terminal:resize', {
            terminalId: currentTerminalId,
            cols: term.cols,
            rows: term.rows
          });
        }
      });
      
      return term;
    }
    
    // 创建新终端
    function createTerminal() {
      socket.emit('terminal:create', {
        cols: 80,
        rows: 24
      });
    }
    
    // 新建标签
    function newTab() {
      createTerminal();
    }
    
    // 清屏
    function clearTerminal() {
      const terminal = terminals.get(currentTerminalId);
      if (terminal) {
        terminal.term.clear();
      }
    }
    
    // 切换主题
    function changeTheme(themeName) {
      // 实现主题切换逻辑
    }
  </script>
</body>
</html>
```

#### 3. 会话管理
```javascript
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }
  
  createSession(userId) {
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      userId: userId,
      terminals: [],
      createdAt: new Date(),
      lastAccess: new Date()
    };
    
    this.sessions.set(sessionId, session);
    return sessionId;
  }
  
  attachTerminal(sessionId, terminalId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.terminals.push(terminalId);
      session.lastAccess = new Date();
    }
  }
  
  // tmux集成
  async createTmuxSession(userId) {
    const sessionName = `web_${userId}`;
    const term = pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME,
      env: process.env
    });
    
    return term;
  }
}
```

### 功能特性

#### 1. 多标签支持
- 同时打开多个终端标签
- 标签间快速切换
- 标签持久化和恢复

#### 2. 安全文件传输系统
```javascript
// file-manager.js - 安全的文件操作
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const crypto = require('crypto');

class FileManager {
  constructor() {
    this.BASE_DIR = process.env.FILE_BASE_DIR || process.env.HOME;
    this.MAX_FILE_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE) || 10485760; // 10MB
    // 从环境变量读取允许的文件类型
    const allowedTypes = process.env.ALLOWED_UPLOAD_TYPES || '.txt,.log,.json,.md,.sh,.py,.js,.ts';
    this.ALLOWED_EXTENSIONS = new Set(allowedTypes.split(','));
  }
  
  // 路径安全验证（异步版本）
  async validatePath(userPath) {
    // 规范化路径
    const normalized = path.normalize(userPath);
    const resolved = path.resolve(this.BASE_DIR, normalized);
    
    // 确保路径在BASE_DIR内
    if (!resolved.startsWith(this.BASE_DIR)) {
      throw new Error('Access denied: Path outside allowed directory');
    }
    
    // 检查符号链接（使用异步版本）
    try {
      const realPath = await fs.realpath(resolved);
      if (!realPath.startsWith(this.BASE_DIR)) {
        throw new Error('Access denied: Symlink escape detected');
      }
    } catch (error) {
      // 文件不存在时realpath会失败，这种情况下只检查父目录
      const parentDir = path.dirname(resolved);
      if (fsSync.existsSync(parentDir)) {
        const realParent = await fs.realpath(parentDir);
        if (!realParent.startsWith(this.BASE_DIR)) {
          throw new Error('Access denied: Parent directory outside allowed area');
        }
      }
    }
    
    return resolved;
  }
  
  // 文件上传配置
  getUploadMiddleware() {
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        try {
          const targetDir = await this.validatePath(req.body.path || '');
          await fs.mkdir(targetDir, { recursive: true });
          cb(null, targetDir);
        } catch (error) {
          cb(error);
        }
      },
      filename: (req, file, cb) => {
        // 防止文件名注入
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;
        cb(null, uniqueName);
      }
    });
    
    return multer({
      storage,
      limits: {
        fileSize: this.MAX_FILE_SIZE,
        files: 10 // 最多同时上传10个文件
      },
      fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        
        // 检查文件扩展名
        if (!this.ALLOWED_EXTENSIONS.has(ext)) {
          return cb(new Error(`File type ${ext} not allowed`));
        }
        
        // 检查MIME类型
        if (file.mimetype.includes('executable')) {
          return cb(new Error('Executable files not allowed'));
        }
        
        cb(null, true);
      }
    });
  }
  
  // 安全下载
  async downloadFile(filePath, userId) {
    try {
      const safePath = await this.validatePath(filePath);
      
      // 检查文件是否存在
      const stat = await fs.stat(safePath);
      if (!stat.isFile()) {
        throw new Error('Not a file');
      }
      
      // 审计日志
      console.log(`File download: user=${userId}, file=${safePath}`);
      
      return {
        path: safePath,
        size: stat.size,
        name: path.basename(safePath)
      };
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
  }
  
  // 列出目录内容
  async listDirectory(dirPath, userId) {
    const safePath = await this.validatePath(dirPath);
    const items = await fs.readdir(safePath, { withFileTypes: true });
    
    return items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, item.name)
    }));
  }
}
```

#### 3. 命令历史和自动补全
```javascript
class CommandHistory {
  constructor(maxSize = 1000) {
    this.history = [];
    this.maxSize = maxSize;
    this.currentIndex = -1;
  }
  
  add(command) {
    this.history.push(command);
    if (this.history.length > this.maxSize) {
      this.history.shift();
    }
    this.currentIndex = this.history.length;
  }
  
  getPrevious() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return null;
  }
  
  getNext() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return null;
  }
}
```

#### 4. 主题系统
```javascript
const themes = {
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selection: 'rgba(255, 255, 255, 0.3)',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5'
  },
  light: {
    background: '#ffffff',
    foreground: '#333333',
    // ...
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    // ...
  }
};

function applyTheme(term, themeName) {
  const theme = themes[themeName];
  if (theme) {
    term.setOption('theme', theme);
  }
}
```

## Tests

### 测试计划

1. **单元测试**
   - [ ] PTY创建和管理
   - [ ] WebSocket连接
   - [ ] 会话管理
   - [ ] 文件操作
   - [ ] 认证系统

2. **集成测试**
   - [ ] 端到端连接流程
   - [ ] 多标签管理
   - [ ] tmux会话恢复
   - [ ] 文件上传下载
   - [ ] 主题切换

3. **性能测试**
   - [ ] 大量输出处理
   - [ ] 并发连接数
   - [ ] 内存使用
   - [ ] CPU占用

4. **安全测试**
   - [ ] XSS防护
   - [ ] 路径遍历防护
   - [ ] 会话劫持防护
   - [ ] 命令注入防护

### 测试用例示例
```javascript
describe('Web Terminal', () => {
  let authToken;
  
  beforeAll(async () => {
    // 登录获取token
    const response = await fetch('http://localhost:3000/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testuser',
        password: 'testpass'
      })
    });
    const data = await response.json();
    authToken = data.token;
  });
  
  test('应该能创建终端会话', async () => {
    const socket = io('http://localhost:3000', {
      auth: {
        token: authToken
      }
    });
    
    await new Promise((resolve) => {
      socket.on('connect', resolve);
    });
    
    socket.emit('terminal:create', {
      cols: 80,
      rows: 24
    });
    
    const { terminalId } = await new Promise((resolve) => {
      socket.on('terminal:created', resolve);
    });
    
    expect(terminalId).toBeDefined();
  });
  
  test('应该能执行命令并接收输出', async () => {
    const socket = io('http://localhost:3000', {
      auth: {
        token: authToken
      }
    });
    
    await new Promise((resolve) => {
      socket.on('connect', resolve);
    });
    
    // 创建终端
    socket.emit('terminal:create', {
      cols: 80,
      rows: 24
    });
    
    const { terminalId } = await new Promise((resolve) => {
      socket.on('terminal:created', resolve);
    });
    
    // 发送命令
    socket.emit('terminal:data', {
      terminalId,
      data: 'echo "test"\n'
    });
    
    // 接收输出
    const output = await new Promise((resolve) => {
      socket.on('terminal:data', ({ data }) => {
        if (data.includes('test')) {
          resolve(data);
        }
      });
    });
    
    expect(output).toContain('test');
  });
  
  test('应该能恢复终端会话', async () => {
    const socket = io('http://localhost:3000', {
      auth: {
        token: authToken
      }
    });
    
    // 创建终端
    socket.emit('terminal:create', {
      cols: 80,
      rows: 24
    });
    
    const { terminalId } = await new Promise((resolve) => {
      socket.on('terminal:created', resolve);
    });
    
    // 断开连接
    socket.disconnect();
    
    // 重新连接
    const newSocket = io('http://localhost:3000', {
      auth: {
        token: authToken
      }
    });
    
    await new Promise((resolve) => {
      newSocket.on('connect', resolve);
    });
    
    // 恢复终端
    newSocket.emit('terminal:restore', { terminalId });
    
    const restored = await new Promise((resolve) => {
      newSocket.on('terminal:restored', resolve);
    });
    
    expect(restored.terminalId).toBe(terminalId);
  });
  
  test('应该拒绝无效认证', async () => {
    const socket = io('http://localhost:3000', {
      auth: {
        token: 'invalid-token'
      }
    });
    
    const error = await new Promise((resolve) => {
      socket.on('connect_error', resolve);
    });
    
    expect(error.message).toContain('Authentication failed');
  });
  
  test('应该限制输入大小', async () => {
    const socket = io('http://localhost:3000', {
      auth: {
        token: authToken
      }
    });
    
    // 创建终端
    socket.emit('terminal:create', {
      cols: 80,
      rows: 24
    });
    
    const { terminalId } = await new Promise((resolve) => {
      socket.on('terminal:created', resolve);
    });
    
    // 发送超大输入
    const largeData = 'x'.repeat(2000);
    socket.emit('terminal:data', {
      terminalId,
      data: largeData
    });
    
    const error = await new Promise((resolve) => {
      socket.on('terminal:error', resolve);
    });
    
    expect(error).toContain('Input too large');
  });
  
  test('应该处理文件上传', async () => {
    const formData = new FormData();
    formData.append('files', new Blob(['test content']), 'test.txt');
    formData.append('path', '/uploads');
    
    const response = await fetch('http://localhost:3000/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.files).toHaveLength(1);
  });
  
  test('应该防止路径遍历攻击', async () => {
    const response = await fetch('http://localhost:3000/api/download/../../../etc/passwd', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(response.status).toBe(404);
    const error = await response.json();
    expect(error.error).toContain('Access denied');
  });
});
```

## 部署方案

### 1. 本地模式（开发环境）
```bash
# 安装依赖
npm install

# 创建启动文件 index.js
cat > index.js << 'EOF'
const WebTerminalServer = require('./src/server');

const port = process.env.PORT || 3000;
const server = new WebTerminalServer(port);
server.start();
EOF

# 启动服务
npm start

# 访问 http://localhost:3000
```

### 2. 局域网模式（团队共享）
```bash
# 生成自签名证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365

# 启动HTTPS服务
node server.js --https --host 0.0.0.0

# 访问 https://192.168.x.x:3000
```

### 3. 公网模式（远程访问）
```bash
# 使用nginx反向代理
server {
  listen 443 ssl;
  server_name terminal.example.com;
  
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  
  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

### 4. Docker部署
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## 安全建议

1. **认证和授权**
   - 实施用户登录系统
   - 使用JWT token
   - 设置会话超时

2. **网络安全**
   - 强制使用HTTPS
   - 实施CORS策略
   - 限制访问IP

3. **系统安全**
   - 运行在非root用户
   - 使用Docker隔离
   - 限制可执行命令

4. **审计和监控**
   - 记录所有操作
   - 实时监控异常
   - 定期安全审计

## 扩展功能

### 未来可添加的功能
1. **协作功能**：多人同时查看/操作终端
2. **录制回放**：记录终端会话供回放
3. **代码编辑器**：集成Monaco Editor
4. **文件浏览器**：图形化文件管理
5. **SSH连接**：连接到远程服务器
6. **容器管理**：Docker/Kubernetes集成
7. **监控面板**：系统资源监控
8. **AI助手**：集成Claude API提供命令建议

## 部署架构

### Docker部署配置

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
RUN apk add --no-cache tini
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
```

### Docker Compose配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  web-terminal:
    build: .
    container_name: web-terminal
    restart: unless-stopped
    user: "1001:1001"
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      REDIS_URL: redis://redis:6379
      JWT_SECRET_FILE: /run/secrets/jwt_secret
      BASE_DIR: /workspace
    volumes:
      - ./workspace:/workspace:rw
      - /tmp:/tmp:rw
    secrets:
      - jwt_secret
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - terminal-network
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    container_name: terminal-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    networks:
      - terminal-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis-data:

networks:
  terminal-network:
    driver: bridge

secrets:
  jwt_secret:
    file: ./secrets/jwt_secret.txt
```

### Nginx反向代理配置

```nginx
# /etc/nginx/sites-available/web-terminal
upstream web_terminal {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name terminal.example.com;

    # SSL配置
    ssl_certificate /etc/letsencrypt/live/terminal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/terminal.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # CSP
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data:; connect-src 'self' wss://terminal.example.com; img-src 'self' data:;" always;
    
    # 基础认证（可选额外保护）
    # auth_basic "Restricted Access";
    # auth_basic_user_file /etc/nginx/.htpasswd;
    
    # 限流
    limit_req_zone $binary_remote_addr zone=terminal:10m rate=10r/s;
    limit_req zone=terminal burst=20 nodelay;
    
    # WebSocket配置
    location /socket.io/ {
        proxy_pass http://web_terminal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket超时
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        
        # 缓冲
        proxy_buffering off;
    }
    
    # 静态文件和API
    location / {
        proxy_pass http://web_terminal;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 文件上传限制
        client_max_body_size 10M;
        
        # 缓存静态资源
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            proxy_pass http://web_terminal;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # 健康检查端点
    location /health {
        proxy_pass http://web_terminal;
        access_log off;
    }
}

# HTTP重定向到HTTPS
server {
    listen 80;
    server_name terminal.example.com;
    return 301 https://$server_name$request_uri;
}
```

### 环境变量配置

```bash
# .env.production
NODE_ENV=production
PORT=3000

# Redis
REDIS_URL=redis://redis:6379
REDIS_PASSWORD=strong_redis_password_here
REDIS_SESSION_TTL=86400

# JWT
JWT_SECRET_FILE=/run/secrets/jwt_secret
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# 安全
CORS_ORIGINS=https://terminal.example.com
USE_CDN=false
TRUSTED_PROXIES=127.0.0.1,10.0.0.0/8
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100
BCRYPT_ROUNDS=12

# 会话
MAX_TERMINALS_PER_USER=10
MAX_CONCURRENT_USERS=50
SESSION_IDLE_TIMEOUT=1800000
SESSION_MAX_AGE=86400000
TERMINAL_BUFFER_MAX_SIZE=1048576

# 文件系统
BASE_DIR=/workspace
UPLOAD_MAX_SIZE=10485760
ALLOWED_UPLOAD_TYPES=.txt,.log,.json,.md,.sh,.py,.js,.ts
DOWNLOAD_CHUNK_SIZE=65536

# 性能
BACKPRESSURE_HIGH_WATERMARK=16384
BACKPRESSURE_LOW_WATERMARK=4096
OUTPUT_RATE_LIMIT=1000
OUTPUT_CHUNK_SIZE=4096

# 监控
METRICS_ENABLED=true
METRICS_PORT=9090
LOG_LEVEL=info
LOG_FORMAT=json
SENTRY_DSN=https://xxx@sentry.io/xxx
```

### 监控和日志

```javascript
// src/monitoring.js
const prometheus = require('prom-client');
const winston = require('winston');
const Sentry = require('@sentry/node');

// Prometheus指标
const register = new prometheus.Registry();

const httpDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latencies in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5]
});

const wsConnections = new prometheus.Gauge({
  name: 'websocket_connections_total',
  help: 'Total number of WebSocket connections',
  labelNames: ['type']
});

const terminalSessions = new prometheus.Gauge({
  name: 'terminal_sessions_active',
  help: 'Number of active terminal sessions',
  labelNames: ['user_type']
});

const ptyProcesses = new prometheus.Gauge({
  name: 'pty_processes_total',
  help: 'Total number of PTY processes'
});

const memoryUsage = new prometheus.Gauge({
  name: 'memory_usage_bytes',
  help: 'Process memory usage',
  labelNames: ['type']
});

register.registerMetric(httpDuration);
register.registerMetric(wsConnections);
register.registerMetric(terminalSessions);
register.registerMetric(ptyProcesses);
register.registerMetric(memoryUsage);

// Winston日志配置
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'web-terminal' },
  transports: [
    new winston.transports.File({ 
      filename: '/var/log/web-terminal/error.log', 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: '/var/log/web-terminal/combined.log',
      maxsize: 10485760,
      maxFiles: 10
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Sentry错误追踪
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // 过滤敏感信息
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers?.authorization;
      }
      return event;
    }
  });
}

// 健康检查
class HealthChecker {
  constructor(redisClient, sessionManager) {
    this.redisClient = redisClient;
    this.sessionManager = sessionManager;
    this.diskPath = process.env.BASE_DIR || '/workspace';
  }
  
  async check() {
    const checks = {
      redis: await this.checkRedis(),
      memory: this.checkMemory(),
      disk: await this.checkDisk(),
      terminals: this.checkTerminals()
    };
    
    const healthy = Object.values(checks).every(c => c.status === 'healthy');
    
    return {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks
    };
  }
  
  async checkRedis() {
    try {
      if (!this.redisClient) {
        return { status: 'unhealthy', message: 'Redis client not initialized' };
      }
      await this.redisClient.ping();
      return { status: 'healthy', message: 'Redis connected' };
    } catch (error) {
      return { status: 'unhealthy', message: error.message };
    }
  }
  
  checkMemory() {
    const usage = process.memoryUsage();
    const limit = 512 * 1024 * 1024; // 512MB
    
    if (usage.heapUsed > limit) {
      return { 
        status: 'unhealthy', 
        message: `Memory usage high: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`
      };
    }
    
    return { status: 'healthy', usage: usage.heapUsed };
  }
  
  async checkDisk() {
    try {
      const { execSync } = require('child_process');
      // 使用可配置的路径
      const df = execSync(`df -h ${this.diskPath}`).toString();
      const lines = df.split('\n');
      if (lines.length < 2) {
        return { status: 'unknown', message: 'Unable to parse disk usage' };
      }
      
      const parts = lines[1].split(/\s+/);
      const usageStr = parts[4];
      const usage = parseInt(usageStr);
      
      if (isNaN(usage)) {
        return { status: 'unknown', message: 'Unable to parse disk usage percentage' };
      }
      
      if (usage > 90) {
        return { status: 'unhealthy', message: `Disk usage: ${usage}%` };
      }
      
      return { status: 'healthy', usage: `${usage}%` };
    } catch (error) {
      // 如果df命令失败（如在容器内），返回unknown状态
      return { status: 'unknown', message: `Disk check unavailable: ${error.message}` };
    }
  }
  
  checkTerminals() {
    if (!this.sessionManager) {
      return { status: 'unhealthy', message: 'Session manager not initialized' };
    }
    
    const count = this.sessionManager.getActiveTerminalCount();
    const maxUsers = parseInt(process.env.MAX_CONCURRENT_USERS) || 50;
    const maxTerminalsPerUser = parseInt(process.env.MAX_TERMINALS_PER_USER) || 10;
    const max = maxUsers * maxTerminalsPerUser;
    
    if (count > max * 0.9) {
      return { 
        status: 'unhealthy', 
        message: `Terminal count high: ${count}/${max}` 
      };
    }
    
    return { status: 'healthy', count };
  }
}

module.exports = {
  register,
  logger,
  HealthChecker,
  metrics: {
    httpDuration,
    wsConnections,
    terminalSessions,
    ptyProcesses,
    memoryUsage
  }
};
```

### 部署清单

```bash
#!/bin/bash
# deploy.sh - 生产部署脚本

set -e

echo "=== Web Terminal 部署清单 ==="

# 1. 环境检查
check_requirements() {
  echo "检查系统要求..."
  
  # Node.js版本
  node_version=$(node -v | cut -d'v' -f2)
  if [[ $(echo "$node_version 18.0.0" | awk '{print ($1 >= $2)}') -ne 1 ]]; then
    echo "❌ Node.js版本需要 >= 18.0.0"
    exit 1
  fi
  
  # Docker
  if ! command -v docker &> /dev/null; then
    echo "❌ 需要安装Docker"
    exit 1
  fi
  
  # Redis
  if ! command -v redis-cli &> /dev/null; then
    echo "⚠️  Redis客户端未安装（可选）"
  fi
  
  echo "✅ 环境检查通过"
}

# 2. 配置文件
setup_config() {
  echo "设置配置文件..."
  
  # 创建必要目录
  mkdir -p secrets logs workspace
  
  # 生成JWT密钥
  if [ ! -f secrets/jwt_secret.txt ]; then
    openssl rand -base64 64 > secrets/jwt_secret.txt
    chmod 600 secrets/jwt_secret.txt
    echo "✅ JWT密钥已生成"
  fi
  
  # 复制环境配置
  if [ ! -f .env.production ]; then
    cp .env.example .env.production
    echo "⚠️  请编辑 .env.production 配置文件"
    exit 1
  fi
}

# 3. SSL证书
setup_ssl() {
  echo "配置SSL证书..."
  
  if [ ! -d /etc/letsencrypt/live/terminal.example.com ]; then
    echo "生成Let's Encrypt证书..."
    sudo certbot certonly --nginx -d terminal.example.com
  else
    echo "✅ SSL证书已存在"
  fi
}

# 4. 构建和部署
deploy() {
  echo "开始部署..."
  
  # 拉取最新代码
  git pull origin main
  
  # 构建Docker镜像
  docker-compose build --no-cache
  
  # 数据库迁移（如果有）
  # docker-compose run --rm web-terminal npm run migrate
  
  # 启动服务
  docker-compose up -d
  
  # 等待服务就绪
  echo "等待服务启动..."
  sleep 10
  
  # 健康检查
  if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ 服务部署成功"
  else
    echo "❌ 服务启动失败"
    docker-compose logs --tail=50
    exit 1
  fi
}

# 5. 配置Nginx
setup_nginx() {
  echo "配置Nginx..."
  
  sudo cp nginx/web-terminal.conf /etc/nginx/sites-available/web-terminal
  sudo ln -sf /etc/nginx/sites-available/web-terminal /etc/nginx/sites-enabled/
  
  # 测试配置
  sudo nginx -t
  
  # 重载Nginx
  sudo systemctl reload nginx
  
  echo "✅ Nginx配置完成"
}

# 6. 设置监控
setup_monitoring() {
  echo "配置监控..."
  
  # Prometheus配置
  if [ -f prometheus.yml ]; then
    docker run -d \
      --name prometheus \
      -p 9090:9090 \
      -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
      prom/prometheus
  fi
  
  # 设置日志轮转
  cat > /etc/logrotate.d/web-terminal << EOF
/var/log/web-terminal/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 nodejs nodejs
    sharedscripts
    postrotate
        docker-compose exec -T web-terminal kill -USR1 1
    endscript
}
EOF
  
  echo "✅ 监控配置完成"
}

# 7. 安全加固
security_hardening() {
  echo "执行安全加固..."
  
  # 设置文件权限
  chmod 700 secrets/
  chmod 600 .env.production
  
  # 配置防火墙
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw --force enable
  
  # 设置fail2ban
  cat > /etc/fail2ban/jail.local << EOF
[web-terminal]
enabled = true
port = 443
filter = web-terminal
logpath = /var/log/nginx/access.log
maxretry = 5
bantime = 3600
EOF
  
  echo "✅ 安全加固完成"
}

# 主流程
main() {
  check_requirements
  setup_config
  setup_ssl
  deploy
  setup_nginx
  setup_monitoring
  security_hardening
  
  echo ""
  echo "=== 部署完成 ==="
  echo "访问地址: https://terminal.example.com"
  echo "查看日志: docker-compose logs -f"
  echo "健康检查: curl https://terminal.example.com/health"
  echo "监控面板: http://localhost:9090"
}

# 执行部署
main "$@"
```

### 备份和恢复

```bash
#!/bin/bash
# backup.sh - 备份脚本

BACKUP_DIR="/backup/web-terminal"
DATE=$(date +%Y%m%d_%H%M%S)

# 备份Redis数据
docker-compose exec -T redis redis-cli --rdb /data/dump.rdb
docker cp terminal-redis:/data/dump.rdb $BACKUP_DIR/redis_$DATE.rdb

# 备份工作目录
tar -czf $BACKUP_DIR/workspace_$DATE.tar.gz workspace/

# 备份配置
tar -czf $BACKUP_DIR/config_$DATE.tar.gz .env.production secrets/

# 清理旧备份（保留30天）
find $BACKUP_DIR -type f -mtime +30 -delete

echo "备份完成: $BACKUP_DIR/*_$DATE.*"
```

```bash
#!/bin/bash
# restore.sh - 恢复脚本

if [ -z "$1" ]; then
  echo "Usage: ./restore.sh <backup_date>"
  exit 1
fi

BACKUP_DATE=$1
BACKUP_DIR="/backup/web-terminal"

# 停止服务
docker-compose down

# 恢复Redis
docker-compose up -d redis
docker cp $BACKUP_DIR/redis_$BACKUP_DATE.rdb terminal-redis:/data/dump.rdb
docker-compose restart redis

# 恢复工作目录
tar -xzf $BACKUP_DIR/workspace_$BACKUP_DATE.tar.gz

# 恢复配置
tar -xzf $BACKUP_DIR/config_$BACKUP_DATE.tar.gz

# 重启服务
docker-compose up -d

echo "恢复完成"
```

## 成功指标

1. **性能指标**
   - 启动时间 < 1秒
   - 本地命令响应 < 50ms（P95）
   - 支持100+并发连接
   - 内存占用 < 100MB/连接

2. **用户体验**
   - 安装配置 < 5分钟
   - 界面响应流畅
   - 功能完整易用
   - 文档清晰完善

3. **安全性**
   - 零安全漏洞
   - 通过渗透测试
   - 符合最佳实践
   - 定期更新维护

## 注意事项

### 生产环境必备配置

1. **JWT密钥**：生产环境必须通过`JWT_SECRET_FILE`或`JWT_SECRET`环境变量提供强密钥
2. **HTTPS**：生产环境必须启用HTTPS，配置正确的SSL证书
3. **CDN使用**：如需使用CDN，设置`USE_CDN=true`并确保CSP策略正确
4. **CORS配置**：通过`CORS_ORIGINS`配置允许的源，多个源用逗号分隔
5. **会话清理**：配置`SESSION_IDLE_TIMEOUT`和`CLEANUP_ON_DISCONNECT`策略