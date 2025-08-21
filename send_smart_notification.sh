#!/bin/bash

# Lark webhook URL
WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/d3c04484-07a3-4208-ab9a-a7f4ec987e0f"

# 获取当前时间
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 日志文件路径
LOG_FILE="$SCRIPT_DIR/logs/hook_execution.log"

# 检查通知开关状态
# 默认禁用，需要明确设置为 on/ON/enabled/true 才启用
if [ "$CC_HOOKS_NOTIFY" = "on" ] || [ "$CC_HOOKS_NOTIFY" = "ON" ] || [ "$CC_HOOKS_NOTIFY" = "enabled" ] || [ "$CC_HOOKS_NOTIFY" = "true" ] || [ "$CC_HOOKS_NOTIFY" = "1" ]; then
    # 启用状态，继续执行
    echo "=== Hook Enabled: $TIMESTAMP ===" >> "$LOG_FILE"
    echo "Claude hooks enabled via CC_HOOKS_NOTIFY=$CC_HOOKS_NOTIFY" >> "$LOG_FILE"
else
    # 默认禁用状态
    echo "=== Hook Disabled: $TIMESTAMP ===" >> "$LOG_FILE"
    echo "Claude hooks disabled by default (set CC_HOOKS_NOTIFY=on to enable)" >> "$LOG_FILE"
    exit 0
fi

# 检查配置文件是否禁用通知
if [ -f "$SCRIPT_DIR/.hooks-disabled" ]; then
    echo "=== Hook Disabled: $TIMESTAMP ===" >> "$LOG_FILE"
    echo "Claude hooks disabled via .hooks-disabled file" >> "$LOG_FILE"
    exit 0
fi

# 记录执行开始
echo "=== Hook Execution Start: $TIMESTAMP ===" >> "$LOG_FILE"

# 读取 stdin 中的 JSON 数据
INPUT_JSON=""
if [ -t 0 ]; then
    # stdin 为 terminal，没有输入数据
    INPUT_JSON="{}"
    echo "No stdin data (terminal mode)" >> "$LOG_FILE"
else
    # 读取 stdin 数据
    INPUT_JSON=$(cat)
    echo "Received stdin: $INPUT_JSON" >> "$LOG_FILE"
fi

# 解析 transcript_path
TRANSCRIPT_PATH=$(echo "$INPUT_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('transcript_path', ''))
except Exception as e:
    print('', file=sys.stderr)
" 2>>"$LOG_FILE")

echo "Parsed transcript_path: $TRANSCRIPT_PATH" >> "$LOG_FILE"

# 生成对话摘要
SUMMARY=""
DURATION=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    echo "Generating summary from: $TRANSCRIPT_PATH" >> "$LOG_FILE"
    FULL_SUMMARY=$(python3 "$SCRIPT_DIR/generate_summary.py" "$TRANSCRIPT_PATH" 2>>"$LOG_FILE" || echo "生成摘要失败")
    echo "Generated summary: $FULL_SUMMARY" >> "$LOG_FILE"
    
    # 检查是否包含耗时信息（用|||分隔）
    if [[ "$FULL_SUMMARY" == *"|||"* ]]; then
        # 使用 Python 来可靠地分割字符串
        SUMMARY=$(python3 -c "
import sys
full_summary = '''$FULL_SUMMARY'''
if '|||' in full_summary:
    print(full_summary.split('|||')[0].strip())
else:
    print(full_summary)
")
        DURATION=$(python3 -c "
import sys
full_summary = '''$FULL_SUMMARY'''
if '|||' in full_summary:
    print(full_summary.split('|||')[1].strip())
")
        echo "Parsed - Summary: $SUMMARY, Duration: $DURATION" >> "$LOG_FILE"
    else
        SUMMARY="$FULL_SUMMARY"
        echo "No duration found in summary" >> "$LOG_FILE"
    fi
else
    SUMMARY="Claude Code 任务完成"
    echo "Using default summary (no transcript file)" >> "$LOG_FILE"
fi

# 如果有命令行参数，使用它作为自定义消息
if [ $# -gt 0 ]; then
    SUMMARY="$1"
    DURATION=""
    echo "Using command line summary: $SUMMARY" >> "$LOG_FILE"
fi

# 转义消息内容中的特殊字符
ESCAPED_SUMMARY=$(echo "$SUMMARY" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n')
ESCAPED_DURATION=$(echo "$DURATION" | sed 's/\\/\\\\/g; s/"/\\"/g')

# 构造消息内容
if [ -n "$DURATION" ]; then
    MESSAGE="{
      \"msg_type\": \"text\",
      \"content\": {
        \"text\": \"🤖 Claude Code 完成通知\\n\\n📋 摘要: $ESCAPED_SUMMARY\\n⏱️ 耗时: $ESCAPED_DURATION\\n\\n⏰ 时间: $TIMESTAMP\\n📂 目录: $(pwd)\"
      }
    }"
else
    MESSAGE="{
      \"msg_type\": \"text\",
      \"content\": {
        \"text\": \"🤖 Claude Code 完成通知\\n\\n📋 摘要: $ESCAPED_SUMMARY\\n\\n⏰ 时间: $TIMESTAMP\\n📂 目录: $(pwd)\"
      }
    }"
fi

# 发送请求到 Lark
echo "Sending message to Lark..." >> "$LOG_FILE"
CURL_RESULT=$(curl -X POST \
  -H "Content-Type: application/json" \
  -d "$MESSAGE" \
  "$WEBHOOK_URL" \
  --silent \
  --max-time 10 \
  --write-out "HTTP_CODE:%{http_code}")

# 记录发送结果
HTTP_CODE=$(echo "$CURL_RESULT" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
RESPONSE_BODY=$(echo "$CURL_RESULT" | sed 's/HTTP_CODE:[0-9]*$//')

echo "HTTP Status: $HTTP_CODE" >> "$LOG_FILE"
echo "Response: $RESPONSE_BODY" >> "$LOG_FILE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "Smart Lark notification sent successfully at $TIMESTAMP" >> "$LOG_FILE"
    echo "Smart Lark notification sent at $TIMESTAMP"
else
    echo "ERROR: Failed to send notification. HTTP: $HTTP_CODE" >> "$LOG_FILE"
    echo "ERROR: Failed to send notification at $TIMESTAMP"
fi

echo "=== Hook Execution End: $(date "+%Y-%m-%d %H:%M:%S") ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"