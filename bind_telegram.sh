#!/bin/bash
#
# Telegram用户绑定管理脚本
#

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示帮助信息
show_help() {
    cat << EOF
Telegram用户绑定管理工具

用法: $0 [命令] [参数]

命令:
  help                     显示此帮助信息
  bind <user_key>          绑定用户密钥到当前项目
  test                     测试当前配置
  status                   显示绑定状态
  unbind                   解除绑定
  start-bot                启动机器人命令处理器

绑定流程:
  1. 向 @claude_code_father_bot 发送 /bind
  2. 复制返回的用户密钥
  3. 运行: $0 bind <用户密钥>
  4. 测试: $0 test

示例:
  $0 bind CK12345678       绑定密钥
  $0 test                  测试连接
  $0 status                查看状态
EOF
}

# 加载配置
load_config() {
    CONFIG_FILE="$SCRIPT_DIR/config.sh"
    if [ ! -f "$CONFIG_FILE" ]; then
        echo -e "${RED}错误：配置文件 config.sh 不存在${NC}"
        echo "请复制 config.template.sh 为 config.sh 并配置基本信息"
        exit 1
    fi
    source "$CONFIG_FILE"
}

# 绑定用户密钥
bind_user_key() {
    local user_key="$1"
    
    if [ -z "$user_key" ]; then
        echo -e "${RED}错误：请提供用户密钥${NC}"
        echo "用法: $0 bind <用户密钥>"
        exit 1
    fi
    
    # 验证密钥格式
    if [[ ! "$user_key" =~ ^CK[A-F0-9]{12}$ ]]; then
        echo -e "${RED}错误：无效的用户密钥格式${NC}"
        echo "用户密钥应该是 CK 开头的14位字符，如：CK12345678ABCD"
        exit 1
    fi
    
    echo -e "${BLUE}正在绑定用户密钥: $user_key${NC}"
    
    # 确认绑定
    if python3 "$SCRIPT_DIR/user_binding.py" confirm "$user_key"; then
        # 更新配置文件
        if grep -q "TELEGRAM_USER_KEY=" "$SCRIPT_DIR/config.sh"; then
            # 更新现有配置
            sed -i.bak "s/TELEGRAM_USER_KEY=.*/TELEGRAM_USER_KEY=\"$user_key\"/" "$SCRIPT_DIR/config.sh"
        else
            # 添加新配置
            echo "TELEGRAM_USER_KEY=\"$user_key\"" >> "$SCRIPT_DIR/config.sh"
        fi
        
        echo -e "${GREEN}✅ 绑定成功！${NC}"
        echo -e "${GREEN}用户密钥 $user_key 已配置到项目中${NC}"
        
        # 启用Telegram模式
        if grep -q "TELEGRAM_MODE=" "$SCRIPT_DIR/config.sh"; then
            if grep -q "TELEGRAM_MODE=\"off\"" "$SCRIPT_DIR/config.sh"; then
                echo -e "${YELLOW}检测到Telegram模式为关闭状态${NC}"
                echo -n "是否启用Telegram通知？ (y/N): "
                read -r response
                if [[ "$response" =~ ^[Yy]$ ]]; then
                    sed -i.bak 's/TELEGRAM_MODE="off"/TELEGRAM_MODE="on"/' "$SCRIPT_DIR/config.sh"
                    echo -e "${GREEN}Telegram模式已启用${NC}"
                fi
            fi
        fi
        
        echo ""
        echo "🎉 配置完成！现在可以："
        echo "1. 运行 $0 test 测试连接"
        echo "2. 使用 ./claude-telegram 启动Claude Code"
        echo "3. 在Telegram中接收通知并双向交互"
        
    else
        echo -e "${RED}❌ 绑定失败${NC}"
        exit 1
    fi
}

