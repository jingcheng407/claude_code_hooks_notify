#!/usr/bin/env python3
"""
Debug Telegram bidirectional communication
"""
import os
import time
from telegram_bridge import TelegramBridge

# 设置环境变量
os.environ['TELEGRAM_BOT_TOKEN'] = '8349018322:AAEKsRzS6ubHUddgVU-9-71xzruZLjNlPI8'
os.environ['TELEGRAM_USER_KEY'] = 'CKE3FC42B74406'

def debug_send_and_wait():
    print("=== Debug Telegram双向通信 ===")
    
    try:
        bridge = TelegramBridge()
        print(f"✅ Bridge初始化成功")
        print(f"Chat ID: {bridge.chat_id}")
        print(f"User Key: {bridge.user_key}")
        
        # 测试发送消息
        print("\n1. 发送测试消息...")
        message = "🔧 Debug测试：请回复任何内容"
        result = bridge.send_message(message)
        
        if result:
            print("✅ 消息发送成功")
            print(f"Message ID: {result.get('result', {}).get('message_id', 'Unknown')}")
        else:
            print("❌ 消息发送失败")
            return
        
        # 等待回复
        print(f"\n2. 等待回复 (30秒)...")
        reply = bridge.wait_for_reply(timeout=30)
        
        if reply:
            print(f"✅ 收到回复: '{reply}'")
            return reply
        else:
            print("❌ 未收到回复")
            
            # 调试：检查最近的消息
            print("\n3. 检查最近的消息...")
            updates = bridge.get_updates()
            
            if updates:
                print(f"找到 {len(updates)} 条更新")
                for update in updates[-3:]:
                    if 'message' in update:
                        msg = update['message']
                        if msg.get('chat', {}).get('id') == int(bridge.chat_id):
                            print(f"- 消息: '{msg.get('text', 'No text')}'")
                            print(f"  时间: {msg.get('date')}")
                            print(f"  当前时间: {int(time.time())}")
            else:
                print("没有找到任何更新")
            
            return None
            
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    debug_send_and_wait()