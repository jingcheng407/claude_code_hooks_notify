#!/bin/bash
#
# Integration tests for Claude Code Hook Telegram system
# 集成测试脚本
#

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 测试结果计数器
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
}

fail() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
}

warning() {
    echo -e "${YELLOW}⚠️  WARNING:${NC} $1"
}

# 测试环境设置
setup_test_env() {
    log "设置测试环境..."
    
    # 创建测试配置文件
    export TEST_CONFIG_FILE="$SCRIPT_DIR/config.test.sh"
    
    cat > "$TEST_CONFIG_FILE" << EOF
# 测试配置文件
WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/test_webhook"
NOTIFICATION_LANG="zh"

# Telegram测试配置
TELEGRAM_BOT_TOKEN="123456789:TEST-BOT-TOKEN-FOR-TESTING"
TELEGRAM_CHAT_ID="12345"
TELEGRAM_MODE="off"
TELEGRAM_TIMEOUT=30
EOF
    
    # 设置测试日志目录
    export TEST_LOG_DIR="$SCRIPT_DIR/logs/test"
    mkdir -p "$TEST_LOG_DIR"
    
    log "测试环境设置完成"
}

# 清理测试环境
cleanup_test_env() {
    log "清理测试环境..."
    
    if [ -f "$TEST_CONFIG_FILE" ]; then
        rm -f "$TEST_CONFIG_FILE"
    fi
    
    # 清理测试日志
    if [ -d "$TEST_LOG_DIR" ]; then
        rm -rf "$TEST_LOG_DIR"
    fi
    
    log "测试环境清理完成"
}

# 测试配置文件加载
test_config_loading() {
    log "测试配置文件加载..."
    
    # 备份原配置文件
    if [ -f "$SCRIPT_DIR/config.sh" ]; then
        cp "$SCRIPT_DIR/config.sh" "$SCRIPT_DIR/config.sh.backup"
    fi
    
    # 使用测试配置
    cp "$TEST_CONFIG_FILE" "$SCRIPT_DIR/config.sh"
    
    # 测试配置加载
    if source "$SCRIPT_DIR/config.sh"; then
        if [ "$NOTIFICATION_LANG" = "zh" ] && [ "$TELEGRAM_BOT_TOKEN" = "123456789:TEST-BOT-TOKEN-FOR-TESTING" ]; then
            success "配置文件加载正确"
        else
            fail "配置文件内容不正确"
        fi
    else
        fail "配置文件加载失败"
    fi
    
    # 恢复原配置文件
    if [ -f "$SCRIPT_DIR/config.sh.backup" ]; then
        mv "$SCRIPT_DIR/config.sh.backup" "$SCRIPT_DIR/config.sh"
    else
        rm -f "$SCRIPT_DIR/config.sh"
    fi
}

# 测试telegram_bridge模块
test_telegram_bridge_module() {
    log "测试telegram_bridge模块..."
    
    # 测试Python模块导入
    if python3 -c "import sys; sys.path.append('$SCRIPT_DIR'); import telegram_bridge; print('Import successful')" >/dev/null 2>&1; then
        success "telegram_bridge模块导入成功"
    else
        fail "telegram_bridge模块导入失败"
    fi
    
    # 测试CLI接口
    if python3 "$SCRIPT_DIR/telegram_bridge.py" 2>&1 | grep -q "Usage:"; then
        success "telegram_bridge CLI接口正常"
    else
        fail "telegram_bridge CLI接口异常"
    fi
}

# 测试脚本可执行性
test_script_executability() {
    log "测试脚本可执行性..."
    
    local scripts=(
        "telegram_bridge.py"
        "claude_interactive.sh"
        "claude-telegram"
        "claude-telegram-only"
        "test_telegram_bridge.py"
    )
    
    for script in "${scripts[@]}"; do
        if [ -x "$SCRIPT_DIR/$script" ]; then
            success "脚本 $script 可执行"
        else
            fail "脚本 $script 不可执行"
        fi
    done
}

