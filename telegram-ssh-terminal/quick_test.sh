#!/bin/bash

# 快速测试脚本
# 验证基本功能是否正常

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "   Telegram SSH Terminal 快速测试"
echo "=========================================="
echo ""

# 1. 检查Python环境
echo -e "${GREEN}[1/5]${NC} 检查Python环境..."
if python3 -c "import websockets, asyncio" 2>/dev/null; then
    echo "  ✅ Python依赖已安装"
else
    echo -e "  ${RED}❌ Python依赖缺失${NC}"
    echo "  请运行: pip install websockets asyncio"
    exit 1
fi

# 2. 检查Node.js环境
echo -e "${GREEN}[2/5]${NC} 检查Node.js环境..."
if [ -d "relay/node_modules" ]; then
    echo "  ✅ Node.js依赖已安装"
else
    echo -e "  ${YELLOW}⚠️  Node.js依赖未安装${NC}"
    echo "  正在安装..."
    cd relay
    npm install
    cd ..
fi

# 3. 创建测试配置
echo -e "${GREEN}[3/5]${NC} 创建测试配置..."
if [ ! -f "config/bridge_config.json" ]; then
    cat > config/bridge_config.json << EOF
{
  "device_id": "test_device",
  "device_name": "Test Computer",
  "relay_url": "ws://localhost:8080/device",
  "allowed_telegram_users": ["123456"],
  "work_dir": "/tmp",
  "session_persistent": false
}
EOF
    echo "  ✅ 测试配置已创建"
else
    echo "  ✅ 配置文件已存在"
fi

# 4. 启动中继服务
echo -e "${GREEN}[4/5]${NC} 启动中继服务..."
cd relay
node relay_server.js &
RELAY_PID=$!
cd ..
echo "  ✅ 中继服务已启动 (PID: $RELAY_PID)"

# 等待服务启动
sleep 2

# 检查服务健康状态
if curl -s http://localhost:8080/health > /dev/null; then
    echo "  ✅ 中继服务运行正常"
else
    echo -e "  ${RED}❌ 中继服务启动失败${NC}"
    kill $RELAY_PID 2>/dev/null
    exit 1
fi

# 5. 启动本地桥接
echo -e "${GREEN}[5/5]${NC} 启动本地桥接..."
python3 bridge/local_bridge.py &
BRIDGE_PID=$!
echo "  ✅ 本地桥接已启动 (PID: $BRIDGE_PID)"

# 等待桥接启动
sleep 3

echo ""
echo "=========================================="
echo -e "${GREEN}   测试环境已就绪！${NC}"
echo "=========================================="
echo ""
echo "服务状态:"
echo "  中继服务: http://localhost:8080/health"
echo "  设备WebSocket: ws://localhost:8080/device"
echo "  客户端WebSocket: ws://localhost:8080/client"
echo ""
echo "测试方法:"
echo "  1. 新开终端运行: python3 test_client.py"
echo "  2. 输入设备ID: test_device"
echo "  3. 输入用户ID: 123456"
echo ""
echo "停止服务:"
echo "  按 Ctrl+C 停止所有服务"
echo ""

# 清理函数
cleanup() {
    echo ""
    echo "正在停止服务..."
    kill $RELAY_PID 2>/dev/null || true
    kill $BRIDGE_PID 2>/dev/null || true
    echo "服务已停止"
    exit 0
}

# 设置退出处理
trap cleanup EXIT INT TERM

# 等待用户中断
echo "服务运行中... (按 Ctrl+C 停止)"
wait