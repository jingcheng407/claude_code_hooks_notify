# Claude Code 安装提示词

复制以下内容到 Claude Code 中，替换你的 Lark webhook URL：

---

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

安装要求：
- 如果 ~/.claude/settings.json 不存在，请创建一个新的配置文件
- 如果已存在 hooks 配置，请合并而不是覆盖现有配置
- 确保使用绝对路径配置脚本位置
- 验证 webhook URL 格式正确
- 测试通知功能是否正常工作

安装完成后，请告诉我：
1. 配置文件的具体变更内容
2. 如何测试通知功能
3. 如何启用/禁用通知

---

**使用说明**：将上述内容复制到 Claude Code 中，记得替换 YOUR_WEBHOOK_HERE 为你的实际 webhook 地址。