# 测试配置
test_config() {
    echo -e "${BLUE}测试Telegram配置...${NC}"
    
    load_config
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        echo -e "${RED}错误：未配置 TELEGRAM_BOT_TOKEN${NC}"
        exit 1
    fi
    
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        echo -e "${GREEN}使用用户绑定模式: $TELEGRAM_USER_KEY${NC}"
        export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
        export TELEGRAM_USER_KEY="$TELEGRAM_USER_KEY"
    elif [ -n "$TELEGRAM_CHAT_ID" ]; then
        echo -e "${YELLOW}使用兼容模式: $TELEGRAM_CHAT_ID${NC}"
        export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
        export TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
    else
        echo -e "${RED}错误：未配置用户密钥或聊天ID${NC}"
        exit 1
    fi
    
    if python3 "$SCRIPT_DIR/telegram_bridge.py" test; then
        echo -e "${GREEN}✅ 配置测试成功！${NC}"
        
        # 发送测试消息
        echo -n "是否发送测试消息？ (y/N): "
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            if python3 "$SCRIPT_DIR/telegram_bridge.py" send "🧪 测试消息 - $(date)"; then
                echo -e "${GREEN}测试消息发送成功！${NC}"
            else
                echo -e "${RED}测试消息发送失败${NC}"
            fi
        fi
    else
        echo -e "${RED}❌ 配置测试失败${NC}"
        exit 1
    fi
}

# 显示绑定状态
show_status() {
    echo -e "${BLUE}用户绑定状态${NC}"
    echo "===================="
    
    # 显示所有绑定
    python3 "$SCRIPT_DIR/user_binding.py" list
    
    echo ""
    echo -e "${BLUE}当前项目配置${NC}"
    echo "===================="
    
    load_config
    
    if [ -n "$TELEGRAM_USER_KEY" ]; then
        echo -e "${GREEN}用户密钥: $TELEGRAM_USER_KEY${NC}"
    else
        echo -e "${YELLOW}未配置用户密钥${NC}"
    fi
    
    if [ -n "$TELEGRAM_CHAT_ID" ]; then
        echo -e "${YELLOW}聊天ID: $TELEGRAM_CHAT_ID${NC}"
    fi
    
    echo "Telegram模式: ${TELEGRAM_MODE:-off}"
}

# 解除绑定
unbind_user() {
    load_config
    
    if [ -z "$TELEGRAM_USER_KEY" ]; then
        echo -e "${YELLOW}当前项目未配置用户密钥${NC}"
        exit 0
    fi
    
    echo -e "${YELLOW}准备解除绑定用户密钥: $TELEGRAM_USER_KEY${NC}"
    echo -n "确认解除绑定？ (y/N): "
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        # 从全局绑定中删除
        if python3 "$SCRIPT_DIR/user_binding.py" revoke "$TELEGRAM_USER_KEY"; then
            echo -e "${GREEN}全局绑定已删除${NC}"
        fi
        
        # 清空项目配置
        if grep -q "TELEGRAM_USER_KEY=" "$SCRIPT_DIR/config.sh"; then
            sed -i.bak 's/TELEGRAM_USER_KEY=.*/TELEGRAM_USER_KEY=""/' "$SCRIPT_DIR/config.sh"
        fi
        
        echo -e "${GREEN}✅ 解除绑定完成${NC}"
    else
        echo "操作已取消"
    fi
}

# 启动机器人处理器
start_bot() {
    echo -e "${BLUE}启动Telegram机器人命令处理器...${NC}"
    
    load_config
    
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        echo -e "${RED}错误：未配置 TELEGRAM_BOT_TOKEN${NC}"
        exit 1
    fi
    
    export TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
    
    echo "机器人处理器正在运行..."
    echo "按 Ctrl+C 停止"
    echo ""
    
    python3 "$SCRIPT_DIR/telegram_bot_handler.py"
}

# 主程序
main() {
    case "${1:-help}" in
        "help"|"-h"|"--help")
            show_help
            ;;
        "bind")
            bind_user_key "$2"
            ;;
        "test")
            test_config
            ;;
        "status")
            show_status
            ;;
        "unbind")
            unbind_user
            ;;
        "start-bot")
            start_bot
            ;;
        *)
            echo -e "${RED}未知命令: $1${NC}"
            echo "使用 '$0 help' 查看帮助信息"
            exit 1
            ;;
    esac
}

main "$@"