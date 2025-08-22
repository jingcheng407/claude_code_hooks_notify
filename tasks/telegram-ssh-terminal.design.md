# Design: Telegram SSH Terminal

## Requirements

将Telegram双向通信从复杂的消息处理方案改为SSH终端方案，让用户通过Telegram Mini App连接到自己的电脑使用Claude Code：

### 核心需求（Must）
- **交互式终端**：通过Telegram Mini App提供可用的交互式终端，支持基本Shell操作、复制粘贴、滚动历史、窗口大小变更
- **会话持久化**：基于tmux的会话持久化，断线重连与会话恢复（移动端切后台/弱网场景）
- **安全认证**：全链路身份认证与授权闭环，确保只有绑定过的Telegram用户能连接自己的机器
- **零私钥外泄**：不将用户私钥持久化在任何第三方服务器，默认不要求用户把私钥交给云端组件
- **NAT穿透**：支持用户主机在NAT背后的连接场景

### 重要需求（Should）
- **断线重连**：移动网络环境下的自动重连和会话恢复
- **性能要求**：终端延迟可接受（< 200ms 典型）
- **多设备支持**：用户的多部手机和多台电脑支持，可在前端选择
- **跨平台兼容**：支持macOS/Linux/Windows三个平台

### 扩展需求（Could）
- **文件传输**：后续通过zmodem/专门端点实现文件上传下载
- **剪贴板同步**：跨设备剪贴板同步
- **键盘工具条**：针对iOS/Android软键盘限制的快捷键工具条

### 明确排除（Won't - V1）
- 多用户共享同一台主机上的同一会话
- 审计与回放功能
- 端侧录屏功能
- WSL/容器内自动渗透

### 使用场景
```
用户A (手机) → Telegram Mini App → 中继服务 → 本地桥接进程 → 电脑A (Claude Code)
用户B (手机) → Telegram Mini App → 中继服务 → 本地桥接进程 → 电脑B (Claude Code)  
用户C (手机) → Telegram Mini App → 中继服务 → 本地桥接进程 → 电脑C (Claude Code)
```

### 技术优势
- **零私钥外泄**：私钥完全留在用户主机，中继无感知
- **点对点连接**：用户直接连接自己的电脑
- **会话持久化**：tmux保持会话状态，断线重连体验好
- **完整Terminal体验**：颜色、光标、快捷键完全支持
- **合规边界清晰**：信任边界明确，安全风险可控

### 现有方案问题
- 消息解析和状态管理复杂
- 多Claude Code实例可能冲突
- 会话上下文无法保持
- 错误处理繁琐
- 无法访问用户自己的开发环境
- 网页刷新后会话状态丢失
- SSH私钥暴露风险高

## Solution

### 核心架构（本地桥接 + 反向中继）

```
手机用户 → Telegram Mini App → 中继服务（无状态） → 本地桥接进程 → 用户电脑Shell/tmux
```

**架构原则：**
- **零私钥外泄**：私钥完全留在用户主机，中继服务无感知
- **本地桥接**：桥接进程运行在用户电脑，直接拉起shell或连接127.0.0.1
- **反向连接**：本地桥接维护出站WSS/WebRTC通道，穿透NAT
- **无状态中继**：仅负责字节流路由，不存储用户敏感数据
- **tmux会话持久化**：断线重连后自动恢复到原会话状态

### 安全认证闭环
- **Telegram认证**：基于initData生成auth_token（含user_id、过期时间、HMAC-SHA256签名）
- **本地授权**：本地桥接在首次绑定时记录允许的Telegram user_id
- **会话验证**：每次连接校验auth_token有效性和用户绑定关系

### 技术组件

#### 1. 本地桥接进程

