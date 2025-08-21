#!/usr/bin/env python3
"""
Telegram Bot Handler for Claude Code Hook System
处理机器人命令和用户绑定流程
"""

import json
import time
import re
from telegram_bridge import TelegramBridge
from user_binding import UserBindingManager

class TelegramBotHandler:
    def __init__(self, bot_token):
        self.bot_token = bot_token
        self.binding_manager = UserBindingManager()
        self.last_update_id = 0  # 跟踪最后处理的更新ID
        
    def process_updates(self):
        """处理Telegram更新"""
        # 创建一个临时的bridge实例来获取更新（不需要chat_id）
        temp_bridge = TelegramBridge(bot_token=self.bot_token, chat_id="0")
        temp_bridge.chat_id = None  # 重置chat_id以避免发送到错误的聊天
        
        # 使用offset避免重复处理相同消息
        updates = temp_bridge.get_updates(offset=self.last_update_id + 1 if self.last_update_id > 0 else None)
        
        for update in updates:
            update_id = update.get('update_id', 0)
            
            # 更新最后处理的ID
            if update_id > self.last_update_id:
                self.last_update_id = update_id
            
            if 'message' in update:
                message = update['message']
                if 'text' in message:
                    self.handle_message(message)
    
    def handle_message(self, message):
        """处理收到的消息"""
        chat_id = message['chat']['id']
        text = message.get('text', '')
        username = message.get('from', {}).get('username', 'Unknown')
        
        print(f"收到消息来自 {username} (chat_id: {chat_id}): {text}")
        
        # 处理命令
        if text.startswith('/'):
            self.handle_command(chat_id, text, username)
        else:
            # 处理非命令消息，可能是绑定确认
            self.handle_text_message(chat_id, text, username)
    
    def handle_command(self, chat_id, command, username):
        """处理命令"""
        if command.startswith('/bind'):
            self.handle_bind_command(chat_id, username)
        elif command.startswith('/start'):
            self.handle_start_command(chat_id, username)
        elif command.startswith('/help'):
            self.handle_help_command(chat_id)
        elif command.startswith('/status'):
            self.handle_status_command(chat_id)
        else:
            self.send_message(chat_id, f"未知命令: {command}\n使用 /help 查看可用命令")
    
    def handle_bind_command(self, chat_id, username):
        """处理绑定命令"""
        try:
            # 生成绑定密钥
            user_key = self.binding_manager.create_binding_request(chat_id, username)
            
            message = f"""🔗 绑定密钥生成成功！

🔑 **用户密钥**: `{user_key}`

📋 **使用方法**:
1. 复制上面的用户密钥
2. 在你的项目配置文件 `config.sh` 中设置:
   ```
   TELEGRAM_USER_KEY="{user_key}"
   ```
3. 运行你的Claude Code项目，密钥将自动激活

⏰ **注意**: 密钥有效期为10分钟，请及时使用！

如需帮助，发送 /help 查看详细说明。"""

            self.send_message(chat_id, message, parse_mode='Markdown')
            
        except Exception as e:
            self.send_message(chat_id, f"生成绑定密钥失败: {str(e)}")
    
    def handle_start_command(self, chat_id, username):
        """处理开始命令"""
        message = f"""👋 欢迎使用 Claude Code Hook 通知系统！

我是 Claude Code Father Bot，可以为你提供与Claude Code的双向通信功能。

🚀 **快速开始**:
• 发送 `/bind` 获取绑定密钥
• 发送 `/help` 查看帮助信息
• 发送 `/status` 查看绑定状态

🔧 **功能特色**:
✅ 智能通知推送
✅ 双向交互通信  
✅ 多用户隔离
✅ 安全绑定机制

让我们开始吧！发送 `/bind` 来获取你的专属绑定密钥。"""

        self.send_message(chat_id, message)
    
    def handle_help_command(self, chat_id):
        """处理帮助命令"""
        message = """📚 **Claude Code Hook 帮助文档**

🔑 **命令列表**:
• `/start` - 开始使用
• `/bind` - 生成绑定密钥
• `/status` - 查看绑定状态  
• `/help` - 显示此帮助信息

🔗 **绑定流程**:
1. 发送 `/bind` 命令
2. 复制返回的用户密钥
3. 在项目中配置密钥:
   ```
   TELEGRAM_USER_KEY="CK12345678"
   ```
4. 运行项目，密钥自动激活

💬 **交互方式**:
• **回复消息**: 直接回复机器人发送的消息
• **手动标记**: 在消息前加 `[密钥]` 或使用 `#密钥`
• **示例**: `#CK12345678 继续执行`

🔒 **安全说明**:
• 每个用户有独立的密钥，消息完全隔离
• 密钥有效期10分钟，使用后永久激活
• 可随时重新生成新密钥

🆘 **常见问题**:
• 密钥过期: 重新发送 `/bind`
• 收不到通知: 检查项目配置和密钥
• 多项目使用: 每个项目使用相同密钥即可

📞 **技术支持**: 
项目地址: https://github.com/claude-code-hooks"""

        self.send_message(chat_id, message, parse_mode='Markdown')
    
    def handle_status_command(self, chat_id):
        """处理状态查询命令"""
        try:
            # 查找用户的绑定状态
            user_key = self.binding_manager.get_user_key_by_chat_id(chat_id)
            
            if user_key:
                bindings = self.binding_manager.list_bindings()
                user_data = bindings.get(user_key, {})
                
                last_used = user_data.get('last_used', 0)
                if last_used > 0:
                    last_used_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(last_used))
                else:
                    last_used_str = '从未使用'
                
                created_at = user_data.get('created_at', 0)
                created_at_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(created_at))
                
                message = f"""✅ **绑定状态**: 已激活

🔑 **用户密钥**: `{user_key}`
📅 **创建时间**: {created_at_str}
🕒 **最后使用**: {last_used_str}
💾 **状态**: {user_data.get('status', '未知')}

🎯 **使用提示**:
你的密钥已激活，可以在Claude Code项目中使用。配置方法：

```
TELEGRAM_USER_KEY="{user_key}"
TELEGRAM_MODE="on"
```

如需重新绑定，发送 `/bind` 生成新密钥。"""

                self.send_message(chat_id, message, parse_mode='Markdown')
                
            else:
                message = """❌ **绑定状态**: 未绑定

🔧 **如何绑定**:
发送 `/bind` 命令获取绑定密钥，然后在你的项目中配置即可。

📚 需要帮助？发送 `/help` 查看详细说明。"""

                self.send_message(chat_id, message, parse_mode='Markdown')
                
        except Exception as e:
            self.send_message(chat_id, f"查询状态失败: {str(e)}")
    
    def handle_text_message(self, chat_id, text, username):
        """处理普通文本消息"""
        # 检查是否是绑定密钥格式（CK开头的12位字符）
        if re.match(r'^CK[A-F0-9]{12}$', text.strip().upper()):
            user_key = text.strip().upper()
            
            # 尝试确认绑定
            success, message = self.binding_manager.confirm_binding(user_key)
            
            if success:
                self.send_message(chat_id, f"🎉 {message}")
            else:
                self.send_message(chat_id, f"❌ {message}")
        else:
            # 普通消息，可能需要特殊处理
            pass
    
    def send_message(self, chat_id, text, parse_mode=None):
        """发送消息"""
        try:
            bridge = TelegramBridge(bot_token=self.bot_token, chat_id=str(chat_id))
            bridge.send_message(text, parse_mode=parse_mode)
        except Exception as e:
            print(f"发送消息失败: {e}")


def main():
    """主函数 - 可用于测试"""
    import os
    import sys
    
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
    if not bot_token:
        print("错误: 未设置 TELEGRAM_BOT_TOKEN 环境变量")
        sys.exit(1)
    
    handler = TelegramBotHandler(bot_token)
    
    print("开始处理Telegram更新...")
    try:
        while True:
            handler.process_updates()
            time.sleep(2)  # 避免过于频繁的请求
    except KeyboardInterrupt:
        print("\n停止处理更新")


if __name__ == "__main__":
    main()