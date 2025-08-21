# Claude Code Hook 通知系统配置模板
# 复制此文件为 config.sh 并填入你的配置

# Lark/飞书 webhook URL
WEBHOOK_URL="https://open.larksuite.com/open-apis/bot/v2/hook/YOUR_WEBHOOK_HERE"

# 通知语言设置 (必需)
NOTIFICATION_LANG="en"  # 必须设置为: en(英文) 或 zh(中文)

# === Telegram 双向通信配置 ===
# Telegram机器人Token（从 @BotFather 获取）
TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN_HERE"

# === 用户绑定配置 (推荐方式) ===
# 用户绑定密钥 - 通过机器人 /bind 命令获取
# 使用此密钥可实现多用户隔离，更安全
TELEGRAM_USER_KEY=""

# === 直接配置 (兼容方式) ===
# 直接指定聊天ID（不推荐，无用户隔离）
# 仅在不使用用户绑定时有效
TELEGRAM_CHAT_ID=""

# === 模式设置 ===
# off - 禁用Telegram功能（默认）
# on - 同时启用Lark和Telegram通知
# only - 仅使用Telegram（禁用Lark）
TELEGRAM_MODE="off"

# 交互超时时间（秒）- 等待用户回复的最长时间
TELEGRAM_TIMEOUT=300

# === 使用说明 ===
# 1. 推荐使用 TELEGRAM_USER_KEY 方式：
#    - 向 @claude_code_father_bot 发送 /bind 获取密钥
#    - 将密钥填入 TELEGRAM_USER_KEY
#    - 支持多用户隔离，更安全
#
# 2. 兼容使用 TELEGRAM_CHAT_ID 方式：
#    - 直接设置聊天ID
#    - 所有用户共享同一聊天，可能混乱
#    - 仅在单用户场景下推荐