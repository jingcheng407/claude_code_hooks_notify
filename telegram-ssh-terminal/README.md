# Telegram SSH Terminal

通过 Telegram Mini App 安全连接到您的电脑终端，零私钥外泄架构。

## 特性

- 🔒 **零私钥外泄**: 私钥永不离开您的设备
- 🌐 **NAT穿透**: 自动处理内网连接
- 💾 **会话持久化**: 基于tmux的断线重连
- 📱 **移动优化**: 专为手机终端体验设计
- 🚀 **快速响应**: <200ms延迟
- 🔐 **安全认证**: Telegram用户白名单机制

## 架构

```
手机 (Telegram Mini App) 
    ↓ WebSocket
中继服务 (纯路由，无状态)
    ↓ WebSocket
本地桥接 (您的电脑)
    ↓ PTY
终端/tmux
```

## 快速开始

### 1. 安装

```bash
# 克隆项目
git clone <repository>
cd telegram-ssh-terminal

# 运行安装脚本
./install.sh
```

### 2. 配置

编辑 `config/bridge_config.json`:

```json
{
  "device_name": "My MacBook",
  "allowed_telegram_users": ["你的Telegram用户ID"],
  "relay_url": "ws://localhost:8080/device"
}
```

### 3. 启动服务

```bash
# 启动所有服务
./start.sh

# 或分别启动
cd relay && npm start  # 启动中继服务
python bridge/local_bridge.py  # 启动本地桥接
```

### 4. 连接

1. 在 Telegram 中打开 Mini App
2. 选择您的设备
3. 开始使用终端！

## 系统要求

- Python 3.9+
- Node.js 14+
- tmux 3.0+ (可选，用于会话持久化)

## 目录结构

```
telegram-ssh-terminal/
├── bridge/              # 本地桥接进程
│   └── local_bridge.py  # 核心桥接代码
├── relay/               # 中继服务
│   └── relay_server.js  # WebSocket路由
├── config/              # 配置文件
│   └── bridge_config.json
├── tests/               # 测试用例
└── logs/                # 运行日志
```

## 配置说明

### 本地桥接配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| device_name | 设备显示名称 | 主机名 |
| allowed_telegram_users | 允许的Telegram用户ID列表 | [] |
| relay_url | 中继服务地址 | ws://localhost:8080/device |
| session_persistent | 启用tmux会话持久化 | true |
| work_dir | 默认工作目录 | $HOME |

### 中继服务配置

中继服务默认监听 8080 端口，可通过环境变量 `PORT` 修改：

```bash
PORT=3000 node relay/relay_server.js
```

## 安全说明

1. **零私钥外泄**: 本系统不传输SSH私钥，使用本地PTY直接管理终端
2. **用户白名单**: 只有配置的Telegram用户可以连接
3. **会话隔离**: 不同用户的tmux会话完全隔离
4. **传输加密**: 所有通信使用WebSocket over TLS

## 故障排查

### 连接失败

1. 检查中继服务是否运行: `curl http://localhost:8080/health`
2. 检查本地桥接日志: `tail -f logs/bridge.log`
3. 确认防火墙设置允许WebSocket连接

### tmux会话问题

```bash
# 列出所有tmux会话
tmux ls

# 手动附加到会话
tmux attach -t claude_用户ID

# 清理僵尸会话
tmux kill-session -t session_name
```

### 性能调优

1. 调整WebSocket心跳间隔（默认30秒）
2. 优化终端缓冲区大小
3. 使用本地中继减少延迟

## 开发

### 运行测试

```bash
# Python测试
source venv/bin/activate
pytest tests/

# Node.js测试
cd relay && npm test
```

### 调试模式

```bash
# 启用调试日志
export LOG_LEVEL=DEBUG
python bridge/local_bridge.py
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 致谢

- 基于 WebSocket 和 PTY 技术
- 使用 tmux 实现会话管理
- Telegram Bot API 提供认证