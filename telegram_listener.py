#!/usr/bin/env python3
"""
Telegram监听器 - 持续监听Telegram消息并输出到标准输出
用于Claude Code的stdin代理模式
"""

import time
import sys
import os
import signal
import logging
from telegram_bridge import TelegramBridge

class TelegramListener:
    def __init__(self):
        self.bridge = TelegramBridge()
        self.running = True
        self.last_update_id = 0
        
        # 设置日志
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
        
        # 设置信号处理
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
        
    def _signal_handler(self, signum, frame):
        """处理退出信号"""
        self.logger.info(f"收到信号 {signum}，正在退出...")
        self.running = False
        
    def _get_last_update_id(self):
        """获取最后的更新ID，避免重复处理消息"""
        updates = self.bridge.get_updates(timeout=1)
        if updates:
            return max(update.get('update_id', 0) for update in updates)
        return 0
        
    def listen(self, output_pipe=None):
        """
        持续监听Telegram消息
        
        Args:
            output_pipe: 输出管道路径，如果为None则输出到stdout
        """
        self.logger.info("Telegram监听器启动...")
        
        # 获取初始的update_id
        self.last_update_id = self._get_last_update_id()
        self.logger.info(f"初始update_id: {self.last_update_id}")
        
        # 打开输出流
        if output_pipe:
            try:
                output = open(output_pipe, 'w')
                self.logger.info(f"输出到管道: {output_pipe}")
            except Exception as e:
                self.logger.error(f"无法打开输出管道: {e}")
                return
        else:
            output = sys.stdout
            self.logger.info("输出到标准输出")
            
        try:
            while self.running:
                try:
                    # 获取新的更新
                    updates = self.bridge.get_updates(
                        offset=self.last_update_id + 1 if self.last_update_id > 0 else None,
                        timeout=5
                    )
                    
                    for update in updates:
                        self.last_update_id = max(self.last_update_id, update.get('update_id', 0))
                        
                        # 处理文本消息
                        if 'message' in update:
                            message = update['message']
                            
                            # 检查是否来自目标聊天
                            if (message.get('chat', {}).get('id') == int(self.bridge.chat_id) and
                                'text' in message):
                                
                                text = message['text']
                                
                                # 如果启用了用户隔离，清理消息
                                if self.bridge.user_key:
                                    text = self.bridge._clean_reply_text(text)
                                
                                # 过滤掉空消息和机器人自己的消息
                                if text.strip() and not message.get('from', {}).get('is_bot', False):
                                    self.logger.info(f"收到用户消息: {text[:50]}...")
                                    
                                    # 输出消息到管道/stdout
                                    output.write(f"{text}\n")
                                    output.flush()
                    
                    # 短暂休息
                    if not updates:
                        time.sleep(1)
                        
                except Exception as e:
                    self.logger.error(f"监听过程中出错: {e}")
                    time.sleep(5)
                    
        except KeyboardInterrupt:
            self.logger.info("收到键盘中断")
        finally:
            if output != sys.stdout:
                output.close()
            self.logger.info("Telegram监听器已停止")

def main():
    """命令行接口"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Telegram消息监听器')
    parser.add_argument('--output', '-o', help='输出管道路径')
    parser.add_argument('--test', action='store_true', help='测试模式')
    
    args = parser.parse_args()
    
    try:
        listener = TelegramListener()
        
        if args.test:
            print("测试模式：监听5条消息后退出")
            count = 0
            start_time = time.time()
            
            while count < 5 and time.time() - start_time < 30:
                updates = listener.bridge.get_updates(timeout=2)
                for update in updates:
                    if 'message' in update:
                        message = update['message']
                        if (message.get('chat', {}).get('id') == int(listener.bridge.chat_id) and
                            'text' in message):
                            print(f"收到消息: {message['text']}")
                            count += 1
                            
            print("测试完成")
        else:
            listener.listen(args.output)
            
    except KeyboardInterrupt:
        print("\n程序被中断")
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()