```javascript
// 本地桥接进程（运行在用户电脑，零私钥外泄）
class LocalBridge {
  constructor(config) {
    this.userId = null;
    this.allowedTelegramUsers = new Set(); // 已绑定的Telegram用户
    this.relayConnection = null;
    this.ptyProcess = null;
    this.config = config;
  }
  
  async connectToRelay() {
    // 维护到中继服务的反向连接（穿透NAT）
    this.relayConnection = new WebSocket(this.config.relayUrl);
    
    this.relayConnection.on('open', () => {
      console.log('已连接到中继服务');
      // 注册设备
      this.relayConnection.send(JSON.stringify({
        type: 'register_device',
        deviceId: this.config.deviceId
      }));
    });
    
    this.relayConnection.on('message', async (data) => {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'client_connect':
          await this.handleClientConnection(message);
          break;
        case 'terminal_data':
          if (this.ptyProcess) {
            this.ptyProcess.write(message.data);
          }
          break;
        case 'resize':
          if (this.ptyProcess) {
            this.ptyProcess.resize(message.cols, message.rows);
          }
          break;
      }
    });
  }
  
  async handleClientConnection(message) {
    // 验证Telegram用户授权
    if (!await this.verifyTelegramAuth(message.authToken)) {
      this.relayConnection.send(JSON.stringify({
        type: 'auth_failed',
        connectionId: message.connectionId
      }));
      return;
    }
    
    // 启动本地pty进程（不涉及SSH私钥）
    this.ptyProcess = require('node-pty').spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
      name: 'xterm-color',
      cols: message.cols || 80,
      rows: message.rows || 24,
      cwd: this.config.workDir || process.env.HOME,
      env: { ...process.env, CC_HOOKS_NOTIFY: 'on', TERM: 'screen-256color' }
    });
    
    // 自动启动或恢复tmux会话
    const sessionName = `claude_${message.telegramUserId}`;
    this.ptyProcess.write(`tmux new-session -A -s "${sessionName}"\n`);
    
    // 设置双向数据转发
    this.ptyProcess.onData((data) => {
      this.relayConnection.send(JSON.stringify({
        type: 'terminal_data',
        connectionId: message.connectionId,
        data: data
      }));
    });
    
    this.relayConnection.send(JSON.stringify({
      type: 'connection_ready',
      connectionId: message.connectionId
    }));
  }
  
  async verifyTelegramAuth(authToken) {
    try {
      // 验证Telegram WebApp initData签名
      const { userId, hash, authDate } = this.parseTelegramAuth(authToken);
      const expectedHash = this.calculateTelegramHash(userId, authDate);
      
      if (hash !== expectedHash) return false;
      if (Date.now() - authDate * 1000 > 3600 * 1000) return false; // 1小时过期
      
      return this.allowedTelegramUsers.has(userId);
    } catch (error) {
      console.error('Auth verification failed:', error);
      return false;
    }
  }
}
```

#### 2. 中继服务（无状态）

```javascript
// 中继服务（纯字节流路由，不接触私钥）
class RelayService {
  constructor() {
    this.connections = new Map(); // connectionId -> {client, device}
    this.devices = new Map(); // deviceId -> WebSocket
  }
  
  handleDeviceConnection(ws, message) {
    this.devices.set(message.deviceId, ws);
    console.log(`设备已注册: ${message.deviceId}`);
    
    ws.on('close', () => {
      this.devices.delete(message.deviceId);
    });
  }
  
  handleClientConnection(clientWs, message) {
    const { deviceId, authToken } = message;
    const deviceWs = this.devices.get(deviceId);
    
    if (!deviceWs) {
      clientWs.close(1002, 'Device not found');
      return;
    }
    
    const connectionId = this.generateConnectionId();
    this.connections.set(connectionId, {
      client: clientWs,
      device: deviceWs
    });
    
    // 转发连接请求到设备（包含authToken用于验证）
    deviceWs.send(JSON.stringify({
      type: 'client_connect',
      connectionId,
      authToken,
      cols: message.cols,
      rows: message.rows,
      telegramUserId: this.extractTelegramUserId(authToken)
    }));
    
    // 设置双向数据转发
    this.setupDataForwarding(connectionId, clientWs, deviceWs);
  }
  
  setupDataForwarding(connectionId, clientWs, deviceWs) {
    // 客户端 → 设备
    clientWs.on('message', (data) => {
      const message = JSON.parse(data);
      deviceWs.send(JSON.stringify({
        ...message,
        connectionId
      }));
    });
    
    // 设备 → 客户端（只转发对应连接的数据）
    const originalDeviceHandler = deviceWs.onmessage;
    deviceWs.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.connectionId === connectionId) {
        clientWs.send(JSON.stringify(message));
      } else if (originalDeviceHandler) {
        originalDeviceHandler(event);
      }
    };
    
    // 清理连接
    const cleanup = () => {
      this.connections.delete(connectionId);
    };
    
    clientWs.on('close', cleanup);
    deviceWs.on('close', cleanup);
  }
}
```

#### 3. Telegram Mini App前端

```javascript
// 前端终端客户端（零私钥传输）
const connectToDevice = async (deviceId) => {
  const ws = new WebSocket('wss://relay.example.com/client');
  
  ws.onopen = async () => {
    // 生成Telegram认证token（不包含私钥信息）
    const authToken = await generateTelegramAuthToken();
    
    ws.send(JSON.stringify({
      type: 'connect_device',
      deviceId: deviceId,
      authToken: authToken,
      cols: term.cols,
      rows: term.rows
    }));
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
      case 'connection_ready':
        term.write('\r\n✅ 已连接到您的电脑\r\n');
        term.write('🔄 正在恢复会话状态...\r\n\r\n');
        break;
        
      case 'terminal_data':
        term.write(message.data);
        break;
        
      case 'auth_failed':
        term.write('\r\n❌ 认证失败，请检查设备绑定\r\n');
        break;
    }
  };
  
  // 终端输入处理
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'terminal_data',
        data: data
      }));
    }
  });
  
  // 窗口大小变更
  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: cols,
        rows: rows
      }));
    }
  });
};

// 生成Telegram认证token
async function generateTelegramAuthToken() {
  const initData = Telegram.WebApp.initData;
  const urlParams = new URLSearchParams(initData);
  
  return {
    userId: urlParams.get('user'),
    hash: urlParams.get('hash'),
    authDate: urlParams.get('auth_date'),
    queryId: urlParams.get('query_id')
  };
}
```