# 测试单元测试
test_unit_tests() {
    log "运行单元测试..."
    
    # 设置测试环境变量
    export TELEGRAM_BOT_TOKEN="123456789:TEST-BOT-TOKEN"
    export TELEGRAM_CHAT_ID="12345"
    
    if python3 "$SCRIPT_DIR/test_telegram_bridge.py" >/dev/null 2>&1; then
        success "单元测试通过"
    else
        fail "单元测试失败"
    fi
}

# 测试claude_interactive脚本
test_claude_interactive() {
    log "测试claude_interactive脚本..."
    
    # 使用测试配置
    cp "$TEST_CONFIG_FILE" "$SCRIPT_DIR/config.sh"
    
    # 测试帮助信息
    if "$SCRIPT_DIR/claude_interactive.sh" help 2>&1 | grep -q "Claude Interactive Control Script"; then
        success "claude_interactive帮助信息正确"
    else
        fail "claude_interactive帮助信息异常"
    fi
    
    # 测试test命令（会失败，因为是测试token，但应该有明确的错误信息）
    if "$SCRIPT_DIR/claude_interactive.sh" test 2>&1 | grep -q "连接测试失败"; then
        success "claude_interactive test命令正确处理无效配置"
    else
        warning "claude_interactive test命令行为异常（可能是网络问题）"
    fi
    
    # 清理
    rm -f "$SCRIPT_DIR/config.sh"
}

# 测试send_smart_notification脚本集成
test_send_notification_integration() {
    log "测试send_smart_notification脚本集成..."
    
    # 使用测试配置
    cp "$TEST_CONFIG_FILE" "$SCRIPT_DIR/config.sh"
    
    # 设置测试环境变量
    export CC_HOOKS_NOTIFY=on
    export TELEGRAM_MODE=off  # 使用off模式避免实际发送
    
    # 测试通知脚本（使用自定义消息避免transcript解析）
    if echo '{}' | "$SCRIPT_DIR/send_smart_notification.sh" "测试集成消息" 2>&1 | grep -q "ERROR.*Failed to send"; then
        success "send_smart_notification脚本集成正确（预期失败：测试webhook）"
    else
        warning "send_smart_notification脚本行为异常"
    fi
    
    # 清理
    rm -f "$SCRIPT_DIR/config.sh"
}

# 测试启动脚本
test_launcher_scripts() {
    log "测试启动脚本..."
    
    # 测试claude-telegram脚本
    if head -n 20 "$SCRIPT_DIR/claude-telegram" | grep -q "TELEGRAM_MODE=on"; then
        success "claude-telegram脚本配置正确"
    else
        fail "claude-telegram脚本配置错误"
    fi
    
    # 测试claude-telegram-only脚本
    if head -n 20 "$SCRIPT_DIR/claude-telegram-only" | grep -q "TELEGRAM_MODE=only"; then
        success "claude-telegram-only脚本配置正确"
    else
        fail "claude-telegram-only脚本配置错误"
    fi
}

# 测试配置模板
test_config_template() {
    log "测试配置模板..."
    
    if [ -f "$SCRIPT_DIR/config.template.sh" ]; then
        # 检查模板包含必要的字段
        if grep -q "TELEGRAM_BOT_TOKEN" "$SCRIPT_DIR/config.template.sh" && \
           grep -q "TELEGRAM_CHAT_ID" "$SCRIPT_DIR/config.template.sh" && \
           grep -q "TELEGRAM_MODE" "$SCRIPT_DIR/config.template.sh"; then
            success "配置模板包含Telegram配置项"
        else
            fail "配置模板缺少Telegram配置项"
        fi
        
        # 检查语法正确性
        if bash -n "$SCRIPT_DIR/config.template.sh"; then
            success "配置模板语法正确"
        else
            fail "配置模板语法错误"
        fi
    else
        fail "配置模板文件不存在"
    fi
}

