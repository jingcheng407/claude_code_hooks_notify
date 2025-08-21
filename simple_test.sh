#!/bin/bash
#
# 简单测试：验证可以向Claude Code提供持续输入
#

# 创建临时管道
TEMP_DIR=$(mktemp -d)
INPUT_PIPE="$TEMP_DIR/claude_input"
mkfifo "$INPUT_PIPE"

echo "管道创建: $INPUT_PIPE"

# 清理函数
cleanup() {
    echo "清理..."
    rm -rf "$TEMP_DIR"
    kill $FEEDER_PID 2>/dev/null || true
    exit
}
trap cleanup EXIT

# 启动输入提供者
(
    sleep 2
    echo "你好Claude，我是来自管道的输入" > "$INPUT_PIPE"
    sleep 3
    echo "1+1等于多少？" > "$INPUT_PIPE"
    sleep 3
    echo "/quit" > "$INPUT_PIPE"
) &
FEEDER_PID=$!

echo "输入提供者PID: $FEEDER_PID"
echo "启动Claude Code，从管道读取输入..."

# 启动Claude Code
timeout 20 claude code < "$INPUT_PIPE"

echo "Claude Code退出"