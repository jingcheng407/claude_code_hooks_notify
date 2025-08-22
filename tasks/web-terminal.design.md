# Design: Web Terminal (独立网页版终端)

## Requirements

### 核心需求
- **Web终端界面**：基于xterm.js的完整终端体验
- **本地运行**：服务运行在用户本机，通过浏览器访问
- **会话管理**：支持多个终端会话，刷新页面不丢失
- **文件管理**：支持文件上传下载
- **快捷操作**：常用命令快捷按钮、历史命令
- **主题定制**：多种终端主题切换

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

### 核心组件

#### 1. Web服务器 (server.js)
```javascript
const express = require('express');
const { Server } = require('socket.io');
const pty = require('node-pty');
const session = require('express-session');

class WebTerminalServer {
  constructor(port = 3000) {
    this.app = express();
    this.terminals = new Map();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();
  }
  
  setupSocketIO() {
    this.io = new Server(this.server, {
      cors: { origin: "*" }
    });
    
    this.io.on('connection', (socket) => {
      socket.on('create', this.createTerminal.bind(this, socket));
      socket.on('data', this.handleData.bind(this, socket));
      socket.on('resize', this.handleResize.bind(this, socket));
    });
  }
  
  createTerminal(socket, options) {
    const term = pty.spawn(options.shell || 'bash', [], {
      name: 'xterm-color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || process.env.HOME,
      env: process.env
    });
    
    this.terminals.set(socket.id, term);
    
    term.on('data', (data) => {
      socket.emit('data', data);
    });
    
    socket.on('disconnect', () => {
      term.kill();
      this.terminals.delete(socket.id);
    });
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
    #terminal { height: 100vh; }
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
  
  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
  <script>
    const socket = io();
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, monospace'
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();
    
    socket.on('connect', () => {
      socket.emit('create', {
        cols: term.cols,
        rows: term.rows
      });
    });
    
    socket.on('data', (data) => {
      term.write(data);
    });
    
    term.onData((data) => {
      socket.emit('data', data);
    });
    
    window.addEventListener('resize', () => {
      fitAddon.fit();
      socket.emit('resize', {
        cols: term.cols,
        rows: term.rows
      });
    });
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

#### 2. 文件传输
```javascript
// 文件上传
app.post('/upload', multer().single('file'), (req, res) => {
  const targetPath = path.join(req.body.path, req.file.originalname);
  fs.writeFileSync(targetPath, req.file.buffer);
  res.json({ success: true });
});

// 文件下载
app.get('/download', (req, res) => {
  const filePath = req.query.path;
  res.download(filePath);
});
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
  test('应该能创建终端会话', async () => {
    const socket = io('http://localhost:3000');
    
    await new Promise((resolve) => {
      socket.on('connect', resolve);
    });
    
    socket.emit('create', {
      cols: 80,
      rows: 24
    });
    
    const data = await new Promise((resolve) => {
      socket.on('data', resolve);
    });
    
    expect(data).toBeDefined();
  });
  
  test('应该能执行命令', async () => {
    const socket = io('http://localhost:3000');
    
    socket.emit('data', 'echo "test"\n');
    
    const output = await new Promise((resolve) => {
      socket.on('data', (data) => {
        if (data.includes('test')) {
          resolve(data);
        }
      });
    });
    
    expect(output).toContain('test');
  });
});
```

## 部署方案

### 1. 本地模式（开发环境）
```bash
# 安装依赖
npm install

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

## 成功指标

1. **性能指标**
   - 启动时间 < 1秒
   - 命令响应 < 10ms
   - 支持100+并发连接
   - 内存占用 < 100MB

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