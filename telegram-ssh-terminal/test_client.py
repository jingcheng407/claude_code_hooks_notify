#!/usr/bin/env python3
"""
测试客户端 - 模拟Telegram Mini App的WebSocket连接
用于测试终端功能
"""

import asyncio
import websockets
import json
import sys
import termios
import tty
import select
from datetime import datetime


class TestClient:
    def __init__(self, device_id='test_device', user_id='123456'):
        self.device_id = device_id
        self.user_id = user_id
        self.relay_url = 'ws://localhost:8080/client'
        self.connection_id = None
        self.running = True
        
    async def connect(self):
        """连接到中继服务"""
        print(f"正在连接到中继服务: {self.relay_url}")
        
        async with websockets.connect(self.relay_url) as websocket:
            self.websocket = websocket
            
            # 发送连接请求
            await self.send_connect_request()
            
            # 启动任务
            tasks = [
                asyncio.create_task(self.read_terminal_input()),
                asyncio.create_task(self.receive_messages())
            ]
            
            await asyncio.gather(*tasks)
    
    async def send_connect_request(self):
        """发送连接请求"""
        connect_msg = {
            'type': 'connect',
            'device_id': self.device_id,
            'telegram_user_id': self.user_id,
            'auth_token': {
                'user_id': self.user_id,
                'auth_date': int(datetime.now().timestamp())
            },
            'cols': 80,
            'rows': 24
        }
        
        await self.websocket.send(json.dumps(connect_msg))
        print(f"已发送连接请求到设备: {self.device_id}")
    
    async def read_terminal_input(self):
        """读取键盘输入"""
        # 保存原始终端设置
        old_settings = termios.tcgetattr(sys.stdin)
        
        try:
            # 设置为原始模式
            tty.setraw(sys.stdin.fileno())
            
            while self.running:
                # 检查是否有输入
                if select.select([sys.stdin], [], [], 0.1)[0]:
                    char = sys.stdin.read(1)
                    
                    # Ctrl+C 退出
                    if ord(char) == 3:
                        self.running = False
                        break
                    
                    # 发送输入到服务器
                    if self.connection_id:
                        await self.websocket.send(json.dumps({
                            'type': 'terminal_input',
                            'data': char
                        }))
                
                await asyncio.sleep(0.01)
                
        finally:
            # 恢复终端设置
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
    
    async def receive_messages(self):
        """接收服务器消息"""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                
                if data['type'] == 'connection_ready':
                    self.connection_id = data.get('connection_id')
                    print(f"\r\n✅ 连接成功: {data.get('message', '')}\r\n")
                    
                elif data['type'] == 'terminal_output':
                    # 直接输出终端数据
                    sys.stdout.write(data['data'])
                    sys.stdout.flush()
                    
                elif data['type'] == 'auth_failed':
                    print(f"\r\n❌ 认证失败: {data.get('error', '')}\r\n")
                    self.running = False
                    
                elif data['type'] == 'error':
                    print(f"\r\n❌ 错误: {data.get('error', '')}\r\n")
                    self.running = False
                    
                elif data['type'] == 'device_disconnected':
                    print(f"\r\n⚠️ 设备已断开连接\r\n")
                    self.running = False
                    
        except websockets.exceptions.ConnectionClosed:
            print("\r\n连接已关闭\r\n")
            self.running = False


async def main():
    """主函数"""
    print("=" * 50)
    print("   Telegram SSH Terminal 测试客户端")
    print("=" * 50)
    print("")
    
    # 获取参数
    if len(sys.argv) > 1:
        device_id = sys.argv[1]
    else:
        device_id = input("设备ID (默认: test_device): ").strip() or "test_device"
    
    if len(sys.argv) > 2:
        user_id = sys.argv[2]
    else:
        user_id = input("Telegram用户ID (默认: 123456): ").strip() or "123456"
    
    print("")
    print(f"连接参数:")
    print(f"  设备ID: {device_id}")
    print(f"  用户ID: {user_id}")
    print("")
    print("提示: 按 Ctrl+C 退出")
    print("")
    
    # 创建客户端
    client = TestClient(device_id, user_id)
    
    try:
        await client.connect()
    except KeyboardInterrupt:
        print("\r\n退出...")
    except Exception as e:
        print(f"\r\n错误: {e}")
    finally:
        print("\r\n测试客户端已关闭")


if __name__ == '__main__':
    asyncio.run(main())