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
- 🔔 **Real-time Lark Integration** - Instant notifications to your Lark/Feishu workspace
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
Open Claude Code and paste this prompt (replace with your Lark webhook):

```
请帮我安装这个 Claude Code Hook 通知系统。

我的 Lark webhook URL 是：https://open.larksuite.com/open-apis/bot/v2/hook/YOUR_WEBHOOK_HERE

请执行以下安装步骤：
1. 设置所有脚本文件的执行权限（chmod +x *.sh claude-notify claude-silent）
2. 复制 config.template.sh 为 config.sh
3. 在 config.sh 中替换 WEBHOOK_URL 为我提供的地址
4. 读取当前的 ~/.claude/settings.json 配置
5. 在 settings.json 中添加 Stop hook 配置，指向当前目录的 send_smart_notification.sh 脚本的绝对路径
6. 创建 logs 目录（如果不存在）
7. 运行测试验证安装是否成功

如果 ~/.claude/settings.json 不存在，请创建一个新的配置文件。
如果已存在 hooks 配置，请合并而不是覆盖现有配置。

安装完成后，请告诉我如何测试通知功能。
```

### 3. Start using
```bash
# Default: notifications disabled
claude

# Enable notifications
CC_HOOKS_NOTIFY=on claude
```

> 💡 **Pro tip**: See [install.md](install.md) for detailed installation guide and [claude_install_prompt.md](claude_install_prompt.md) for ready-to-copy prompt.

## 📋 Prerequisites

- [Claude Code](https://claude.ai/code) installed
- Bash shell (macOS/Linux)
- Python 3.7+
- Lark/Feishu webhook URL

## 🎛️ Configuration

### Control Methods

| Method | Command | Description |
|--------|---------|-------------|
| **Environment Variable** | `CC_HOOKS_NOTIFY=on claude` | Temporary enable |
| **Launch Scripts** | `./claude-notify` | Enable notifications |
|  | `./claude-silent` | Disable notifications |
| **Toggle Script** | `./toggle-hooks.sh on/off/status` | Persistent control |

### Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `CC_HOOKS_NOTIFY` | `on`, `ON`, `enabled`, `true`, `1` | `(unset)` | Enable notifications |

### Configuration Files

- `.hooks-disabled` - Created by toggle script to disable notifications
- `logs/hook_execution.log` - Execution logs (auto-created)

## 📱 Notification Example

<div align="center">

```
🤖 Claude Code 完成通知

📋 摘要: 最近请求: 创建React组件 | 执行了: Write, Edit | 共3轮对话
⏱️ 耗时: 2分30秒

⏰ 时间: 2025-08-21 15:30:45
📂 目录: /Users/username/project
```

</div>

## 📂 Project Structure

```
claude-code-hooks/
├── 📄 README.md                    # This file
├── 📄 README_zh.md                 # Chinese documentation
├── 📋 install.md                   # Installation guide
├── 📝 claude_install_prompt.md     # Ready-to-copy Claude prompt
├── ⚙️ config.template.sh           # Configuration template
├── ⚙️ send_smart_notification.sh   # Main hook script
├── 🐍 generate_summary.py          # Smart summary generator
├── 🔧 toggle-hooks.sh              # Toggle control script
├── 🔔 claude-notify               # Enable notifications launcher
├── 🔕 claude-silent               # Disable notifications launcher
├── 🚫 .gitignore                  # Git ignore rules
├── 📄 LICENSE                     # MIT License
└── 📁 logs/                       # Execution logs directory
    └── 📝 hook_execution.log
```

## 🛠️ Advanced Usage

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
   ./toggle-hooks.sh status
   ```

2. Verify Claude Code hooks configuration:
   ```bash
   cat ~/.claude/settings.json | grep -A 10 hooks
   ```

3. Check execution logs:
   ```bash
   tail -f logs/hook_execution.log
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