#!/bin/bash

# Telegram SSH Terminal 安装脚本
# 自动安装依赖并配置服务

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

print_info "=========================================="
print_info "   Telegram SSH Terminal 安装程序"
print_info "=========================================="

# 1. 检查系统要求
print_info "检查系统要求..."

# 检查Python
if ! command_exists python3; then
    print_error "Python 3 未安装，请先安装 Python 3.9+"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
print_info "Python 版本: $PYTHON_VERSION"

# 检查Node.js
if ! command_exists node; then
    print_error "Node.js 未安装，请先安装 Node.js 14+"
    exit 1
fi

NODE_VERSION=$(node -v)
print_info "Node.js 版本: $NODE_VERSION"

# 检查tmux（可选）
if command_exists tmux; then
    TMUX_VERSION=$(tmux -V)
    print_info "tmux 版本: $TMUX_VERSION"
else
    print_warning "tmux 未安装，会话持久化功能将不可用"
    read -p "是否安装 tmux? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            brew install tmux
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            sudo apt-get update && sudo apt-get install -y tmux
        fi
    fi
fi

# 2. 安装Python依赖
print_info "安装Python依赖..."

# 创建虚拟环境
if [ ! -d "venv" ]; then
    python3 -m venv venv
    print_info "虚拟环境创建成功"
fi

# 激活虚拟环境并安装依赖
source venv/bin/activate

# 创建requirements.txt
cat > requirements.txt << EOF
websockets>=11.0
asyncio
pytest>=7.0
pytest-asyncio>=0.21
EOF

pip install --upgrade pip
pip install -r requirements.txt

print_info "Python依赖安装完成"

# 3. 安装Node.js依赖
print_info "安装Node.js依赖..."

cd relay
npm install
cd ..

print_info "Node.js依赖安装完成"

# 4. 创建配置文件
print_info "创建配置文件..."

if [ ! -f "config/bridge_config.json" ]; then
    cp config/bridge_config.template.json config/bridge_config.json
    
    print_info "请编辑 config/bridge_config.json 文件："
    print_warning "1. 添加您的 Telegram 用户 ID 到 allowed_telegram_users"
    print_warning "2. 设置 bot_token (如果使用Telegram认证)"
    print_warning "3. 调整其他配置项"
    
    read -p "现在编辑配置文件吗? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-vi} config/bridge_config.json
    fi
fi

# 5. 创建systemd服务（Linux）或 launchd plist（macOS）
print_info "配置系统服务..."

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - 使用systemd
    SERVICE_FILE="/etc/systemd/system/telegram-ssh-bridge.service"
    
    sudo tee $SERVICE_FILE > /dev/null << EOF
[Unit]
Description=Telegram SSH Terminal Bridge
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/venv/bin/python $SCRIPT_DIR/bridge/local_bridge.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    print_info "systemd 服务已创建"
    
    read -p "是否启用开机自启动? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo systemctl enable telegram-ssh-bridge
        print_info "开机自启动已启用"
    fi
    
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - 使用launchd
    PLIST_FILE="$HOME/Library/LaunchAgents/com.telegram.ssh.bridge.plist"
    
    tee $PLIST_FILE > /dev/null << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.telegram.ssh.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SCRIPT_DIR/venv/bin/python</string>
        <string>$SCRIPT_DIR/bridge/local_bridge.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$SCRIPT_DIR/logs/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>$SCRIPT_DIR/logs/bridge_error.log</string>
</dict>
</plist>
EOF

    print_info "launchd plist 已创建"
    
    read -p "是否加载服务? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        launchctl load $PLIST_FILE
        print_info "服务已加载"
    fi
fi

# 6. 创建日志目录
mkdir -p logs

# 7. 创建快捷启动脚本
cat > start.sh << 'EOF'
#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 启动中继服务
echo "启动中继服务..."
cd relay
npm start &
RELAY_PID=$!
cd ..

# 等待中继服务启动
sleep 2

# 启动本地桥接
echo "启动本地桥接..."
source venv/bin/activate
python bridge/local_bridge.py &
BRIDGE_PID=$!

echo "服务已启动："
echo "  中继服务 PID: $RELAY_PID"
echo "  本地桥接 PID: $BRIDGE_PID"

# 保存PID
echo $RELAY_PID > logs/relay.pid
echo $BRIDGE_PID > logs/bridge.pid

# 等待退出信号
trap "kill $RELAY_PID $BRIDGE_PID" EXIT
wait
EOF

chmod +x start.sh

# 创建停止脚本
cat > stop.sh << 'EOF'
#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

if [ -f logs/relay.pid ]; then
    kill $(cat logs/relay.pid) 2>/dev/null
    rm logs/relay.pid
    echo "中继服务已停止"
fi

if [ -f logs/bridge.pid ]; then
    kill $(cat logs/bridge.pid) 2>/dev/null
    rm logs/bridge.pid
    echo "本地桥接已停止"
fi
EOF

chmod +x stop.sh

# 8. 运行测试
print_info "运行测试..."

source venv/bin/activate
cd tests
python -m pytest test_local_bridge.py -v || print_warning "部分测试失败，请检查"
cd ..

# 9. 完成
print_info "=========================================="
print_info "   安装完成！"
print_info "=========================================="
print_info ""
print_info "使用方法："
print_info "  启动服务: ./start.sh"
print_info "  停止服务: ./stop.sh"
print_info ""
print_info "系统服务管理："
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    print_info "  启动: sudo systemctl start telegram-ssh-bridge"
    print_info "  停止: sudo systemctl stop telegram-ssh-bridge"
    print_info "  状态: sudo systemctl status telegram-ssh-bridge"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    print_info "  启动: launchctl load ~/Library/LaunchAgents/com.telegram.ssh.bridge.plist"
    print_info "  停止: launchctl unload ~/Library/LaunchAgents/com.telegram.ssh.bridge.plist"
fi
print_info ""
print_info "下一步："
print_info "1. 编辑 config/bridge_config.json 配置文件"
print_info "2. 启动服务: ./start.sh"
print_info "3. 配置 Telegram Mini App 连接到中继服务"