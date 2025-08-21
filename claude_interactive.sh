#!/bin/bash
#
# Claude Interactive Control Script
# Enables bidirectional communication between Claude and Telegram
#

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载配置文件
CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    echo "错误：配置文件 config.sh 不存在"
    echo "请复制 config.template.sh 为 config.sh 并配置你的 webhook URL 和 Telegram 配置"
    exit 1
fi

# 日志文件路径
LOG_FILE="$SCRIPT_DIR/logs/hook_execution.log"

# 获取当前时间
timestamp() {
    date "+%Y-%m-%d %H:%M:%S"
}

# 日志记录函数
log() {
    echo "[$(timestamp)] $1" >> "$LOG_FILE"
}

# 错误处理函数
error_exit() {
    echo "错误: $1"
    log "ERROR: $1"
    exit 1
}

# 检查Telegram配置
check_telegram_config() {
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        error_exit "Telegram配置不完整，请在config.sh中设置TELEGRAM_BOT_TOKEN"
    fi
    
    # 检查用户绑定配置
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        log "Using user key mode: $TELEGRAM_USER_KEY"
        export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
        export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"
    elif [ -n "$TELEGRAM_CHAT_ID" ]; then
        log "Using legacy chat ID mode: $TELEGRAM_CHAT_ID"
        export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
        export TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
    else
        error_exit "Telegram配置不完整，请设置TELEGRAM_USER_KEY或TELEGRAM_CHAT_ID"
    fi
    
    # 测试Telegram连接
    if ! python3 "$SCRIPT_DIR/telegram_bridge.py" test >/dev/null 2>&1; then
        error_exit "Telegram连接测试失败，请检查配置是否正确"
    fi
    
    log "Telegram configuration verified successfully"
}

# 发送消息并等待回复
send_and_wait() {
    local message="$1"
    local timeout="${2:-${TELEGRAM_TIMEOUT:-300}}"
    local session_id="${3:-$(date +%s)_$$}"
    
    log "send_and_wait called: message='${message:0:100}...', timeout=$timeout, session_id=$session_id"
    
    # 检查Telegram配置
    check_telegram_config
    
    # 构造完整的提示消息
    local full_message="$message

🔄 请回复此消息以继续Claude任务
📋 Session ID: $session_id
⏰ 超时时间: ${timeout}秒"
    
    echo "发送消息到Telegram并等待回复..."
    log "Sending interactive message to Telegram"
    
    # 导出环境变量给telegram_bridge使用
    export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"
    fi
    if [ -n "$TELEGRAM_CHAT_ID" ]; then
        export TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
    fi
    
    # 使用telegram_bridge等待回复
    USER_REPLY=$(python3 "$SCRIPT_DIR/telegram_bridge.py" wait "$timeout" <<< "$full_message" 2>>"$LOG_FILE")
    WAIT_EXIT_CODE=$?
    
    if [ $WAIT_EXIT_CODE -eq 0 ] && [ -n "$USER_REPLY" ]; then
        log "Received user reply: ${USER_REPLY:0:100}..."
        echo "$USER_REPLY"
        return 0
    else
        log "No reply received within timeout period ($timeout seconds)"
        echo "超时：在${timeout}秒内未收到回复"
        return 1
    fi
}

# 简单发送消息（不等待回复）
send_message() {
    local message="$1"
    
    log "send_message called: ${message:0:100}..."
    
    # 检查Telegram配置
    check_telegram_config
    
    # 导出环境变量
    export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"
    fi
    if [ -n "$TELEGRAM_CHAT_ID" ]; then
        export TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
    fi
    
    # 发送消息
    python3 "$SCRIPT_DIR/telegram_bridge.py" send "$message" 2>>"$LOG_FILE"
    return $?
}

# 等待用户输入（不发送初始消息）
wait_for_input() {
    local timeout="${1:-${TELEGRAM_TIMEOUT:-300}}"
    local session_id="${2:-$(date +%s)_$$}"
    
    log "wait_for_input called: timeout=$timeout, session_id=$session_id"
    
    # 检查Telegram配置
    check_telegram_config
    
    echo "等待Telegram用户输入..."
    log "Waiting for user input from Telegram"
    
    # 导出环境变量
    export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"
    fi
    if [ -n "$TELEGRAM_CHAT_ID" ]; then
        export TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
    fi
    
    # 等待回复
    USER_REPLY=$(python3 "$SCRIPT_DIR/telegram_bridge.py" wait "$timeout" 2>>"$LOG_FILE")
    WAIT_EXIT_CODE=$?
    
    if [ $WAIT_EXIT_CODE -eq 0 ] && [ -n "$USER_REPLY" ]; then
        log "Received user input: ${USER_REPLY:0:100}..."
        echo "$USER_REPLY"
        return 0
    else
        log "No input received within timeout period ($timeout seconds)"
        echo "超时：在${timeout}秒内未收到输入"
        return 1
    fi
}

# 显示帮助信息
show_help() {
    cat << EOF
Claude Interactive Control Script

用法:
  $0 send "消息内容"                    # 发送消息
  $0 wait [超时秒数]                    # 等待用户输入
  $0 send-wait "消息内容" [超时秒数]     # 发送消息并等待回复
  $0 test                              # 测试Telegram连接

示例:
  $0 send "任务已完成，请查看结果"
  $0 wait 300
  $0 send-wait "是否继续执行下一步？" 180
  $0 test

环境变量:
  TELEGRAM_BOT_TOKEN  - Telegram机器人token
  TELEGRAM_CHAT_ID    - Telegram聊天ID
  TELEGRAM_TIMEOUT    - 默认超时时间（秒）

配置文件: config.sh
EOF
}

# 测试Telegram连接
test_connection() {
    echo "测试Telegram连接..."
    log "Testing Telegram connection"
    
    if check_telegram_config; then
        echo "✅ Telegram连接测试成功"
        return 0
    else
        echo "❌ Telegram连接测试失败"
        return 1
    fi
}

# 主函数
main() {
    # 创建日志目录
    mkdir -p "$(dirname "$LOG_FILE")"
    
    case "${1:-}" in
        "send")
            if [ -z "$2" ]; then
                echo "错误：需要指定消息内容"
                echo "用法: $0 send \"消息内容\""
                exit 1
            fi
            send_message "$2"
            ;;
        "wait")
            timeout="${2:-${TELEGRAM_TIMEOUT:-300}}"
            wait_for_input "$timeout"
            ;;
        "send-wait")
            if [ -z "$2" ]; then
                echo "错误：需要指定消息内容"
                echo "用法: $0 send-wait \"消息内容\" [超时秒数]"
                exit 1
            fi
            timeout="${3:-${TELEGRAM_TIMEOUT:-300}}"
            send_and_wait "$2" "$timeout"
            ;;
        "test")
            test_connection
            ;;
        "help"|"-h"|"--help"|"")
            show_help
            ;;
        *)
            echo "未知命令: $1"
            echo "使用 '$0 help' 查看帮助信息"
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"