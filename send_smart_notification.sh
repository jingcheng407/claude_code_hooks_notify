#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载配置文件
CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    echo "错误：配置文件 config.sh 不存在"
    echo "请复制 config.template.sh 为 config.sh 并配置你的 webhook URL"
    exit 1
fi

# 获取当前时间
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

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
    SUMMARY="Task completed | 任务完成"
    echo "Using default summary (no transcript file)" >> "$LOG_FILE"
fi

# 如果有命令行参数，使用它作为自定义消息
if [ $# -gt 0 ]; then
    SUMMARY="$1"
    DURATION=""
    echo "Using command line summary: $SUMMARY" >> "$LOG_FILE"
fi

# 获取今日总花费信息
COST_INFO=""
if command -v ccusage >/dev/null 2>&1; then
    echo "Getting today's total cost information..." >> "$LOG_FILE"
    
    # 获取今日总花费
    COST_JSON=$(ccusage daily --json 2>/dev/null | python3 -c "
import json, sys
from datetime import datetime
try:
    data = json.load(sys.stdin)
    today = datetime.now().strftime('%Y-%m-%d')
    for day in data.get('daily', []):
        if day.get('date') == today:
            cost = day.get('totalCost', 0)
            if cost > 0:
                print(f'{cost:.2f}')
            else:
                print('0.00')
            break
    else:
        print('0.00')
except Exception as e:
    print('0.00')
" 2>>"$LOG_FILE")
    
    if [ "$COST_JSON" != "0.00" ]; then
        COST_INFO="$COST_JSON"
        echo "Found today's total cost: \$$COST_INFO" >> "$LOG_FILE"
    else
        echo "No cost information found for today" >> "$LOG_FILE"
    fi
else
    echo "ccusage command not available, skipping cost calculation" >> "$LOG_FILE"
fi

# 转义消息内容中的特殊字符
ESCAPED_SUMMARY=$(echo "$SUMMARY" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n')
ESCAPED_DURATION=$(echo "$DURATION" | sed 's/\\/\\\\/g; s/"/\\"/g')
ESCAPED_COST=$(echo "$COST_INFO" | sed 's/\\/\\\\/g; s/"/\\"/g')

# 获取语言设置，必须指定 en 或 zh
LANG_SETTING=${NOTIFICATION_LANG}

# 检查语言设置是否有效
if [ "$LANG_SETTING" != "en" ] && [ "$LANG_SETTING" != "zh" ]; then
    echo "错误：必须在 config.sh 中设置 NOTIFICATION_LANG 为 'en' 或 'zh'" >> "$LOG_FILE"
    echo "Error: NOTIFICATION_LANG must be set to 'en' or 'zh' in config.sh"
    exit 1
fi

# 根据语言设置构造消息内容
case "$LANG_SETTING" in
    "en")
        # 英文通知
        if [ -n "$DURATION" ] && [ -n "$COST_INFO" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code Task Completed\\n\\n📋 Summary: $ESCAPED_SUMMARY\\n⏱️ Duration: $ESCAPED_DURATION\\n💰 Today's Total: \$$ESCAPED_COST\\n\\n⏰ Time: $TIMESTAMP\\n📂 Directory: $(pwd)\"
              }
            }"
        elif [ -n "$DURATION" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code Task Completed\\n\\n📋 Summary: $ESCAPED_SUMMARY\\n⏱️ Duration: $ESCAPED_DURATION\\n\\n⏰ Time: $TIMESTAMP\\n📂 Directory: $(pwd)\"
              }
            }"
        elif [ -n "$COST_INFO" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code Task Completed\\n\\n📋 Summary: $ESCAPED_SUMMARY\\n💰 Today's Total: \$$ESCAPED_COST\\n\\n⏰ Time: $TIMESTAMP\\n📂 Directory: $(pwd)\"
              }
            }"
        else
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code Task Completed\\n\\n📋 Summary: $ESCAPED_SUMMARY\\n\\n⏰ Time: $TIMESTAMP\\n📂 Directory: $(pwd)\"
              }
            }"
        fi
        ;;
    "zh")
        # 中文通知
        if [ -n "$DURATION" ] && [ -n "$COST_INFO" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code 完成通知\\n\\n📋 摘要: $ESCAPED_SUMMARY\\n⏱️ 耗时: $ESCAPED_DURATION\\n💰 今日累计: \$$ESCAPED_COST\\n\\n⏰ 时间: $TIMESTAMP\\n📂 目录: $(pwd)\"
              }
            }"
        elif [ -n "$DURATION" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code 完成通知\\n\\n📋 摘要: $ESCAPED_SUMMARY\\n⏱️ 耗时: $ESCAPED_DURATION\\n\\n⏰ 时间: $TIMESTAMP\\n📂 目录: $(pwd)\"
              }
            }"
        elif [ -n "$COST_INFO" ]; then
            MESSAGE="{
              \"msg_type\": \"text\",
              \"content\": {
                \"text\": \"🤖 Claude Code 完成通知\\n\\n📋 摘要: $ESCAPED_SUMMARY\\n💰 今日累计: \$$ESCAPED_COST\\n\\n⏰ 时间: $TIMESTAMP\\n📂 目录: $(pwd)\"
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
        ;;
esac

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