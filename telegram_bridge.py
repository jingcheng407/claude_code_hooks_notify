#!/usr/bin/env python3
"""
Telegram Bridge for Claude Code Hook System
Provides one-way notification sending to Telegram
"""

import requests
import json
import sys
import os
from datetime import datetime

class TelegramBridge:
    def __init__(self, bot_token=None, chat_id=None):
        """
        Initialize Telegram bridge for one-way notifications
        
        Args:
            bot_token: Telegram bot token (from @BotFather)
            chat_id: Target chat ID (user/group)
        """
        self.bot_token = bot_token if bot_token is not None else os.getenv('TELEGRAM_BOT_TOKEN')
        self.chat_id = chat_id if chat_id is not None else os.getenv('TELEGRAM_CHAT_ID')
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN must be set")
        
        if not self.chat_id:
            raise ValueError("TELEGRAM_CHAT_ID must be set")
            
        self.api_base = f"https://api.telegram.org/bot{self.bot_token}"
    
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
            payload = {
                'chat_id': self.chat_id,
                'text': text,
                'disable_notification': disable_notification
            }
            
            if parse_mode:
                payload['parse_mode'] = parse_mode
            
            response = requests.post(
                f"{self.api_base}/sendMessage",
                json=payload,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                print(f"Telegram API error: {response.status_code} - {response.text}", file=sys.stderr)
                return None
                
        except requests.RequestException as e:
            print(f"Network error sending Telegram message: {e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"Error sending Telegram message: {e}", file=sys.stderr)
            return None

def main():
    """Command line interface for sending messages"""
    if len(sys.argv) != 3 or sys.argv[1] != 'send':
        print("Usage: python3 telegram_bridge.py send <message>", file=sys.stderr)
        sys.exit(1)
    
    try:
        bridge = TelegramBridge()
        message = sys.argv[2]
        
        result = bridge.send_message(message)
        
        if result:
            print("Message sent successfully")
            sys.exit(0)
        else:
            print("Failed to send message", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()