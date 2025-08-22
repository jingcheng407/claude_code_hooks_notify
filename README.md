# 🤖 Claude Code Hook Notification System

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](README.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-purple)](https://claude.ai/code)
[![Shell](https://img.shields.io/badge/shell-bash-green)](README.md)
[![Python](https://img.shields.io/badge/python-3.7%2B-blue)](README.md)

*An intelligent notification system for Claude Code with smart conversation summaries and flexible control options.*

[Features](#-features) • [Quick Start](#-quick-start) • [Prerequisites](#-prerequisites) • [Configuration](#-configuration) • [Contributing](#-contributing)

🇺🇸 English | [🇨🇳 中文](README_zh.md)

</div>

---

## ✨ Features

- 🧠 **Smart Conversation Summarization** - AI-powered summary generation with multimedia support
- ⏱️ **Automatic Duration Tracking** - Calculate and display task completion time
- 💰 **Daily Cost Tracking** - Shows today's total Claude Code usage cost
- 🔔 **Real-time Lark Integration** - Instant notifications to your Lark/Feishu workspace
- 📱 **Telegram Bidirectional Communication** - Interactive two-way messaging with Telegram bot
- 📊 **Comprehensive Logging** - Detailed execution logs with status tracking
- 🎛️ **Flexible Control System** - Multiple ways to enable/disable notifications
- 🔒 **Safe Defaults** - Notifications disabled by default for privacy
- 🚀 **Zero Dependencies** - Pure bash and Python, no external libraries

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/claude-code-hooks.git
cd claude-code-hooks
```

### 2. Auto-install with Claude Code
Open Claude Code and paste this prompt, then modify:
1. **Replace your Lark webhook URL**
2. **Specify notification language**

```
Please help me install this Claude Code Hook notification system.

My Lark webhook URL is: https://open.larksuite.com/open-apis/bot/v2/hook/YOUR_WEBHOOK_HERE
I prefer notification language: English (Please must choose: English/Chinese)

Please execute the following installation steps:
1. Install ccusage for cost tracking: npm install -g ccusage (or use npx ccusage@latest)
2. Set execution permissions for all script files (chmod +x *.sh claude-notify claude-silent)
3. Copy config.template.sh to config.sh
4. Replace WEBHOOK_URL in config.sh with the address I provided
5. Based on my language preference, set notification language in config.sh:
   - English: NOTIFICATION_LANG="en" 
   - Chinese: NOTIFICATION_LANG="zh"
6. Read the current ~/.claude/settings.json configuration
7. Add Stop hook configuration in settings.json, pointing to the absolute path of send_smart_notification.sh script in the current directory
8. Create logs directory (if it doesn't exist)
9. Run tests to verify the installation is successful

If ~/.claude/settings.json doesn't exist, please create a new configuration file.
If hooks configuration already exists, please merge rather than overwrite existing configuration.

After installation is complete, please tell me how to test the notification function.
```

### 3. Start using
```bash
# Default: notifications disabled
claude

# Enable Lark notifications only
CC_HOOKS_NOTIFY=on claude
./claude-notify

# Enable both Lark and Telegram
./claude-telegram

# Enable Telegram only (interactive mode)
./claude-telegram-only
```

### 4. Test the installation
```bash
# Test Lark notification with short duration (will be skipped)
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Test short duration|||30秒"

# Test Lark notification with long duration (will be sent)
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Test long duration|||2分30秒"

# Test manual notification
CC_HOOKS_NOTIFY=on ./send_smart_notification.sh "Manual test notification"
```


## 📋 Prerequisites

- [Claude Code](https://claude.ai/code) installed
- Bash shell (macOS/Linux)
- Python 3.7+
- Node.js (for ccusage cost tracking)
- Lark/Feishu webhook URL ([Setup Guide](https://open.larksuite.com/document/client-docs/bot-v3/add-custom-bot))
- Telegram Bot Token (optional, for bidirectional communication)

## 🎛️ Configuration

### Control Methods

| Method | Command | Description |
|--------|---------|-------------|
| **Environment Variable** | `CC_HOOKS_NOTIFY=on claude` | Enable notifications |
| **Launch Scripts** | `./claude-notify` | Enable Lark notifications |
|  | `./claude-silent` | Disable notifications |
|  | `./claude-telegram` | Enable both Lark and Telegram |
|  | `./claude-telegram-only` | Enable Telegram only |

### Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `CC_HOOKS_NOTIFY` | `on`, `ON`, `enabled`, `true`, `1` | `(unset)` | Enable notifications |

### Configuration Files

- `config.sh` - Main configuration file (webhook URL and language settings)
- `logs/hook_execution.log` - Execution logs (auto-created)

### Language Settings

You must configure notification language in `config.sh`:

| Setting | Description |
|---------|-------------|
| `NOTIFICATION_LANG="en"` | Pure English notifications |
| `NOTIFICATION_LANG="zh"` | Pure Chinese notifications |

**Note**: Language setting is required. You must choose either "en" or "zh".

### Telegram Configuration (Optional)

For bidirectional communication with Telegram:

1. **Create Telegram Bot**:
   - Message @BotFather on Telegram
   - Use `/newbot` command and follow instructions
   - Copy the Bot Token (format: `123456789:ABC-DEF...`)

2. **Get Chat ID**:
   - Send a message to your bot
   - Visit: `https://api.telegram.org/bot<YourBotToken>/getUpdates`
   - Find your `chat.id` in the response

3. **Configure in `config.sh`**:
   ```bash
   TELEGRAM_BOT_TOKEN="your_bot_token_here"
   TELEGRAM_CHAT_ID="your_chat_id_here"
   TELEGRAM_MODE="on"  # off/on/only
   ```

| Setting | Values | Description |
|---------|--------|-------------|
| `TELEGRAM_MODE="off"` | Default | Telegram disabled |
| `TELEGRAM_MODE="on"` | Dual channel | Both Lark and Telegram |
| `TELEGRAM_MODE="only"` | Telegram only | Disable Lark notifications |

## 📱 Notification Example

<div align="center">

**English (NOTIFICATION_LANG="en")**:
```
🤖 Claude Code Task Completed

📋 Summary: Create React Component
⏱️ Duration: 2分30秒
💰 Today's Total: $42.66

⏰ Time: 2025-08-21 15:30:45
📂 Directory: /Users/username/project
```

</div>

## 📂 Project Structure

```
claude-code-hooks/
├── 📄 README.md                    # This file
├── 📄 README_zh.md                 # Chinese documentation
├── ⚙️ config.template.sh           # Configuration template
├── ⚙️ send_smart_notification.sh   # Main hook script
├── 🐍 generate_summary.py          # Smart summary generator
├── 🔔 claude-notify               # Enable Lark notifications launcher
├── 🔕 claude-silent               # Disable notifications launcher
├── 📱 claude-telegram             # Enable dual-channel launcher
├── 📱 claude-telegram-only        # Enable Telegram-only launcher
├── 🤖 telegram_bridge.py          # Telegram communication module
├── 🎛️ claude_interactive.sh        # Interactive control script
├── 🧪 test_telegram_bridge.py     # Unit tests
├── 🧪 test_integration.sh         # Integration tests
├── 🚫 .gitignore                  # Git ignore rules
├── 📄 LICENSE                     # MIT License
└── 📁 logs/                       # Execution logs directory
    └── 📝 hook_execution.log
```

## 🛠️ Advanced Usage

### Telegram Bidirectional Communication

The system enables interactive workflows where Claude can wait for user input via Telegram:

```bash
# Example: Interactive approval workflow
./claude_interactive.sh send-wait "Task completed. Deploy to production? (yes/no)" 180

# Example: Get user input for next steps  
USER_INPUT=$(./claude_interactive.sh send-wait "What should I implement next?" 300)
echo "User requested: $USER_INPUT"

# Example: Send notification without waiting
./claude_interactive.sh send "Deployment started..."
```

**Integration in scripts:**
```bash
#!/bin/bash
# Your script here...

# Ask user for confirmation via Telegram
if ./claude_interactive.sh send-wait "Process completed. Continue with cleanup? (yes/no)" 120 | grep -i "yes"; then
    echo "User approved, continuing cleanup..."
    # cleanup code here
else
    echo "User declined, skipping cleanup"
fi
```

### Custom Webhook Integration

The system supports any webhook-compatible service. Simply modify the `WEBHOOK_URL` and message format in `send_smart_notification.sh`:

```bash
# Example for Slack
WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

MESSAGE="{
  \"text\": \"Claude Code task completed: $SUMMARY\"
}"
```

### Summary Customization

Modify `generate_summary.py` to customize summary generation:

```python
# Adjust summary length
if len(latest_request) > 50:  # Change from 30 to 50
    latest_request = latest_request[:50] + "..."
```

## 🐛 Troubleshooting

<details>
<summary><strong>Notifications not working?</strong></summary>

1. Check if notifications are enabled:
   ```bash
   echo $CC_HOOKS_NOTIFY
   ```

2. Verify Claude Code hooks configuration:
   ```bash
   cat ~/.claude/settings.json | grep -A 10 hooks
   ```

3. Check execution logs:
   ```bash
   tail -f logs/hook_execution.log
   ```

4. Test manually:
   ```bash
   # Export environment variable first
   export CC_HOOKS_NOTIFY=on
   ./send_smart_notification.sh
   ```

</details>

<details>
<summary><strong>Permission denied errors?</strong></summary>

Make sure all scripts are executable:
```bash
chmod +x *.sh claude-notify claude-silent
```

</details>

<details>
<summary><strong>Webhook returning 400 errors?</strong></summary>

Check your Lark webhook URL and ensure it's active:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"msg_type": "text", "content": {"text": "Test"}}' \
  YOUR_WEBHOOK_URL
```

</details>

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Setup

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Coding Standards

- Use clear, descriptive commit messages
- Add comments for complex logic
- Test your changes thoroughly
- Follow existing code style

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Claude Code](https://claude.ai/code) team for the excellent development environment
- [Lark/Feishu](https://www.larksuite.com/) for webhook integration capabilities
- All contributors and users of this project

## 📊 Statistics

![GitHub stars](https://img.shields.io/github/stars/yourusername/claude-code-hooks?style=social)
![GitHub forks](https://img.shields.io/github/forks/yourusername/claude-code-hooks?style=social)
![GitHub issues](https://img.shields.io/github/issues/yourusername/claude-code-hooks)
![GitHub pull requests](https://img.shields.io/github/issues-pr/yourusername/claude-code-hooks)

---

<div align="center">

**[⬆ back to top](#-claude-code-hook-notification-system)**

Made with ❤️ for the Claude Code community

</div>