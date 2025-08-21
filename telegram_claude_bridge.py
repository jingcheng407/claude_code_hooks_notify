#!/usr/bin/env python3
"""
Telegram-Claude双向桥接器
实现Telegram消息与Claude Code之间的持续双向通信
"""

import subprocess
import threading
import time
import sys
import os
import signal
import logging
from telegram_bridge import TelegramBridge

class TelegramClaudeBridge:
    def __init__(self):
        self.bridge = TelegramBridge()
        self.claude_process = None
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
        self.stop()
        
    def _get_last_update_id(self):
        """获取最后的更新ID"""
        updates = self.bridge.get_updates(timeout=1)
        if updates:
            return max(update.get('update_id', 0) for update in updates)
        return 0
    
    def start_claude(self):
        """启动Claude Code进程"""
        try:
            self.claude_process = subprocess.Popen(
                ['claude', 'code'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            self.logger.info(f"Claude Code启动 (PID: {self.claude_process.pid})")
            return True
        except Exception as e:
            self.logger.error(f"启动Claude Code失败: {e}")
            return False
    
    def send_to_claude(self, message):
        """向Claude Code发送消息"""
        if self.claude_process and self.claude_process.poll() is None:
            try:
                self.claude_process.stdin.write(message + '\n')
                self.claude_process.stdin.flush()
                self.logger.info(f"发送给Claude: {message[:50]}...")
                return True
            except Exception as e:
                self.logger.error(f"发送消息给Claude失败: {e}")
        return False
    
    def read_claude_output(self):
        """读取Claude Code的输出（非阻塞）"""
        if not self.claude_process:
            return None
            
        # 检查是否有输出可读
        # 注意：这是一个简化版本，实际可能需要更复杂的非阻塞读取
        try:
            # 使用select或其他机制来非阻塞读取
            import select
            if hasattr(select, 'select'):
                ready, _, _ = select.select([self.claude_process.stdout], [], [], 0.1)
                if ready:
                    line = self.claude_process.stdout.readline()
                    return line.strip() if line else None
        except:
            pass
        return None
    
    def telegram_listener(self):
        """Telegram消息监听线程"""
        self.logger.info("Telegram监听线程启动")
        self.last_update_id = self._get_last_update_id()
        
        while self.running:
            try:
                updates = self.bridge.get_updates(
                    offset=self.last_update_id + 1 if self.last_update_id > 0 else None,
                    timeout=2
                )
                
                for update in updates:
                    self.last_update_id = max(self.last_update_id, update.get('update_id', 0))
                    
                    if 'message' in update:
                        message = update['message']
                        
                        if (message.get('chat', {}).get('id') == int(self.bridge.chat_id) and
                            'text' in message):
                            
                            text = message['text']
                            
                            # 清理用户标识
                            if self.bridge.user_key:
                                text = self.bridge._clean_reply_text(text)
                            
                            # 过滤机器人消息和空消息
                            if text.strip() and not message.get('from', {}).get('is_bot', False):
                                self.logger.info(f"收到Telegram消息: {text[:50]}...")
                                
                                # 处理特殊命令
                                if text.lower() in ['/quit', '/exit', '退出']:
                                    self.logger.info("收到退出命令")
                                    self.stop()
                                    break
                                
                                # 转发给Claude
                                self.send_to_claude(text)
                
                time.sleep(1)
                
            except Exception as e:
                self.logger.error(f"监听Telegram消息时出错: {e}")
                time.sleep(5)
        
        self.logger.info("Telegram监听线程结束")
    
    def claude_output_handler(self):
        """Claude输出处理线程"""
        self.logger.info("Claude输出处理线程启动")
        
        while self.running and self.claude_process:
            try:
                # 读取Claude的输出
                if self.claude_process.poll() is None:  # Claude还在运行
                    output = self.read_claude_output()
                    if output:
                        self.logger.info(f"Claude输出: {output[:50]}...")
                        # 可以选择将输出发送回Telegram，或者依赖hook系统
                        # self.bridge.send_message(f"Claude: {output}")
                else:
                    self.logger.info("Claude进程已退出")
                    break
                    
                time.sleep(0.5)
                
            except Exception as e:
                self.logger.error(f"处理Claude输出时出错: {e}")
                time.sleep(2)
        
        self.logger.info("Claude输出处理线程结束")
    
    def run(self):
        """运行桥接器"""
        self.logger.info("启动Telegram-Claude桥接器")
        
        # 发送启动消息
        welcome_msg = """🚀 Claude Code Telegram桥接器已启动

现在你可以：
- 直接发送消息与Claude Code对话  
- 发送 /quit 或 /exit 退出桥接模式
- Claude的回复会通过通知系统发送到Telegram

💡 保持终端窗口打开，开始你的对话吧！"""
        
        self.bridge.send_message(welcome_msg)
        
        # 启动Claude Code
        if not self.start_claude():
            return False
        
        # 启动监听线程
        telegram_thread = threading.Thread(target=self.telegram_listener)
        telegram_thread.daemon = True
        telegram_thread.start()
        
        claude_thread = threading.Thread(target=self.claude_output_handler)
        claude_thread.daemon = True
        claude_thread.start()
        
        print("🤖 桥接器运行中...")
        print(f"- Claude Code PID: {self.claude_process.pid}")
        print("- Telegram监听: 活跃")
        print("- 按 Ctrl+C 退出")
        print()
        
        try:
            # 主循环：保持程序运行并监控子进程
            while self.running:
                # 检查Claude进程是否还在运行
                if self.claude_process and self.claude_process.poll() is not None:
                    self.logger.info("Claude进程已退出")
                    break
                    
                time.sleep(1)
                
        except KeyboardInterrupt:
            self.logger.info("收到键盘中断")
        
        self.stop()
        return True
    
    def stop(self):
        """停止桥接器"""
        self.running = False
        
        if self.claude_process:
            self.logger.info("停止Claude进程...")
            try:
                self.claude_process.terminate()
                self.claude_process.wait(timeout=5)
            except:
                self.claude_process.kill()
        
        self.bridge.send_message("🛑 Claude Code桥接器已停止")
        self.logger.info("桥接器已停止")

def main():
    """主函数"""
    try:
        bridge = TelegramClaudeBridge()
        bridge.run()
    except Exception as e:
        print(f"错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()