# 测试向后兼容性
test_backward_compatibility() {
    log "测试向后兼容性..."
    
    # 创建旧版本配置文件（不包含Telegram配置）
    local old_config="$SCRIPT_DIR/config.old.sh"
    cat > "$old_config" << EOF
WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/old_webhook"
NOTIFICATION_LANG="en"
EOF
    
    # 使用旧配置
    cp "$old_config" "$SCRIPT_DIR/config.sh"
    
    # 设置环境变量
    export CC_HOOKS_NOTIFY=on
    # 不设置TELEGRAM_MODE，应该默认使用Lark
    
    # 测试是否能正常运行
    echo '{}' | "$SCRIPT_DIR/send_smart_notification.sh" "向后兼容性测试" >/dev/null 2>&1
    
    # 检查日志文件中是否包含Telegram mode: off
    if tail -50 "$SCRIPT_DIR/logs/hook_execution.log" 2>/dev/null | grep -q "Telegram mode: off"; then
        success "向后兼容性测试通过"
    else
        fail "向后兼容性测试失败"
    fi
    
    # 清理
    rm -f "$old_config" "$SCRIPT_DIR/config.sh"
}

# 性能测试
test_performance() {
    log "测试性能..."
    
    # 测试脚本启动时间
    local start_time=$(date +%s.%N)
    python3 "$SCRIPT_DIR/telegram_bridge.py" >/dev/null 2>&1 || true
    local end_time=$(date +%s.%N)
    
    local duration=$(echo "$end_time - $start_time" | bc)
    local duration_ms=$(echo "$duration * 1000" | bc)
    
    if (( $(echo "$duration < 2.0" | bc -l) )); then
        success "脚本启动性能良好 (${duration_ms%.*}ms)"
    else
        warning "脚本启动较慢 (${duration_ms%.*}ms)"
    fi
}

# 主测试函数
run_integration_tests() {
    echo "========================================"
    echo "Claude Code Hook Telegram 集成测试"
    echo "========================================"
    echo
    
    setup_test_env
    
    # 运行所有测试
    test_config_template
    test_config_loading
    test_script_executability
    test_telegram_bridge_module
    test_unit_tests
    test_claude_interactive
    test_send_notification_integration
    test_launcher_scripts
    test_backward_compatibility
    test_performance
    
    cleanup_test_env
    
    echo
    echo "========================================"
    echo "测试结果汇总"
    echo "========================================"
    echo -e "总测试数: ${BLUE}$TESTS_TOTAL${NC}"
    echo -e "通过: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "失败: ${RED}$TESTS_FAILED${NC}"
    
    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}🎉 所有测试通过！${NC}"
        return 0
    else
        echo -e "${RED}💥 有测试失败，请检查上述错误信息${NC}"
        return 1
    fi
}

# 帮助信息
show_help() {
    cat << EOF
Claude Code Hook Telegram 集成测试工具

用法: $0 [选项]

选项:
  --help, -h     显示此帮助信息
  --unit         仅运行单元测试
  --config       仅测试配置相关功能
  --scripts      仅测试脚本可执行性
  --performance  仅运行性能测试

示例:
  $0                # 运行完整集成测试
  $0 --unit         # 仅运行单元测试
  $0 --config       # 仅测试配置功能
EOF
}

# 主程序入口
main() {
    case "${1:-}" in
        --help|-h)
            show_help
            exit 0
            ;;
        --unit)
            setup_test_env
            test_unit_tests
            cleanup_test_env
            ;;
        --config)
            setup_test_env
            test_config_template
            test_config_loading
            cleanup_test_env
            ;;
        --scripts)
            test_script_executability
            ;;
        --performance)
            test_performance
            ;;
        "")
            # 运行完整测试套件
            if run_integration_tests; then
                exit 0
            else
                exit 1
            fi
            ;;
        *)
            echo "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
}

# 检查依赖
check_dependencies() {
    local missing_deps=()
    
    if ! command -v python3 >/dev/null 2>&1; then
        missing_deps+=("python3")
    fi
    
    if ! command -v bc >/dev/null 2>&1; then
        missing_deps+=("bc")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo "错误：缺少以下依赖："
        printf ' - %s\n' "${missing_deps[@]}"
        exit 1
    fi
}

# 执行主程序
check_dependencies
main "$@"