#### 4. 设备配置数据结构

```javascript
// 存储在用户设备本地的配置
const deviceConfig = {
  deviceId: "dev_abc123",                    // 设备唯一标识
  deviceName: "MacBook Pro - Work",         // 用户友好的设备名称
  workDir: "/Users/jingcheng407/projects",  // 默认工作目录
  relayUrl: "wss://relay.example.com/device", // 中继服务地址
  allowedTelegramUsers: ["123456789"],      // 允许连接的Telegram用户ID
  maxConnections: 5,                        // 最大并发连接数
  sessionPersistent: true,                  // 启用tmux会话持久化
  autoReconnect: true                       // 自动重连到中继服务
};

// 存储在Mini App本地的设备列表
const userDevices = [
  {
    deviceId: "dev_abc123",
    name: "MacBook Pro - Work",
    lastSeen: "2025-01-20T10:30:00Z",
    status: "online", // online/offline
    platform: "macOS"
  },
  {
    deviceId: "dev_def456",
    name: "Ubuntu Server - Home",
    lastSeen: "2025-01-19T22:15:00Z", 
    status: "offline",
    platform: "Linux"
  }
];
```

#### 5. 改进的tmux集成

```bash
# 修正的tmux启动/恢复命令
tmux new-session -A -s "claude_${userId}"

# 设置终端环境
export TERM=screen-256color
export CC_HOOKS_NOTIFY=on
stty -ixon  # 禁用XON/XOFF流控制

# 窗口大小自适应
printf '\033[8;%d;%dt' $LINES $COLUMNS
```

### TDD实施方案

#### 阶段1: 本地桥接进程测试 (1周)

**测试驱动开发：**

```python
# tests/test_local_bridge.py
import pytest
import asyncio
from unittest.mock import Mock, patch, MagicMock

class TestLocalBridge:
    """本地桥接进程核心功能测试"""
    
    def test_config_loading(self):
        """测试配置文件加载"""
        with patch('builtins.open', mock_open(read_data='{"device_id": "test123"}')):
            bridge = LocalTerminalBridge('test_config.json')
            assert bridge.device_id == "test123"
            assert bridge.relay_url is not None
    
    @pytest.mark.asyncio
    async def test_relay_connection_with_retry(self):
        """测试中继服务连接和重试机制"""
        bridge = LocalTerminalBridge()
        
        with patch('websockets.connect') as mock_connect:
            # 模拟第一次连接失败，第二次成功
            mock_connect.side_effect = [
                Exception("Connection failed"),
                MagicMock()
            ]
            
            # 运行连接（会重试）
            await bridge.connect_to_relay()
            
            # 验证重试逻辑
            assert mock_connect.call_count >= 2
    
    def test_telegram_auth_verification(self):
        """测试Telegram用户授权验证"""
        bridge = LocalTerminalBridge()
        bridge.allowed_users = {'123456'}
        
        # 测试授权用户
        auth_token = self.create_auth_token('123456')
        assert bridge.verify_telegram_auth(auth_token) is True
        
        # 测试未授权用户
        auth_token = self.create_auth_token('999999')
        assert bridge.verify_telegram_auth(auth_token) is False
    
    @pytest.mark.asyncio
    async def test_terminal_session_creation(self):
        """测试终端会话创建和tmux集成"""
        bridge = LocalTerminalBridge()
        
        with patch('subprocess.Popen') as mock_popen:
            mock_process = Mock()
            mock_process.poll.return_value = None
            mock_popen.return_value = mock_process
            
            # 创建会话
            await bridge.create_terminal_session('user123')
            
            # 验证tmux命令格式正确
            call_args = mock_popen.call_args[0][0]
            assert 'tmux new-session -A -s "claude_user123"' in ' '.join(call_args)
```

**最小可行实现：**

