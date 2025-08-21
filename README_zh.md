# 🤖 Claude Code Hook 通知系统

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](README_zh.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-兼容-purple)](https://claude.ai/code)
[![Shell](https://img.shields.io/badge/shell-bash-green)](README_zh.md)
[![Python](https://img.shields.io/badge/python-3.7%2B-blue)](README_zh.md)

*智能的 Claude Code 通知系统，支持对话摘要和灵活的控制选项。*

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [系统要求](#-系统要求) • [使用配置](#-使用配置) • [参与贡献](#-参与贡献)

[🇺🇸 English](README.md) | 🇨🇳 中文

</div>

---

## ✨ 功能特性

- 🧠 **智能对话摘要** - AI 驱动的摘要生成，支持多媒体消息
- ⏱️ **自动时长跟踪** - 计算并显示任务完成时间
- 💰 **今日成本跟踪** - 显示今天 Claude Code 使用的总成本
- 🔔 **实时 Lark 集成** - 即时推送通知到你的 Lark/飞书工作空间
- 📊 **全面日志记录** - 详细的执行日志和状态跟踪
- 🎛️ **灵活控制系统** - 多种方式启用/禁用通知
- 🔒 **安全默认设置** - 默认禁用通知，保护隐私
- 🚀 **零依赖** - 纯 bash 和 Python，无需外部库

## 🚀 快速开始

### 1. 克隆仓库
```bash
git clone https://github.com/yourusername/claude-code-hooks.git
cd claude-code-hooks
```

### 2. 使用 Claude Code 自动安装
打开 Claude Code，粘贴以下提示词并修改：
1. **替换你的 Lark webhook 地址**
2. **指定通知语言**

```
请帮我安装这个 Claude Code Hook 通知系统。

我的 Lark webhook URL 是：https://open.larksuite.com/open-apis/bot/v2/hook/你的_WEBHOOK_地址
我希望通知语言设置为：中文 (请必须选择: 中文/English)

请执行以下安装步骤：
1. 安装成本跟踪工具 ccusage：npm install -g ccusage（或使用 npx ccusage@latest）
2. 设置所有脚本文件的执行权限（chmod +x *.sh claude-notify claude-silent）
3. 复制 config.template.sh 为 config.sh
4. 在 config.sh 中替换 WEBHOOK_URL 为我提供的地址
5. 根据我选择的语言偏好，在 config.sh 中设置通知语言：
   - 中文：NOTIFICATION_LANG="zh"
   - English：NOTIFICATION_LANG="en"
6. 读取当前的 ~/.claude/settings.json 配置
7. 在 settings.json 中添加 Stop hook 配置，指向当前目录的 send_smart_notification.sh 脚本的绝对路径
8. 创建 logs 目录（如果不存在）
9. 运行测试验证安装是否成功

如果 ~/.claude/settings.json 不存在，请创建一个新的配置文件。
如果已存在 hooks 配置，请合并而不是覆盖现有配置。

安装完成后，请告诉我如何测试通知功能。
```

### 3. 开始使用
```bash
# 默认：通知禁用
claude

# 启用通知
CC_HOOKS_NOTIFY=on claude

# 或使用启动脚本
./claude-notify
```


## 📋 系统要求

- 已安装 [Claude Code](https://claude.ai/code)
- Bash shell（macOS/Linux）
- Python 3.7+
- Node.js（用于 ccusage 成本跟踪）
- Lark/飞书 webhook URL （[设置指南](https://open.larksuite.com/document/client-docs/bot-v3/add-custom-bot)）

## 🎛️ 使用配置

### 控制方式

| 方法 | 命令 | 说明 |
|------|------|------|
| **环境变量** | `CC_HOOKS_NOTIFY=on claude` | 启用通知 |
| **启动脚本** | `./claude-notify` | 启用通知 |
|  | `./claude-silent` | 禁用通知 |

### 环境变量

| 变量名 | 可选值 | 默认值 | 说明 |
|--------|-------|--------|------|
| `CC_HOOKS_NOTIFY` | `on`, `ON`, `enabled`, `true`, `1` | `(未设置)` | 启用通知 |

### 配置文件

- `config.sh` - 主配置文件（webhook URL 和语言设置）
- `logs/hook_execution.log` - 执行日志（自动创建）

### 语言设置

你必须在 `config.sh` 中配置通知语言：

| 设置 | 说明 |
|------|------|
| `NOTIFICATION_LANG="en"` | Pure English notifications |
| `NOTIFICATION_LANG="zh"` | 纯中文通知 |

**注意**：语言设置是必需的，你必须选择 "en" 或 "zh" 其中一个。

## 📱 通知示例

<div align="center">

**中文 (NOTIFICATION_LANG="zh")**:
```
🤖 Claude Code 完成通知

📋 摘要: 创建React组件
⏱️ 耗时: 2分30秒
💰 今日累计: $42.66

⏰ 时间: 2025-08-21 15:30:45
📂 目录: /Users/username/project
```

</div>

## 📂 项目结构

```
claude-code-hooks/
├── 📄 README.md                    # 英文说明文档
├── 📄 README_zh.md                 # 中文说明文档（本文件）
├── ⚙️ config.template.sh           # 配置文件模板
├── ⚙️ send_smart_notification.sh   # 主 Hook 脚本
├── 🐍 generate_summary.py          # 智能摘要生成器
├── 🔔 claude-notify               # 启用通知启动器
├── 🔕 claude-silent               # 禁用通知启动器
├── 🚫 .gitignore                  # Git 忽略规则
├── 📄 LICENSE                     # MIT 许可证
└── 📁 logs/                       # 执行日志目录
    └── 📝 hook_execution.log
```

## 🛠️ 高级用法

### 自定义 Webhook 集成

系统支持任何兼容 webhook 的服务。只需修改 `send_smart_notification.sh` 中的 `WEBHOOK_URL` 和消息格式：

```bash
# Slack 示例
WEBHOOK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

MESSAGE="{
  \"text\": \"Claude Code 任务完成: $SUMMARY\"
}"
```

### 摘要自定义

修改 `generate_summary.py` 来自定义摘要生成：

```python
# 调整摘要长度
if len(latest_request) > 50:  # 从 30 改为 50
    latest_request = latest_request[:50] + "..."
```

### 多种启用方式

```bash
# 环境变量控制
CC_HOOKS_NOTIFY=on claude           # 启用通知
claude                              # 禁用通知（默认）

# 启动脚本控制  
./claude-notify                     # 启用通知
./claude-silent                     # 禁用通知

# 配置文件控制
./toggle-hooks.sh on               # 启用
./toggle-hooks.sh off              # 禁用
./toggle-hooks.sh status           # 查看状态
```

## 🐛 故障排除

<details>
<summary><strong>通知不工作？</strong></summary>

1. 检查通知是否启用：
   ```bash
   echo $CC_HOOKS_NOTIFY
   ```

2. 验证 Claude Code hooks 配置：
   ```bash
   cat ~/.claude/settings.json | grep -A 10 hooks
   ```

3. 查看执行日志：
   ```bash
   tail -f logs/hook_execution.log
   ```

4. 手动测试：
   ```bash
   # 先导出环境变量
   export CC_HOOKS_NOTIFY=on
   ./send_smart_notification.sh
   ```

</details>

<details>
<summary><strong>权限拒绝错误？</strong></summary>

确保所有脚本都有执行权限：
```bash
chmod +x *.sh claude-notify claude-silent
```

</details>

<details>
<summary><strong>Webhook 返回 400 错误？</strong></summary>

检查你的 Lark webhook URL 并确保它是活跃的：
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"msg_type": "text", "content": {"text": "测试"}}' \
  你的_WEBHOOK_URL
```

</details>

<details>
<summary><strong>摘要显示乱码？</strong></summary>

确保你的终端和系统支持 UTF-8 编码：
```bash
export LANG=zh_CN.UTF-8
export LC_ALL=zh_CN.UTF-8
```

</details>

## 🤝 参与贡献

欢迎贡献！请随时提交 Pull Request。对于重大更改，请先开启 issue 讨论你想要改变的内容。

### 开发环境搭建

1. Fork 这个仓库
2. 创建你的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m '添加一些很棒的功能'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

### 编码规范

- 使用清晰、描述性的提交信息
- 为复杂逻辑添加注释
- 彻底测试你的更改
- 遵循现有的代码风格
- 中文注释使用简体中文

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Claude Code](https://claude.ai/code) 团队提供出色的开发环境
- [Lark/飞书](https://www.larksuite.com/) 提供 webhook 集成能力
- 所有本项目的贡献者和用户

## 📊 项目统计

![GitHub stars](https://img.shields.io/github/stars/yourusername/claude-code-hooks?style=social)
![GitHub forks](https://img.shields.io/github/forks/yourusername/claude-code-hooks?style=social)
![GitHub issues](https://img.shields.io/github/issues/yourusername/claude-code-hooks)
![GitHub pull requests](https://img.shields.io/github/issues-pr/yourusername/claude-code-hooks)

---

<div align="center">

**[⬆ 回到顶部](#-claude-code-hook-通知系统)**

用 ❤️ 为 Claude Code 社区制作

</div>