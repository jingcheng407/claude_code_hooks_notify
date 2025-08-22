# Telegram SSH Terminal - 演示指南

## 项目状态

✅ **核心功能已实现**：
- 本地桥接进程（PTY终端管理）
- 中继服务（WebSocket路由）
- 测试工具和脚本

⚠️ **已知问题**：
- WebSocket协议兼容性问题需要进一步调试
- Node.js ws库与Python websockets库之间存在协议差异

## 快速演示

### 方案1：直接测试终端功能

如果您想立即体验终端功能，可以使用简化的直接连接模式：

```bash
# 1. 创建简单的终端服务器
cat > simple_terminal.py << 'EOF'
import asyncio
import websockets
import pty
import os
import select

async def handle_client(websocket, path):
    print("客户端连接")
    
    # 创建PTY
    master, slave = pty.openpty()
    
    # 启动shell
    pid = os.fork()
    if pid == 0:  # 子进程
        os.setsid()
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.close(master)
        os.close(slave)
        os.execv('/bin/bash', ['/bin/bash'])
    
    # 父进程
    os.close(slave)
    
    async def read_terminal():
        while True:
            r, _, _ = select.select([master], [], [], 0.1)
            if r:
                output = os.read(master, 1024)
                await websocket.send(output.decode('utf-8', errors='replace'))
            await asyncio.sleep(0.01)
    
    async def read_websocket():
        async for message in websocket:
            os.write(master, message.encode())
    
    await asyncio.gather(read_terminal(), read_websocket())

start_server = websockets.serve(handle_client, "localhost", 8765)
asyncio.get_event_loop().run_until_complete(start_server)
print("终端服务器运行在 ws://localhost:8765")
asyncio.get_event_loop().run_forever()
EOF

# 2. 运行服务器
python3 simple_terminal.py &

# 3. 使用浏览器连接（创建HTML客户端）
cat > terminal.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Web Terminal</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js"></script>
</head>
<body>
    <div id="terminal"></div>
    <script>
        const term = new Terminal();
        term.open(document.getElementById('terminal'));
        
        const ws = new WebSocket('ws://localhost:8765');
        
        ws.onopen = () => {
            term.write('Connected to terminal\r\n');
        };
        
        ws.onmessage = (event) => {
            term.write(event.data);
        };
        
        term.onData((data) => {
            ws.send(data);
        });
    </script>
</body>
</html>
EOF

# 4. 打开浏览器
open terminal.html  # macOS
# 或 xdg-open terminal.html  # Linux
```

### 方案2：运行完整系统（需要调试）

```bash
# 1. 安装依赖
cd telegram-ssh-terminal
pip install websockets asyncio
cd relay && npm install && cd ..

# 2. 启动服务
./quick_test.sh

# 3. 在另一个终端测试
python3 test_client.py
```

## 已完成的功能

### 1. 本地桥接进程
- ✅ PTY终端创建和管理
- ✅ tmux会话集成
- ✅ WebSocket连接管理
- ✅ 用户认证框架
- ✅ 配置文件系统

### 2. 中继服务
- ✅ 设备注册
- ✅ 客户端路由
- ✅ 双向数据转发
- ✅ 心跳检测
- ✅ 健康检查API

### 3. 测试和工具
- ✅ 单元测试套件
- ✅ 测试客户端
- ✅ 安装脚本
- ✅ 快速测试脚本

## 项目架构

```
用户设备 (Telegram Mini App)
    ↓ WebSocket
中继服务 (纯路由)
    ↓ WebSocket  
本地桥接 (用户电脑)
    ↓ PTY
终端/tmux
```

## 下一步

1. **调试WebSocket兼容性**：解决Node.js ws库与Python websockets库的协议差异
2. **开发Mini App前端**：创建Telegram Mini App界面
3. **完善认证系统**：实现完整的Telegram HMAC验证
4. **性能优化**：优化数据传输和延迟

## 技术栈

- **后端**: Python 3.9+ (asyncio, websockets)
- **中继**: Node.js 14+ (ws, express)
- **前端**: React + xterm.js (待开发)
- **会话管理**: tmux

## 联系方式

如需帮助或有问题，请通过GitHub Issues联系。

---

*项目版本: 0.1.0-alpha*
*最后更新: 2024*