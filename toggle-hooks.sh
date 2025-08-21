#!/bin/bash

# Claude Code Hook 通知开关脚本

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.hooks-disabled"

case "$1" in
    "off"|"disable"|"禁用")
        touch "$CONFIG_FILE"
        echo "🔕 Claude Code Hook 通知已禁用"
        echo "使用 '$0 on' 可重新启用"
        ;;
    "on"|"enable"|"启用")
        rm -f "$CONFIG_FILE"
        echo "🔔 Claude Code Hook 通知已启用"
        ;;
    "status"|"状态")
        if [ -f "$CONFIG_FILE" ]; then
            echo "🔕 Hook 通知状态: 已禁用"
        else
            echo "🔔 Hook 通知状态: 已启用"
        fi
        ;;
    *)
        echo "用法: $0 {on|off|status}"
        echo "  on/enable/启用  - 启用 Hook 通知"
        echo "  off/disable/禁用 - 禁用 Hook 通知"  
        echo "  status/状态     - 查看当前状态"
        exit 1
        ;;
esac