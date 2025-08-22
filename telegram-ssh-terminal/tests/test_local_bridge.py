#!/usr/bin/env python3
"""
本地桥接进程测试用例
"""

import pytest
import asyncio
import json
import os
import sys
from unittest.mock import Mock, patch, AsyncMock, MagicMock, mock_open
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / 'bridge'))

from local_bridge import LocalTerminalBridge


class TestLocalTerminalBridge:
    """本地桥接进程测试"""
    
    @pytest.fixture
    def mock_config(self):
        """模拟配置"""
        return {
            'device_id': 'test_device_123',
            'device_name': 'Test Computer',
            'relay_url': 'ws://localhost:8080/device',
            'allowed_telegram_users': ['123456', '789012'],
            'bot_token': 'test_bot_token',
            'work_dir': '/tmp',
            'session_persistent': True
        }
    
    @pytest.fixture
    def bridge(self, mock_config):
        """创建测试用桥接实例"""
        with patch('local_bridge.LocalTerminalBridge.load_config') as mock_load:
            mock_load.return_value = mock_config
            bridge = LocalTerminalBridge('test_config.json')
            return bridge
    
    def test_init(self, bridge, mock_config):
        """测试初始化"""
        assert bridge.device_id == mock_config['device_id']
        assert bridge.device_name == mock_config['device_name']
        assert bridge.relay_url == mock_config['relay_url']
        assert bridge.allowed_users == set(mock_config['allowed_telegram_users'])
        assert bridge.running == True
        assert len(bridge.sessions) == 0
    
    def test_generate_device_id(self, bridge):
        """测试设备ID生成"""
        device_id = bridge.generate_device_id()
        assert device_id.startswith('dev_')
        assert len(device_id) == 16  # dev_ + 12个字符
        
        # 测试生成的ID唯一性
        id2 = bridge.generate_device_id()
        assert device_id != id2
    
    def test_load_config_file_exists(self):
        """测试配置文件加载 - 文件存在"""
        config_data = {
            'device_id': 'test123',
            'relay_url': 'ws://test.com'
        }
        
        with patch('builtins.open', mock_open(read_data=json.dumps(config_data))):
            with patch('pathlib.Path.exists', return_value=True):
                bridge = LocalTerminalBridge('config.json')
                config = bridge.config
                assert config['device_id'] == 'test123'
                assert config['relay_url'] == 'ws://test.com'
    
    def test_load_config_file_not_exists(self):
        """测试配置文件加载 - 文件不存在"""
        with patch('pathlib.Path.exists', return_value=False):
            bridge = LocalTerminalBridge('config.json')
            config = bridge.config
            # 应该返回默认配置
            assert config['relay_url'] == 'ws://localhost:8080/device'
            assert config['session_persistent'] == True
    
    def test_verify_telegram_auth_no_users(self, bridge):
        """测试Telegram认证 - 未配置用户"""
        bridge.allowed_users = set()
        assert bridge.verify_telegram_auth({}, '123456') == False
    
    def test_verify_telegram_auth_user_not_allowed(self, bridge):
        """测试Telegram认证 - 用户不在白名单"""
        assert bridge.verify_telegram_auth({}, '999999') == False
    
    def test_verify_telegram_auth_user_allowed(self, bridge):
        """测试Telegram认证 - 用户在白名单"""
        assert bridge.verify_telegram_auth({}, '123456') == True
        assert bridge.verify_telegram_auth({}, '789012') == True
    
    def test_check_tmux_available(self, bridge):
        """测试tmux可用性检查"""
        with patch('subprocess.run') as mock_run:
            # 模拟tmux存在
            mock_run.return_value = Mock(returncode=0)
            assert bridge.check_tmux_available() == True
            
            # 模拟tmux不存在
            mock_run.return_value = Mock(returncode=1)
            assert bridge.check_tmux_available() == False
            
            # 模拟命令执行失败
            mock_run.side_effect = Exception("Command failed")
            assert bridge.check_tmux_available() == False
    
    @pytest.mark.asyncio
    async def test_register_device(self, bridge):
        """测试设备注册"""
        bridge.websocket = AsyncMock()
        
        with patch.object(bridge, 'check_tmux_available', return_value=True):
            await bridge.register_device()
        
        # 验证发送的消息
        bridge.websocket.send.assert_called_once()
        sent_data = json.loads(bridge.websocket.send.call_args[0][0])
        
        assert sent_data['type'] == 'device_register'
        assert sent_data['device_id'] == bridge.device_id
        assert sent_data['device_name'] == bridge.device_name
        assert sent_data['capabilities']['terminal'] == True
        assert sent_data['capabilities']['tmux'] == True
    
    @pytest.mark.asyncio
    async def test_handle_client_connect_auth_failed(self, bridge):
        """测试客户端连接 - 认证失败"""
        bridge.websocket = AsyncMock()
        
        data = {
            'connection_id': 'conn123',
            'auth_token': {},
            'telegram_user_id': '999999'  # 不在白名单
        }
        
        await bridge.handle_client_connect(data)
        
        # 验证发送认证失败消息
        bridge.websocket.send.assert_called_once()
        sent_data = json.loads(bridge.websocket.send.call_args[0][0])
        assert sent_data['type'] == 'auth_failed'
        assert sent_data['connection_id'] == 'conn123'
    
    @pytest.mark.asyncio
    async def test_handle_client_connect_success(self, bridge):
        """测试客户端连接 - 成功"""
        bridge.websocket = AsyncMock()
        
        data = {
            'connection_id': 'conn123',
            'auth_token': {},
            'telegram_user_id': '123456'  # 在白名单
        }
        
        with patch('pty.openpty', return_value=(3, 4)):
            with patch('subprocess.Popen') as mock_popen:
                mock_process = Mock()
                mock_process.poll.return_value = None
                mock_popen.return_value = mock_process
                
                with patch('asyncio.create_task'):
                    await bridge.handle_client_connect(data)
        
        # 验证会话创建
        assert 'conn123' in bridge.sessions
        assert bridge.sessions['conn123']['user_id'] == '123456'
        
        # 验证发送成功消息
        bridge.websocket.send.assert_called()
        sent_data = json.loads(bridge.websocket.send.call_args[0][0])
        assert sent_data['type'] == 'connection_ready'
        assert sent_data['connection_id'] == 'conn123'
    
    @pytest.mark.asyncio
    async def test_handle_terminal_input(self, bridge):
        """测试终端输入处理"""
        # 创建模拟会话
        bridge.sessions['conn123'] = {
            'master_fd': Mock(),
            'process': Mock(),
            'user_id': '123456'
        }
        
        data = {
            'connection_id': 'conn123',
            'data': 'ls -la'
        }
        
        with patch('os.write') as mock_write:
            await bridge.handle_terminal_input(data)
            mock_write.assert_called_once()
            # 验证写入的数据
            assert mock_write.call_args[0][1] == b'ls -la'
    
    @pytest.mark.asyncio
    async def test_handle_terminal_resize(self, bridge):
        """测试终端尺寸调整"""
        # 创建模拟会话
        bridge.sessions['conn123'] = {
            'master_fd': 5,
            'process': Mock(),
            'user_id': '123456'
        }
        
        data = {
            'connection_id': 'conn123',
            'cols': 120,
            'rows': 40
        }
        
        with patch('fcntl.ioctl') as mock_ioctl:
            await bridge.handle_terminal_resize(data)
            mock_ioctl.assert_called_once()
            # 验证ioctl参数
            assert mock_ioctl.call_args[0][0] == 5  # master_fd
    
    @pytest.mark.asyncio
    async def test_cleanup_session(self, bridge):
        """测试会话清理"""
        mock_process = Mock()
        mock_process.poll.return_value = None
        
        bridge.sessions['conn123'] = {
            'master_fd': 5,
            'process': mock_process,
            'user_id': '123456'
        }
        
        with patch('os.close') as mock_close:
            await bridge.cleanup_session('conn123')
            
            # 验证关闭PTY
            mock_close.assert_called_once_with(5)
            
            # 验证终止进程
            mock_process.terminate.assert_called_once()
            
            # 验证会话被删除
            assert 'conn123' not in bridge.sessions
    
    @pytest.mark.asyncio
    async def test_connect_to_relay_with_retry(self, bridge):
        """测试中继连接与重试"""
        bridge.reconnect_delay = 0.1  # 减少测试等待时间
        
        connect_count = 0
        
        async def mock_connect(*args, **kwargs):
            nonlocal connect_count
            connect_count += 1
            
            if connect_count == 1:
                # 第一次连接失败
                raise Exception("Connection failed")
            else:
                # 第二次连接成功，然后停止
                bridge.running = False
                mock_ws = AsyncMock()
                mock_ws.__aenter__ = AsyncMock(return_value=mock_ws)
                mock_ws.__aexit__ = AsyncMock()
                return mock_ws
        
        with patch('websockets.connect', side_effect=mock_connect):
            with patch.object(bridge, 'register_device', new_callable=AsyncMock):
                with patch.object(bridge, 'handle_relay_messages', new_callable=AsyncMock):
                    await bridge.connect_to_relay()
        
        # 验证重试了连接
        assert connect_count == 2


class TestIntegration:
    """集成测试"""
    
    @pytest.mark.asyncio
    async def test_full_connection_flow(self):
        """测试完整连接流程"""
        # 这是一个简化的集成测试示例
        # 实际测试需要启动真实的中继服务
        
        config = {
            'device_id': 'test_device',
            'relay_url': 'ws://localhost:8080/device',
            'allowed_telegram_users': ['123456']
        }
        
        with patch('local_bridge.LocalTerminalBridge.load_config', return_value=config):
            bridge = LocalTerminalBridge('test.json')
            
            # 模拟WebSocket连接
            bridge.websocket = AsyncMock()
            
            # 测试设备注册
            await bridge.register_device()
            assert bridge.websocket.send.called
            
            # 测试客户端连接
            connect_data = {
                'connection_id': 'test_conn',
                'telegram_user_id': '123456',
                'auth_token': {}
            }
            
            with patch('pty.openpty', return_value=(3, 4)):
                with patch('subprocess.Popen'):
                    with patch('asyncio.create_task'):
                        await bridge.handle_client_connect(connect_data)
            
            assert 'test_conn' in bridge.sessions


if __name__ == '__main__':
    pytest.main([__file__, '-v'])