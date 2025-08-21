#!/bin/bash
#
# 简化的代理测试脚本
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载配置
source "$SCRIPT_DIR/config.sh"

# 导出环境变量
export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"

# 创建临时管道
TEMP_DIR=$(mktemp -d)
INPUT_PIPE="$TEMP_DIR/test_input"
mkfifo "$INPUT_PIPE"

echo "创建管道: $INPUT_PIPE"

# 清理函数
cleanup() {
    echo "清理临时文件..."
    rm -rf "$TEMP_DIR"
    kill $LISTENER_PID 2>/dev/null || true
    exit
}
trap cleanup EXIT

# 启动监听器，输出到管道
echo "启动监听器..."
python3 "$SCRIPT_DIR/telegram_listener.py" --output "$INPUT_PIPE" &
LISTENER_PID=$!

echo "监听器PID: $LISTENER_PID"
echo "等待5秒让监听器启动..."
sleep 5

# 发送启动消息
python3 "$SCRIPT_DIR/telegram_bridge.py" send "🧪 测试代理模式启动，请发送一些消息"

echo "现在从管道读取消息（10次）："
for i in {1..10}; do
    if timeout 10 cat "$INPUT_PIPE"; then
        echo "[$i] 收到消息: 上面的内容"
    else
        echo "[$i] 超时，没有收到消息"
    fi
done

echo "测试完成"