```python
# local_bridge.py - 本地桥接进程最小实现
import asyncio
import websockets
import json
import os
import pty
import subprocess
import select
import termios
import struct
import fcntl
import signal
from pathlib import Path

class LocalTerminalBridge:
    """本地终端桥接进程 - 零私钥外泄架构"""
    
    def __init__(self, config_file='bridge_config.json'):
        self.config = self.load_config(config_file)
        self.relay_url = self.config.get('relay_url', 'wss://relay.example.com/device')
        self.device_id = self.config.get('device_id')
        self.allowed_users = set(self.config.get('allowed_telegram_users', []))
        self.sessions = {}  # telegram_user_id -> pty_fd
        self.running = True
        
    def load_config(self, config_file):
        """加载配置文件"""
        config_path = Path(config_file)
        if config_path.exists():
            with open(config_path) as f:
                return json.load(f)
        return {}
        
    async def start(self):
        """启动桥接服务"""
        print(f"本地桥接启动: 设备ID={self.device_id}")
        await self.connect_to_relay()
        
    async def connect_to_relay(self):
        """维护到中继服务的持久连接"""
        while self.running:
            try:
                async with websockets.connect(self.relay_url) as websocket:
                    print(f"已连接到中继服务: {self.relay_url}")
                    await self.register_device(websocket)
                    await self.handle_relay_messages(websocket)
            except Exception as e:
                print(f"连接中继失败: {e}, 5秒后重试...")
                await asyncio.sleep(5)
                
    async def register_device(self, websocket):
        """向中继服务注册设备"""
        await websocket.send(json.dumps({
            'type': 'device_register',
            'device_id': self.device_id,
            'platform': os.uname().sysname,
            'status': 'online'
        }))
        
    async def handle_relay_messages(self, websocket):
        """处理来自中继的消息"""
        async for message in websocket:
            data = json.loads(message)
            
            if data['type'] == 'client_connect':
                # 验证Telegram用户权限
                if self.verify_auth(data.get('auth_token')):
                    await self.create_terminal_session(
                        websocket,
                        data.get('connection_id'),
                        data.get('telegram_user_id')
                    )
                else:
                    await websocket.send(json.dumps({
                        'type': 'auth_failed',
                        'connection_id': data.get('connection_id')
                    }))
                    
            elif data['type'] == 'terminal_data':
                # 转发输入到终端
                await self.write_to_terminal(
                    data.get('connection_id'),
                    data.get('data')
                )
                
    def verify_auth(self, auth_token):
        """验证Telegram认证（简化版）"""
        # TODO: 实现完整的Telegram initData验证
        return True
        
    async def create_terminal_session(self, websocket, connection_id, user_id):
        """创建终端会话"""
        # 使用pty创建伪终端
        master_fd, slave_fd = pty.openpty()
        
        # 启动tmux会话
        session_name = f"claude_{user_id}"
        process = subprocess.Popen(
            ['tmux', 'new-session', '-A', '-s', session_name],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            preexec_fn=os.setsid
        )
        
        # 保存会话
        self.sessions[connection_id] = {
            'master_fd': master_fd,
            'process': process,
            'user_id': user_id
        }
        
        # 发送连接成功
        await websocket.send(json.dumps({
            'type': 'connection_ready',
            'connection_id': connection_id
        }))
        
        # 启动输出读取任务
        asyncio.create_task(
            self.read_terminal_output(websocket, connection_id, master_fd)
        )
        
    async def read_terminal_output(self, websocket, connection_id, master_fd):
        """读取终端输出并发送到客户端"""
        loop = asyncio.get_event_loop()
        
        while connection_id in self.sessions:
            try:
                # 非阻塞读取
                output = await loop.run_in_executor(
                    None,
                    os.read,
                    master_fd,
                    1024
                )
                
                if output:
                    await websocket.send(json.dumps({
                        'type': 'terminal_data',
                        'connection_id': connection_id,
                        'data': output.decode('utf-8', errors='replace')
                    }))
            except:
                break
                
    async def write_to_terminal(self, connection_id, data):
        """写入数据到终端"""
        session = self.sessions.get(connection_id)
        if session:
            os.write(session['master_fd'], data.encode())

# 主程序入口
if __name__ == '__main__':
    bridge = LocalTerminalBridge()
    asyncio.run(bridge.start())
```

#### 阶段2: 前端SSH客户端 (1-2周)

**SSH配置管理组件：**

```typescript
// components/SSHConfig.tsx
import React, { useState, useEffect } from 'react';

interface SSHConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKey: string;
  publicKey: string;
  userId: string;
  workDir?: string;
  sessionPersistent: boolean;
}

export const SSHConfigManager: React.FC = () => {
  const [configs, setConfigs] = useState<SSHConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<SSHConfig | null>(null);
  const [showNewConfig, setShowNewConfig] = useState(false);

  useEffect(() => {
    loadSSHConfigs();
  }, []);

  const loadSSHConfigs = async () => {
    try {
      const savedConfigs = await Telegram.WebApp.SecureStorage.getItem('ssh_configs');
      if (savedConfigs) {
        setConfigs(JSON.parse(savedConfigs));
      }
    } catch (error) {
      console.error('加载SSH配置失败:', error);
    }
  };

  const saveSSHConfigs = async (newConfigs: SSHConfig[]) => {
    try {
      await Telegram.WebApp.SecureStorage.setItem('ssh_configs', JSON.stringify(newConfigs));
      setConfigs(newConfigs);
    } catch (error) {
      console.error('保存SSH配置失败:', error);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>SSH连接管理</h2>
      
      {configs.length === 0 ? (
        <div style={{ textAlign: 'center', margin: '40px 0' }}>
          <p>还没有配置SSH连接</p>
          <button onClick={() => setShowNewConfig(true)}>
            添加第一个SSH连接
          </button>
        </div>
      ) : (
        <div>
          {configs.map(config => (
            <SSHConfigCard 
              key={config.id}
              config={config}
              onSelect={() => setSelectedConfig(config)}
            />
          ))}
          
          <button onClick={() => setShowNewConfig(true)}>
            + 添加新的SSH连接
          </button>
        </div>
      )}
      
      {selectedConfig && (
        <SSHTerminal 
          config={selectedConfig}
          onClose={() => setSelectedConfig(null)}
        />
      )}
    </div>
  );
};
```

