# Claude Code Hook 通知系统

智能的 Claude Code 完成通知系统，支持 Lark 机器人推送。

## 功能特性

- 🤖 智能对话摘要生成（支持多媒体消息）
- ⏱️ 自动计算任务耗时
- 🔔 Lark 机器人实时通知
- 📊 详细的执行日志记录
- 🎛️ 灵活的通知开关控制

## 通知控制

### 方法1：使用切换脚本（推荐）

```bash
# 查看当前状态
./toggle-hooks.sh status

# 禁用通知
./toggle-hooks.sh off

# 启用通知  
./toggle-hooks.sh on
```

### 方法2：使用启动脚本

```bash
# 启动 Claude（默认通知禁用）
claude

# 启动 Claude 但禁用通知（明确禁用）
./claude-silent

# 启动 Claude 并启用通知
./claude-notify
```

### 方法3：使用环境变量

```bash
# 临时启用通知
CC_HOOKS_NOTIFY=on claude

# 持久启用通知（添加到 .bashrc/.zshrc）
export CC_HOOKS_NOTIFY=on

# 支持的启用值：on/ON/enabled/true/1
# 默认状态：禁用通知
```

## 文件说明

- `send_smart_notification.sh` - 主 Hook 脚本
- `generate_summary.py` - 智能摘要生成器
- `toggle-hooks.sh` - 通知开关控制脚本
- `claude-silent` - 静默启动脚本
- `logs/` - 执行日志目录

## 安装配置

1. 将脚本路径添加到 Claude Code settings.json 的 hooks 配置中
2. 确保脚本有执行权限：`chmod +x *.sh`
3. 根据需要调整 Lark webhook URL

## 通知示例

```
🤖 Claude Code 完成通知

📋 摘要: 最近请求: 创建React组件 | 执行了: Write, Edit | 共3轮对话
⏱️ 耗时: 2分30秒

⏰ 时间: 2025-08-21 15:30:45
📂 目录: /Users/username/project
```

## 快速使用

```bash
# 默认禁用通知
claude

# 启用通知方式
CC_HOOKS_NOTIFY=on claude           # 环境变量
./claude-notify                     # 启动脚本
./toggle-hooks.sh on               # 配置文件
```