# Claude Code Hook 通知系统安装指南

## 自动化安装步骤

### 1. 克隆项目
```bash
git clone https://github.com/yourusername/claude-code-hooks.git
cd claude-code-hooks
```

### 2. 在 Claude Code 中运行安装
复制以下 prompt 并粘贴到 Claude Code，替换你的 Lark webhook URL：

```
请帮我安装这个 Claude Code Hook 通知系统。

我的 Lark webhook URL 是：https://open.larksuite.com/open-apis/bot/v2/hook/YOUR_WEBHOOK_HERE

请执行以下安装步骤：
1. 设置所有脚本文件的执行权限（chmod +x *.sh claude-notify claude-silent）
2. 读取当前的 ~/.claude/settings.json 配置
3. 在 settings.json 中添加 Stop hook 配置，指向当前目录的 send_smart_notification.sh
4. 在 send_smart_notification.sh 中替换 WEBHOOK_URL 为我提供的地址
5. 创建 logs 目录
6. 运行测试验证安装是否成功

如果 ~/.claude/settings.json 不存在，请创建一个新的配置文件。
如果已存在 hooks 配置，请合并而不是覆盖。

安装完成后，请告诉我如何测试通知功能。
```

### 3. 测试安装
安装完成后，Claude 会指导你进行测试。

### 4. 开始使用
```bash
# 启用通知
CC_HOOKS_NOTIFY=on claude

# 或使用启动器
./claude-notify
```

## 注意事项

### 系统要求
- macOS 或 Linux 系统
- 已安装 Claude Code
- Python 3.7+
- Bash shell
- 有效的 Lark/飞书 webhook URL

### 重要提醒
1. **Webhook URL**：确保你的 Lark/飞书机器人 webhook 是有效的
2. **权限问题**：如果遇到权限错误，手动运行 `chmod +x *.sh claude-notify claude-silent`
3. **配置备份**：安装前建议备份你的 `~/.claude/settings.json` 文件
4. **测试验证**：安装后务必测试通知功能是否正常工作

### 故障排除
如果安装过程中遇到问题：
1. 检查 `logs/hook_execution.log` 文件
2. 确认所有脚本文件有执行权限
3. 验证 webhook URL 格式正确
4. 确认 Claude Code 配置文件路径正确

### 卸载方法
如需卸载：
1. 编辑 `~/.claude/settings.json`，移除 hooks 配置
2. 删除项目目录