#### 阶段3: 终端组件集成 (1周)

**SSH终端组件：**

```typescript
// components/SSHTerminal.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

export const SSHTerminal: React.FC<Props> = ({ config, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  const connectSSH = (term: Terminal) => {
    setStatus('connecting');
    
    // 连接到WebSocket桥接服务
    const websocket = new WebSocket('wss://your-bridge-server.com/ssh');
    
    websocket.onopen = () => {
      // 发送SSH配置（包含会话持久化信息）
      websocket.send(JSON.stringify({
        type: 'ssh_config',
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey: config.privateKey,
        userId: config.userId,
        workDir: config.workDir,
        sessionPersistent: config.sessionPersistent
      }));
    };
    
    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'connected':
          setStatus('connected');
          term.write('\r\n✅ SSH连接成功！\r\n');
          if (config.sessionPersistent) {
            term.write('🔄 正在恢复会话状态...\r\n');
          }
          break;
          
        case 'terminal_data':
          term.write(message.data);
          break;
          
        case 'error':
          setStatus('error');
          term.write(`\r\n❌ 连接错误: ${message.message}\r\n`);
          break;
      }
    };

    // 终端输入处理
    term.onData((data) => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
          type: 'terminal_data',
          data: data
        }));
      }
    });

    setWs(websocket);
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column' }}>
      {/* 状态栏 */}
      <div style={{ 
        padding: '10px', 
        backgroundColor: '#2d2d2d', 
        color: 'white', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>🟢 已连接到 {config.host}</span>
        <button onClick={onClose}>关闭</button>
      </div>
      
      {/* 终端区域 */}
      <div ref={terminalRef} style={{ flex: 1 }} />
    </div>
  );
};
```

## Tests

### 测试计划和TDD实现

#### 1. 单元测试 - 本地桥接进程

```python
# test_local_bridge_unit.py
import pytest
from unittest.mock import Mock, patch, AsyncMock
import json

class TestLocalBridgeUnit:
    """本地桥接进程单元测试"""
    
    def test_config_validation(self):
        """测试配置验证"""
        # 测试必需字段缺失
        with pytest.raises(ValueError, match="device_id is required"):
            bridge = LocalTerminalBridge()
            bridge.validate_config({})
            
        # 测试有效配置
        valid_config = {
            'device_id': 'test123',
            'relay_url': 'wss://relay.example.com',
            'allowed_telegram_users': ['123456']
        }
        bridge = LocalTerminalBridge()
        assert bridge.validate_config(valid_config) is True
    
    @pytest.mark.asyncio
    async def test_websocket_reconnection(self):
        """测试WebSocket断线重连"""
        bridge = LocalTerminalBridge()
        
        with patch('websockets.connect') as mock_connect:
            # 模拟连接失败后成功
            mock_connect.side_effect = [
                Exception("Connection lost"),
                AsyncMock()
            ]
            
            await bridge.connect_to_relay()
            assert mock_connect.call_count == 2
    
    def test_telegram_auth_hmac(self):
        """测试Telegram HMAC验证"""
        from telegram_auth import TelegramAuth
        
        auth = TelegramAuth('test_bot_token')
        
        # 构造有效的initData
        valid_data = self.create_valid_init_data()
        is_valid, user_id = auth.verify_init_data(valid_data)
        assert is_valid is True
        
        # 测试篡改数据
        tampered_data = valid_data.replace('user_id=123456', 'user_id=999999')
        is_valid, _ = auth.verify_init_data(tampered_data)
        assert is_valid is False
```

#### 2. 集成测试 - 端到端流程

```python
# test_integration_e2e.py
import pytest
import asyncio
import websockets

class TestE2EIntegration:
    """端到端集成测试"""
    
    @pytest.mark.asyncio
    async def test_complete_connection_flow(self):
        """测试完整连接流程"""
        # 启动测试中继服务
        relay_server = await self.start_test_relay()
        
        # 启动本地桥接
        bridge = LocalTerminalBridge('test_config.json')
        bridge_task = asyncio.create_task(bridge.start())
        
        # 等待桥接注册
        await asyncio.sleep(1)
        
        # 模拟Telegram客户端
        client_ws = await websockets.connect('ws://localhost:8080/client')
        
        # 发送连接请求
        await client_ws.send(json.dumps({
            'type': 'connect',
            'device_id': 'test_device',
            'auth_token': self.create_valid_auth_token(),
            'telegram_user_id': '123456'
        }))
        
        # 验证连接响应
        response = await asyncio.wait_for(client_ws.recv(), timeout=5)
        data = json.loads(response)
        assert data['type'] == 'connection_ready'
        
        # 测试命令执行
        await client_ws.send(json.dumps({
            'type': 'terminal_data',
            'data': 'echo "Hello Terminal"\n'
        }))
        
        # 验证输出
        response = await asyncio.wait_for(client_ws.recv(), timeout=5)
        data = json.loads(response)
        assert 'Hello Terminal' in data.get('data', '')
        
        # 清理
        await client_ws.close()
        bridge_task.cancel()
```

