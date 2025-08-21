#!/usr/bin/env python3
"""
Telegram Bridge for Claude Code Hook System
Provides bidirectional communication with Telegram bot
"""

import requests
import time
import json
import sys
import os
from datetime import datetime
import logging

# 导入用户绑定管理器
try:
    from user_binding import UserBindingManager
except ImportError:
    UserBindingManager = None

class TelegramBridge:
    def __init__(self, bot_token=None, chat_id=None, user_key=None):
        """
        Initialize Telegram bridge
        
        Args:
            bot_token: Telegram bot token (from @BotFather)
            chat_id: Target chat ID (user/group) - 可选，可通过user_key获取
            user_key: 用户绑定密钥 - 用于多用户隔离
        """
        self.bot_token = bot_token if bot_token is not None else os.getenv('TELEGRAM_BOT_TOKEN')
        self.user_key = user_key if user_key is not None else os.getenv('TELEGRAM_USER_KEY')
        
        # Setup logging
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN must be set")
        
        # 如果提供了user_key，尝试通过绑定管理器获取chat_id
        if self.user_key and UserBindingManager:
            binding_manager = UserBindingManager()
            resolved_chat_id = binding_manager.get_chat_id_by_key(self.user_key)
            if resolved_chat_id:
                self.chat_id = resolved_chat_id
                self.logger.info(f"使用用户密钥 {self.user_key} 解析到 chat_id: {self.chat_id}")
            else:
                raise ValueError(f"用户密钥 {self.user_key} 无效或未绑定")
        else:
            # 兼容旧方式：直接使用chat_id
            self.chat_id = chat_id if chat_id is not None else os.getenv('TELEGRAM_CHAT_ID')
        
        if not self.chat_id:
            raise ValueError("TELEGRAM_CHAT_ID must be set or valid TELEGRAM_USER_KEY must be provided")
            
        self.api_base = f"https://api.telegram.org/bot{self.bot_token}"
        
        # 初始化绑定管理器（如果可用）
        self.binding_manager = UserBindingManager() if UserBindingManager else None
    
    def send_message(self, text, parse_mode=None, disable_notification=False):
        """
        Send message to Telegram
        
        Args:
            text: Message text
            parse_mode: 'Markdown' or 'HTML' for formatting
            disable_notification: Silent message if True
            
        Returns:
            dict: API response or None if failed
        """
        try:
            # 如果有用户密钥，在消息中添加标识（用于回复路由）
            if self.user_key:
                tagged_text = f"[{self.user_key}] {text}"
            else:
                tagged_text = text
                
            data = {
                'chat_id': self.chat_id,
                'text': tagged_text[:4096],  # Telegram message limit
            }
            
            if parse_mode:
                data['parse_mode'] = parse_mode
            if disable_notification:
                data['disable_notification'] = True
                
            response = requests.post(f"{self.api_base}/sendMessage", 
                                   json=data, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('ok'):
                    self.logger.info(f"Message sent successfully: {result['result']['message_id']}")
                    return result
                else:
                    self.logger.error(f"Telegram API error: {result.get('description')}")
            else:
                self.logger.error(f"HTTP error: {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Request failed: {e}")
        except Exception as e:
            self.logger.error(f"Unexpected error: {e}")
            
        return None
    
    def get_updates(self, offset=None, timeout=30):
        """
        Get updates from Telegram
        
        Args:
            offset: Update ID offset for pagination
            timeout: Long polling timeout
            
        Returns:
            list: List of updates or empty list if failed
        """
        try:
            params = {'timeout': timeout}
            if offset:
                params['offset'] = offset
                
            response = requests.get(f"{self.api_base}/getUpdates", 
                                  params=params, timeout=timeout + 10)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('ok'):
                    return result.get('result', [])
                else:
                    self.logger.error(f"Telegram API error: {result.get('description')}")
            else:
                self.logger.error(f"HTTP error: {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            self.logger.error(f"Request failed: {e}")
        except Exception as e:
            self.logger.error(f"Unexpected error: {e}")
            
        return []
    
    def wait_for_reply(self, timeout=300, prompt_message=None):
        """
        Wait for user reply with timeout
        
        Args:
            timeout: Maximum wait time in seconds
            prompt_message: Optional message to send first
            
        Returns:
            str: User reply text or None if timeout/error
        """
        if prompt_message:
            sent_message = self.send_message(prompt_message)
            # 记录发送的消息ID用于回复检测
            sent_message_id = sent_message.get('result', {}).get('message_id') if sent_message else None
            time.sleep(1)  # 给消息发送一些时间
        else:
            sent_message_id = None
            
        start_time = time.time()
        last_update_id = self._get_last_update_id()
        
        self.logger.info(f"Waiting for reply (timeout: {timeout}s)...")
        
        while time.time() - start_time < timeout:
            try:
                updates = self.get_updates(offset=last_update_id + 1, timeout=2)
                
                for update in updates:
                    last_update_id = max(last_update_id, update.get('update_id', 0))
                    
                    # Process text messages from target chat
                    if 'message' in update:
                        message = update['message']
                        if (message.get('chat', {}).get('id') == int(self.chat_id) and
                            'text' in message):
                            reply_text = message['text']
                            
                            # 如果启用了用户隔离，检查回复是否匹配用户密钥
                            if self.user_key:
                                # 简化回复检测：只要是来自正确用户的消息就接受
                                # 检查消息时间是否在等待开始之后
                                message_time = message.get('date', 0)
                                if message_time >= int(start_time) - 10:  # 10秒容差
                                    clean_reply = self._clean_reply_text(reply_text)
                                    self.logger.info(f"Received reply for user {self.user_key}: {clean_reply[:100]}...")
                                    return clean_reply
                            else:
                                # 兼容模式：不使用用户隔离
                                self.logger.info(f"Received reply: {reply_text[:100]}...")
                                return reply_text
                
                time.sleep(1)
                
            except Exception as e:
                self.logger.error(f"Error while waiting for reply: {e}")
                time.sleep(2)
        
        self.logger.warning(f"Timeout waiting for reply after {timeout}s")
        return None
    
    def get_latest_message(self):
        """
        Get the most recent message from target chat (non-blocking)
        
        Returns:
            dict: Message object or None
        """
        updates = self.get_updates(timeout=1)
        
        # Find the most recent message from target chat
        latest_message = None
        latest_date = 0
        
        for update in updates:
            if 'message' in update:
                message = update['message']
                if (message.get('chat', {}).get('id') == int(self.chat_id) and
                    message.get('date', 0) > latest_date):
                    latest_message = message
                    latest_date = message.get('date', 0)
        
        return latest_message
    
    def _get_last_update_id(self):
        """Get the last update ID to avoid processing old messages"""
        updates = self.get_updates(timeout=1)
        if updates:
            return max(update.get('update_id', 0) for update in updates)
        return 0
    
    def _is_reply_for_user(self, message, reply_text):
        """检查回复是否针对当前用户"""
        # 检查是否是对带有用户标识消息的回复
        if 'reply_to_message' in message:
            replied_msg = message['reply_to_message']
            if 'text' in replied_msg:
                replied_text = replied_msg['text']
                if replied_text.startswith(f"[{self.user_key}]"):
                    return True
        
        # 检查回复中是否包含用户密钥标识（用于手动指定）
        if reply_text.startswith(f"[{self.user_key}]") or f"#{self.user_key}" in reply_text:
            return True
        
        # 如果没有其他用户的标识，也认为是给当前用户的（向后兼容）
        return True
    
    def _clean_reply_text(self, reply_text):
        """清理回复文本，移除用户标识"""
        # 移除用户密钥前缀
        if reply_text.startswith(f"[{self.user_key}]"):
            reply_text = reply_text[len(f"[{self.user_key}]"):].strip()
        
        # 移除用户密钥hashtag
        reply_text = reply_text.replace(f"#{self.user_key}", "").strip()
        
        return reply_text
    
    def test_connection(self):
        """
        Test Telegram bot connection
        
        Returns:
            bool: True if connection successful
        """
        try:
            response = requests.get(f"{self.api_base}/getMe", timeout=10)
            if response.status_code == 200:
                result = response.json()
                if result.get('ok'):
                    bot_info = result['result']
                    self.logger.info(f"Bot connection OK: @{bot_info.get('username')}")
                    return True
            
            self.logger.error("Bot connection failed")
            return False
            
        except Exception as e:
            self.logger.error(f"Connection test failed: {e}")
            return False


def main():
    """Command line interface for telegram_bridge"""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 telegram_bridge.py send 'message'")
        print("  python3 telegram_bridge.py wait [timeout]")
        print("  python3 telegram_bridge.py test")
        sys.exit(1)
    
    try:
        bridge = TelegramBridge()
        command = sys.argv[1].lower()
        
        if command == 'send':
            if len(sys.argv) < 3:
                print("Error: Message text required")
                sys.exit(1)
            message = ' '.join(sys.argv[2:])
            result = bridge.send_message(message)
            if result:
                print("Message sent successfully")
            else:
                print("Failed to send message")
                sys.exit(1)
                
        elif command == 'wait':
            timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 300
            
            # 检查是否有标准输入的消息需要先发送
            prompt_message = None
            if not sys.stdin.isatty():
                try:
                    prompt_message = sys.stdin.read().strip()
                except:
                    pass
            
            reply = bridge.wait_for_reply(timeout=timeout, prompt_message=prompt_message)
            if reply:
                print(reply)
            else:
                print("No reply received")
                sys.exit(1)
                
        elif command == 'test':
            if bridge.test_connection():
                print("Connection test passed")
            else:
                print("Connection test failed")
                sys.exit(1)
        else:
            print(f"Unknown command: {command}")
            sys.exit(1)
            
    except ValueError as e:
        print(f"Configuration error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()