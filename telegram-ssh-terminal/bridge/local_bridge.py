#!/usr/bin/env python3
"""
本地终端桥接进程 - 零私钥外泄架构
运行在用户电脑上，管理终端会话并连接到中继服务
"""

import asyncio
import websockets
import json
import os
import pty
import subprocess
import select
import termios
import struct
import fcntl
import signal
import logging
import hashlib
import hmac
import time
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class LocalTerminalBridge:
    """本地终端桥接进程 - 零私钥外泄架构"""
    
    def __init__(self, config_file: str = 'config/bridge_config.json'):
        self.config = self.load_config(config_file)
        self.relay_url = self.config.get('relay_url', 'ws://localhost:8080/device')
        self.device_id = self.config.get('device_id', self.generate_device_id())
        self.device_name = self.config.get('device_name', os.uname().nodename)
        self.allowed_users = set(self.config.get('allowed_telegram_users', []))
        self.bot_token = self.config.get('bot_token', '')
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.running = True
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.reconnect_delay = 5
        self.max_reconnect_delay = 60
        
        # 设置信号处理
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
        
    def _signal_handler(self, signum, frame):
        """处理退出信号"""
        logger.info(f"收到信号 {signum}，正在优雅退出...")
        self.running = False
        
    def generate_device_id(self) -> str:
        """生成设备唯一ID"""
        import uuid
        return f"dev_{uuid.uuid4().hex[:12]}"
        
    def load_config(self, config_file: str) -> dict:
        """加载配置文件"""
        config_path = Path(config_file)
        if config_path.exists():
            try:
                with open(config_path) as f:
                    config = json.load(f)
                    logger.info(f"配置文件加载成功: {config_file}")
                    return config
            except Exception as e:
                logger.error(f"配置文件加载失败: {e}")
        
        # 返回默认配置
        default_config = {
            'relay_url': 'ws://localhost:8080/device',
            'allowed_telegram_users': [],
            'work_dir': os.environ.get('HOME', '/tmp'),
            'session_persistent': True
        }
        logger.warning("使用默认配置")
        return default_config
        
    def save_config(self):
        """保存配置到文件"""
        config_path = Path('config/bridge_config.json')
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        config_data = {
            'device_id': self.device_id,
            'device_name': self.device_name,
            'relay_url': self.relay_url,
            'allowed_telegram_users': list(self.allowed_users),
            'work_dir': self.config.get('work_dir', os.environ.get('HOME')),
            'session_persistent': self.config.get('session_persistent', True)
        }
        
        with open(config_path, 'w') as f:
            json.dump(config_data, f, indent=2)
        logger.info(f"配置已保存: {config_path}")
        
    async def start(self):
        """启动桥接服务"""
        logger.info(f"本地桥接启动: 设备ID={self.device_id}, 设备名={self.device_name}")
        
        # 保存配置
        self.save_config()
        
        # 连接到中继服务
        await self.connect_to_relay()
        
    async def connect_to_relay(self):
        """维护到中继服务的持久连接，支持自动重连"""
        current_delay = self.reconnect_delay
        
        while self.running:
            try:
                logger.info(f"正在连接到中继服务: {self.relay_url}")
                
                async with websockets.connect(
                    self.relay_url,
                    ping_interval=30,
                    ping_timeout=10
                ) as websocket:
                    self.websocket = websocket
                    logger.info("成功连接到中继服务")
                    
                    # 重置重连延迟
                    current_delay = self.reconnect_delay
                    
                    # 注册设备
                    await self.register_device()
                    
                    # 处理消息
                    await self.handle_relay_messages()
                    
            except websockets.exceptions.ConnectionClosed as e:
                logger.warning(f"连接关闭: {e}")
            except Exception as e:
                logger.error(f"连接错误: {e}")
            finally:
                self.websocket = None
                
            if self.running:
                logger.info(f"{current_delay}秒后重试连接...")
                await asyncio.sleep(current_delay)
                # 指数退避
                current_delay = min(current_delay * 2, self.max_reconnect_delay)
                
    async def register_device(self):
        """向中继服务注册设备"""
        register_msg = {
            'type': 'device_register',
            'device_id': self.device_id,
            'device_name': self.device_name,
            'platform': os.uname().sysname,
            'status': 'online',
            'capabilities': {
                'terminal': True,
                'tmux': self.check_tmux_available(),
                'file_transfer': False
            }
        }
        
        await self.websocket.send(json.dumps(register_msg))
        logger.info(f"设备已注册: {self.device_id}")
        
    def check_tmux_available(self) -> bool:
        """检查tmux是否可用"""
        try:
            result = subprocess.run(['which', 'tmux'], capture_output=True)
            return result.returncode == 0
        except:
            return False
            
    async def handle_relay_messages(self):
        """处理来自中继的消息"""
        async for message in self.websocket:
            try:
                data = json.loads(message)
                msg_type = data.get('type')
                
                if msg_type == 'client_connect':
                    await self.handle_client_connect(data)
                elif msg_type == 'terminal_input':
                    await self.handle_terminal_input(data)
                elif msg_type == 'terminal_resize':
                    await self.handle_terminal_resize(data)
                elif msg_type == 'client_disconnect':
                    await self.handle_client_disconnect(data)
                elif msg_type == 'ping':
                    await self.websocket.send(json.dumps({'type': 'pong'}))
                else:
                    logger.warning(f"未知消息类型: {msg_type}")
                    
            except json.JSONDecodeError as e:
                logger.error(f"消息解析失败: {e}")
            except Exception as e:
                logger.error(f"处理消息错误: {e}")
                
    async def handle_client_connect(self, data: dict):
        """处理客户端连接请求"""
        connection_id = data.get('connection_id')
        auth_token = data.get('auth_token', {})
        telegram_user_id = str(data.get('telegram_user_id', ''))
        
        logger.info(f"客户端连接请求: {connection_id}, 用户: {telegram_user_id}")
        
        # 验证Telegram用户权限
        if not self.verify_telegram_auth(auth_token, telegram_user_id):
            await self.send_auth_failed(connection_id)
            return
            
        # 创建或恢复终端会话
        try:
            await self.create_terminal_session(connection_id, telegram_user_id)
            
            # 发送连接成功消息
            await self.websocket.send(json.dumps({
                'type': 'connection_ready',
                'connection_id': connection_id,
                'message': f'已连接到 {self.device_name}'
            }))
            
        except Exception as e:
            logger.error(f"创建会话失败: {e}")
            await self.websocket.send(json.dumps({
                'type': 'connection_failed',
                'connection_id': connection_id,
                'error': str(e)
            }))
            
    def verify_telegram_auth(self, auth_token: dict, telegram_user_id: str) -> bool:
        """验证Telegram认证"""
        # 如果没有设置允许用户列表，默认拒绝所有
        if not self.allowed_users:
            logger.warning("未配置允许的用户列表")
            return False
            
        # 检查用户是否在白名单中
        if telegram_user_id not in self.allowed_users:
            logger.warning(f"用户 {telegram_user_id} 不在白名单中")
            return False
            
        # TODO: 实现完整的Telegram initData HMAC验证
        # 这里简化处理，实际应该验证auth_token的签名
        
        return True
        
    async def send_auth_failed(self, connection_id: str):
        """发送认证失败消息"""
        await self.websocket.send(json.dumps({
            'type': 'auth_failed',
            'connection_id': connection_id,
            'error': '认证失败：您没有访问此设备的权限'
        }))
        
    async def create_terminal_session(self, connection_id: str, user_id: str):
        """创建终端会话"""
        # 检查是否已有会话
        if connection_id in self.sessions:
            logger.info(f"会话已存在: {connection_id}")
            return
            
        # 创建PTY
        master_fd, slave_fd = pty.openpty()
        
        # 设置终端属性
        attrs = termios.tcgetattr(master_fd)
        attrs[3] = attrs[3] & ~termios.ECHO  # 关闭回显
        termios.tcsetattr(master_fd, termios.TCSANOW, attrs)
        
        # 准备启动命令
        if self.check_tmux_available() and self.config.get('session_persistent', True):
            # 使用tmux实现会话持久化
            session_name = f"claude_{user_id}"
            cmd = ['tmux', 'new-session', '-A', '-s', session_name]
        else:
            # 直接启动shell
            shell = os.environ.get('SHELL', '/bin/bash')
            cmd = [shell]
            
        # 设置环境变量
        env = os.environ.copy()
        env['TERM'] = 'xterm-256color'
        env['CC_HOOKS_NOTIFY'] = 'on'
        env['LANG'] = 'en_US.UTF-8'
        
        # 启动进程
        process = subprocess.Popen(
            cmd,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            cwd=self.config.get('work_dir', os.environ.get('HOME')),
            preexec_fn=os.setsid
        )
        
        # 关闭slave端
        os.close(slave_fd)
        
        # 保存会话信息
        self.sessions[connection_id] = {
            'master_fd': master_fd,
            'process': process,
            'user_id': user_id,
            'created_at': datetime.now().isoformat()
        }
        
        logger.info(f"终端会话创建成功: {connection_id}")
        
        # 启动输出读取任务
        asyncio.create_task(self.read_terminal_output(connection_id))
        
    async def read_terminal_output(self, connection_id: str):
        """读取终端输出并发送到客户端"""
        session = self.sessions.get(connection_id)
        if not session:
            return
            
        master_fd = session['master_fd']
        loop = asyncio.get_event_loop()
        
        while connection_id in self.sessions and self.websocket:
            try:
                # 使用select检查是否有数据可读
                readable, _, _ = select.select([master_fd], [], [], 0.1)
                
                if readable:
                    # 非阻塞读取
                    output = os.read(master_fd, 4096)
                    
                    if output:
                        # 发送到客户端
                        await self.websocket.send(json.dumps({
                            'type': 'terminal_output',
                            'connection_id': connection_id,
                            'data': output.decode('utf-8', errors='replace')
                        }))
                    else:
                        # 进程已结束
                        break
                        
                # 检查进程是否还在运行
                if session['process'].poll() is not None:
                    logger.info(f"终端进程已结束: {connection_id}")
                    break
                    
                await asyncio.sleep(0.01)
                
            except OSError as e:
                if e.errno == 5:  # Input/output error
                    logger.info(f"终端已关闭: {connection_id}")
                    break
                else:
                    logger.error(f"读取终端输出错误: {e}")
                    break
            except Exception as e:
                logger.error(f"读取输出异常: {e}")
                break
                
        # 清理会话
        await self.cleanup_session(connection_id)
        
    async def handle_terminal_input(self, data: dict):
        """处理终端输入"""
        connection_id = data.get('connection_id')
        input_data = data.get('data', '')
        
        session = self.sessions.get(connection_id)
        if not session:
            logger.warning(f"会话不存在: {connection_id}")
            return
            
        try:
            # 写入到PTY
            os.write(session['master_fd'], input_data.encode('utf-8'))
        except Exception as e:
            logger.error(f"写入终端失败: {e}")
            
    async def handle_terminal_resize(self, data: dict):
        """处理终端尺寸调整"""
        connection_id = data.get('connection_id')
        cols = data.get('cols', 80)
        rows = data.get('rows', 24)
        
        session = self.sessions.get(connection_id)
        if not session:
            return
            
        try:
            # 设置PTY窗口大小
            fcntl.ioctl(
                session['master_fd'],
                termios.TIOCSWINSZ,
                struct.pack('HHHH', rows, cols, 0, 0)
            )
            logger.info(f"终端尺寸调整: {cols}x{rows}")
        except Exception as e:
            logger.error(f"调整终端尺寸失败: {e}")
            
    async def handle_client_disconnect(self, data: dict):
        """处理客户端断开连接"""
        connection_id = data.get('connection_id')
        logger.info(f"客户端断开连接: {connection_id}")
        
        # 如果不是持久会话，清理资源
        if not self.config.get('session_persistent', True):
            await self.cleanup_session(connection_id)
            
    async def cleanup_session(self, connection_id: str):
        """清理会话资源"""
        session = self.sessions.get(connection_id)
        if not session:
            return
            
        try:
            # 关闭PTY
            os.close(session['master_fd'])
            
            # 终止进程
            if session['process'].poll() is None:
                session['process'].terminate()
                await asyncio.sleep(0.5)
                if session['process'].poll() is None:
                    session['process'].kill()
                    
            # 删除会话
            del self.sessions[connection_id]
            logger.info(f"会话已清理: {connection_id}")
            
        except Exception as e:
            logger.error(f"清理会话失败: {e}")
            
    async def shutdown(self):
        """优雅关闭"""
        logger.info("正在关闭桥接服务...")
        self.running = False
        
        # 清理所有会话
        for connection_id in list(self.sessions.keys()):
            await self.cleanup_session(connection_id)
            
        # 关闭WebSocket连接
        if self.websocket:
            await self.websocket.close()
            
        logger.info("桥接服务已关闭")


async def main():
    """主函数"""
    # 创建配置目录
    Path('config').mkdir(exist_ok=True)
    
    # 创建桥接实例
    bridge = LocalTerminalBridge()
    
    try:
        # 启动服务
        await bridge.start()
    except KeyboardInterrupt:
        logger.info("收到中断信号")
    finally:
        await bridge.shutdown()


if __name__ == '__main__':
    asyncio.run(main())