#### 3. 性能测试

```python
# test_performance.py
import pytest
import time
import statistics

class TestPerformance:
    """性能基准测试"""
    
    @pytest.mark.benchmark
    def test_terminal_latency(self, benchmark):
        """测试终端响应延迟"""
        bridge = LocalTerminalBridge()
        
        def measure_latency():
            start = time.time()
            # 发送命令并等待响应
            bridge.send_command("echo test")
            response = bridge.wait_for_response()
            return (time.time() - start) * 1000  # 转换为毫秒
        
        # 运行多次测试
        latencies = [measure_latency() for _ in range(100)]
        
        # 验证延迟要求
        avg_latency = statistics.mean(latencies)
        p95_latency = statistics.quantiles(latencies, n=20)[18]  # 95th percentile
        
        assert avg_latency < 200, f"平均延迟 {avg_latency}ms 超过200ms"
        assert p95_latency < 300, f"P95延迟 {p95_latency}ms 超过300ms"
    
    @pytest.mark.stress
    def test_concurrent_sessions(self):
        """测试并发会话处理"""
        bridge = LocalTerminalBridge()
        
        async def create_session(user_id):
            return await bridge.create_terminal_session(f"user_{user_id}")
        
        # 创建100个并发会话
        tasks = [create_session(i) for i in range(100)]
        sessions = asyncio.run(asyncio.gather(*tasks))
        
        # 验证所有会话创建成功
        assert len(sessions) == 100
        assert all(s is not None for s in sessions)
```

#### 4. 安全测试

```python
# test_security.py
import pytest

class TestSecurity:
    """安全验证测试"""
    
    def test_no_private_key_transmission(self):
        """验证私钥不会传输到中继"""
        with patch('websockets.connect') as mock_ws:
            bridge = LocalTerminalBridge()
            bridge.connect_to_relay()
            
            # 检查所有发送的消息
            sent_messages = [
                call.args[0] for call in mock_ws.return_value.send.call_args_list
            ]
            
            # 确保没有消息包含私钥关键字
            for msg in sent_messages:
                assert 'private_key' not in msg.lower()
                assert 'ssh-rsa' not in msg
                assert 'BEGIN PRIVATE KEY' not in msg
    
    def test_session_isolation(self):
        """测试会话隔离"""
        bridge = LocalTerminalBridge()
        
        # 创建两个用户会话
        session1 = bridge.create_terminal_session('user1')
        session2 = bridge.create_terminal_session('user2')
        
        # 在session1写入数据
        bridge.write_to_terminal(session1, 'echo "secret1" > /tmp/test1')
        
        # 尝试从session2读取
        output = bridge.read_from_terminal(session2, 'cat /tmp/test1')
        
        # 验证session2无法访问session1的tmux会话
        assert 'secret1' not in output
```

### 测试执行计划

| 测试类型 | 测试数量 | 执行频率 | 通过标准 |
|---------|---------|---------|---------|
| 单元测试 | 30+ | 每次提交 | 100%通过 |
| 集成测试 | 10+ | 每次PR | 100%通过 |
| 性能测试 | 5+ | 每日 | 延迟<200ms |
| 安全测试 | 8+ | 每次发布 | 零安全漏洞 |
| 手动测试 | 完整流程 | 每次发布 | 用户验收 |

## Timeline

| 阶段 | 时间 | 主要任务 | 交付物 |
|------|------|----------|--------|
| **阶段1** | 1周 | 中继服务+本地桥接PoC | 可工作的本地桥接和中继路由 |
| **阶段2** | 1-2周 | Mini App终端UI+认证 | 设备管理界面和认证闭环 |
| **阶段3** | 1周 | 稳定性和弱网优化 | 重连机制和系统服务集成 |
| **阶段4** | 1周 | 文档、监控和验收 | 生产就绪版本和安装脚本 |

**总计: 4-5周**

## 成功指标

### 安全指标（零容忍）
1. **零私钥外泄**: 私钥完全不离开用户主机或浏览器本地加密存储
2. **授权正确**: 未绑定的Telegram账号无法连接目标主机
3. **会话隔离**: 不同用户的会话完全隔离，无数据泄露

### 功能指标
4. **连接成功率**: >95%的本地桥接连接能成功建立
5. **响应延迟**: 终端操作响应时间<200ms（4G/5G场景）
6. **稳定性**: 连续使用1小时无断线
7. **断线恢复**: 息屏/切应用5分钟内返回能自动恢复到原tmux会话
8. **用户体验**: 设备绑定和配置流程<5分钟完成
9. **跨平台兼容**: 支持macOS/Linux/Windows三个平台
10. **状态恢复**: Claude Code环境变量和工作目录正确恢复

## 安全考虑

### 核心安全原则
- **零信任架构**: 默认假设中继服务不可信，私钥永不离开用户控制范围
- **端到端安全**: 仅在用户主机和Telegram Mini App之间建立信任关系
- **最小权限**: 中继服务仅具备字节流路由权限，无法解析终端内容

### 具体安全措施
- **传输加密**: WebSocket over TLS (WSS) + Telegram WebApp安全上下文
- **身份认证**: 基于Telegram initData的HMAC-SHA256签名验证
- **授权控制**: 本地桥接维护允许的Telegram用户白名单
- **密钥安全**: 无SSH私钥传输，使用本地pty直接拉起shell
- **会话隔离**: tmux会话按Telegram用户ID隔离，确保完全独立
- **审计能力**: 本地桥接可选记录连接日志（不记录终端内容）
- **反向连接**: NAT穿透通过出站连接实现，降低攻击面
- **有限暴露**: 中继服务仅暴露WebSocket端点，无其他攻击向量

---

## 需求评审与改进建议

本节对上述目标与方案进行“需求审视 + 风险评估 + 架构对照”，给出可落地的改进路径与明确的验收边界。

### 需求澄清（Must/Should/Could/Won’t）

- Must: 通过 Telegram Mini App 提供“可用的交互式终端”，支持基本 Shell 操作、复制粘贴、滚动历史、窗口大小变更、会话持久化（tmux）。
- Must: 全链路身份认证与授权闭环，确保“只有绑定过的 Telegram 用户”能连上“自己的机器”。
- Must: 不将用户私钥持久化在任何第三方服务器；默认不要求用户把私钥交给云端组件。
- Should: 断线重连与会话恢复（移动端切后台/弱网场景）；终端延迟可接受（< 200ms 典型）。
- Should: 多设备支持（用户 A 的多部手机）与多主机支持（用户的多台电脑），可在前端选择。
- Could: 文件上传/下载（后续用 zmodem/专门端点）；剪贴板同步；快捷键工具条（iOS/Android 软键盘受限）。
- Won’t (V1): 多用户共享同一台主机上的同一会话；审计与回放；端侧录屏；WSL/容器内自动渗透（留待后续）。

### 关键风险与对策（Think hard）

- 私钥暴露风险：现有草案将 `privateKey` 从前端发送至桥接服务。若桥接在云端，此路径高风险（服务端可窥私钥）。
  - 对策A（推荐）：桥接进程部署在“用户本机”，Mini App 通过“反向隧道/中继”仅做字节流转发，私钥/登录过程仅在本机完成。
  - 对策B：完全避开 SSH，改为“本机 pty 直连”（spawn 登录用户的 shell），终端体验等同 SSH，但省去密钥学；配合中继通道。
  - 对策C：若必须服务端 SSH，则要求“临时会话密钥/证书”（短时、一次性），并通过远端 HSM/密钥代理实现不可导出；V1 不推荐。

- Telegram Mini App 存储能力：Telegram WebApp 并无官方“SecureStorage”概念，只有 CloudStorage（并非 E2E）与浏览器本地存储（受端限制）。
  - 对策：私钥如需在端存储，使用 WebCrypto 生成 Ed25519/RS256，采用 PBKDF2 + AES-GCM 本地加密，仅存于 IndexedDB；默认不上传 CloudStorage。

- NAT 穿透/外网可达性：手机在公网，用户主机常在 NAT 背后。
  - 对策：提供一键“本地桥接 + 反向隧道”方案（cloudflared/caddy tunnel/frp/自建中继），桥接维持向外的 WSS/WebRTC 出站连接。

- tmux 会话恢复命令存在逻辑问题：`tmux new-session -d -s name || tmux attach -t name` 在“新建成功”时不会 attach。
  - 修正：优先使用 `tmux new-session -A -s name` 或 `tmux attach -t name || tmux new -s name`。

- 端侧键盘/IME兼容：iOS/Android 下 Ctrl/Alt、多组合键、中文输入法上屏等会受限。
  - 对策：提供常用按键工具条（Esc、Ctrl、Tab、箭头）、复制粘贴按钮；尽量启用硬件键盘适配；文档列出限制与替代方案。

- 安全边界与授权：需确保“只有已绑定的 Telegram 用户”能控制“已绑定的主机”。
  - 对策：端到端基于 Telegram WebApp `initData` 进行签名校验（HMAC-SHA256，使用 Bot Token），生成短期会话令牌；本地桥接验证后才放行。

### 架构建议（两条路径）

1) 本地桥接 + 反向中继（推荐，零私钥外泄）
- 组成：
  - 本地桥接进程：运行在用户电脑，拉起 shell（或本地 SSH 到 127.0.0.1），维护 tmux，会收发与前端的字节流；暴露出站 WSS/WebRTC 通道。
  - 中继服务（无状态）：仅负责把前端与本地桥接的字节流对应起来（room/connection-id），不碰私钥/凭据。
  - Mini App 前端：xterm.js + 认证签名 + 设备选择/配对。
- 优点：
  - 私钥完全留在用户主机；中继无感知；合规/信任边界清晰。
  - 与 tmux 自然融合，断线重连体验好。
- 难点：
  - 需要提供“桥接守护安装/更新脚本”和“一键中继绑定”。
  - 移动网络+NAT 环境下的连通性测试与自恢复。

2) 服务端桥接 SSH（过渡选项）
- 组成：
  - 受控的桥接服务在云端执行 SSH；前端通过 WSS 将终端数据转发到桥接。
- 风险：
  - 必须将私钥交给云端（哪怕短期内存），或回退至口令/TOTP 登录（弱化体验/安全）。
- 结论：
  - 不作为默认路径，仅用于 PoC 或内网自建（桥接与被控主机在同一专网时）。

### 具体落地修正（基于现有文档）

- tmux 启动/恢复命令修改为：`tmux new-session -A -s "claude_${userId}"`，并设置 `TERM=screen-256color`，必要时发送 `stty -ixon` 禁用 XON/XOFF。
- 终端窗口变更：前端在 `xterm` `onResize` 时发送 `{type: 'resize', cols, rows}`；桥接调用 `stream.setWindow(rows, cols, height, width)` 或等价 API。
- 心跳与保活：前端 `ping`/`pong`，桥接侧设置 `keepaliveInterval`；移动端切后台后自动重连并附着 tmux。
- 授权闭环：
  - Mini App 使用 `initData` 生成 `auth_token`（含 Telegram user_id、过期时间、签名）。
  - 本地桥接在首次绑定时记录允许运行的 Telegram user_id；每次连接校验 `auth_token`。
- 存储策略：
  - 默认不在 CloudStorage 存私钥；若用户选择持久化，采用 WebCrypto 加密 + passphrase；提供“仅本次会话临时导入”。

### 兼容性与环境约束

- 终端引擎：xterm.js（iOS/Android/桌面 Web 混合验证，注意 iOS 软键盘行为）。
- SSH 版本：OpenSSH 8.x/9.x；首选 Ed25519；Windows 建议启用 OpenSSH Server 或使用“本地 pty”模式。
- 浏览器内 CSP/网络策略：Telegram Mini App 需允许访问中继的 `wss://` 域名；全站 HTTPS。
- 中继水平扩展：使用连接 ID 做粘性路由；无状态可横向扩展；对每连接限速限并发，防止滥用。

### 可观测性与运维

- 度量：连接建立率、平均往返延迟、重连次数、会话时长、错误分布（握手失败/权限失败/网络中断）。
- 日志：中继仅记录连接元数据（无内容）；本地桥接可选记录调试日志（默认关闭内容级日志）。
- 报警：连接失败率 > 阈值、延迟 P95>阈值、隧道离线等。

### 验收标准（补充）

- 授权正确：未绑定的 Telegram 帐号无法连接目标主机。
- 零私钥外泄：在默认推荐路径下，私钥不离开用户主机或浏览器本地加密存储；中继不存储任何凭据。
- 断线恢复：息屏/切应用 5 分钟内返回，能自动恢复到原 tmux 会话；窗口尺寸恢复后终端布局正常。
- 延迟体验：4G/5G 场景下大多数操作 <200ms；弱网下仍可操作（字符缓冲不乱序/不丢失）。
- 跨平台：macOS/Linux/Windows（三平台各完成一轮验收用例）。

### 路线图微调（与原计划对齐）

- 阶段 1（1 周）：中继最小可用（room 路由/心跳/鉴权占位），本地桥接 PoC（pty + tmux + 反向连接）。
- 阶段 2（1–2 周）：Mini App 终端与配置 UI，键盘工具条与窗口自适应，鉴权闭环打通。
- 阶段 3（1 周）：稳定性与弱网优化（重连/拥塞控制/限流），安装脚本与系统服务（systemd/launchd）。
- 阶段 4（1 周）：文档、监控与验收回归；可选加密存储上线开关。

### 开放问题（需要产品/平台确认）

- Telegram WebApp 在 iOS/Android 的 CloudStorage 行为与容量限制；是否足够存放加密后的私钥材料？
- 中继是否自建（内网/公有云）还是引入第三方隧道（cloudflared/caddy/frp）；对合规与成本的影响？
- 是否需要“非 Mini App 模式”的备用入口（例如命令行生成一次性 URL 的 Web 终端），便于在 Telegram 受限场景下访问？
- 是否纳入“文件传输”和“剪贴板”到 V1，或留给 V1.1？
