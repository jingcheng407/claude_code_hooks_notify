#!/usr/bin/env python3
"""
Unit tests for telegram_bridge.py
"""

import unittest
import sys
import os
import json
import time
from unittest.mock import patch, MagicMock, Mock

# 添加当前目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from telegram_bridge import TelegramBridge


class TestTelegramBridge(unittest.TestCase):
    """测试TelegramBridge类"""
    
    def setUp(self):
        """设置测试环境"""
        self.test_bot_token = "123456789:TEST-BOT-TOKEN"
        self.test_chat_id = "12345"
        
    def test_init_with_parameters(self):
        """测试使用参数初始化"""
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        self.assertEqual(bridge.bot_token, self.test_bot_token)
        self.assertEqual(bridge.chat_id, self.test_chat_id)
        
    def test_init_with_env_vars(self):
        """测试使用环境变量初始化"""
        with patch.dict(os.environ, {
            'TELEGRAM_BOT_TOKEN': self.test_bot_token,
            'TELEGRAM_CHAT_ID': self.test_chat_id
        }):
            bridge = TelegramBridge()
            self.assertEqual(bridge.bot_token, self.test_bot_token)
            self.assertEqual(bridge.chat_id, self.test_chat_id)
            
    def test_init_missing_config(self):
        """测试缺少配置时的异常"""
        # 临时清除环境变量
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                TelegramBridge(None, None)
            
    @patch('telegram_bridge.requests.post')
    def test_send_message_success(self, mock_post):
        """测试成功发送消息"""
        # 模拟成功响应
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': True,
            'result': {'message_id': 123}
        }
        mock_post.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        result = bridge.send_message("测试消息")
        
        self.assertIsNotNone(result)
        self.assertTrue(result['ok'])
        
        # 验证调用参数
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertIn('sendMessage', call_args[0][0])
        
    @patch('telegram_bridge.requests.post')
    def test_send_message_api_error(self, mock_post):
        """测试API错误"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': False,
            'description': 'Bad Request'
        }
        mock_post.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        result = bridge.send_message("测试消息")
        
        self.assertIsNone(result)
        
    @patch('telegram_bridge.requests.post')
    def test_send_message_http_error(self, mock_post):
        """测试HTTP错误"""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_post.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        result = bridge.send_message("测试消息")
        
        self.assertIsNone(result)
        
    @patch('telegram_bridge.requests.post')
    def test_send_message_long_text(self, mock_post):
        """测试长消息截断"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': True,
            'result': {'message_id': 123}
        }
        mock_post.return_value = mock_response
        
        # 创建超过4096字符的消息
        long_message = "测试" * 2000
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        bridge.send_message(long_message)
        
        # 验证消息被截断到4096字符
        call_args = mock_post.call_args
        sent_data = call_args[1]['json']
        self.assertLessEqual(len(sent_data['text']), 4096)
        
    @patch('telegram_bridge.requests.get')
    def test_get_updates_success(self, mock_get):
        """测试成功获取更新"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': True,
            'result': [
                {'update_id': 1, 'message': {'text': '测试1'}},
                {'update_id': 2, 'message': {'text': '测试2'}}
            ]
        }
        mock_get.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        updates = bridge.get_updates()
        
        self.assertEqual(len(updates), 2)
        self.assertEqual(updates[0]['update_id'], 1)
        
    @patch('telegram_bridge.requests.get')
    def test_get_updates_error(self, mock_get):
        """测试获取更新失败"""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_get.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        updates = bridge.get_updates()
        
        self.assertEqual(updates, [])
        
    @patch('telegram_bridge.requests.get')
    def test_get_latest_message(self, mock_get):
        """测试获取最新消息"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': True,
            'result': [
                {
                    'update_id': 1, 
                    'message': {
                        'chat': {'id': int(self.test_chat_id)},
                        'text': '旧消息',
                        'date': 1000
                    }
                },
                {
                    'update_id': 2,
                    'message': {
                        'chat': {'id': int(self.test_chat_id)},
                        'text': '新消息', 
                        'date': 2000
                    }
                }
            ]
        }
        mock_get.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        latest = bridge.get_latest_message()
        
        self.assertIsNotNone(latest)
        self.assertEqual(latest['text'], '新消息')
        self.assertEqual(latest['date'], 2000)
        
    @patch('telegram_bridge.requests.get')
    def test_test_connection_success(self, mock_get):
        """测试连接测试成功"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'ok': True,
            'result': {'username': 'test_bot'}
        }
        mock_get.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        result = bridge.test_connection()
        
        self.assertTrue(result)
        
    @patch('telegram_bridge.requests.get')
    def test_test_connection_failure(self, mock_get):
        """测试连接测试失败"""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_get.return_value = mock_response
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        result = bridge.test_connection()
        
        self.assertFalse(result)
        
    @patch('telegram_bridge.TelegramBridge.get_updates')
    @patch('telegram_bridge.TelegramBridge.send_message')
    @patch('telegram_bridge.time.sleep')
    def test_wait_for_reply_success(self, mock_sleep, mock_send, mock_get_updates):
        """测试成功等待回复"""
        # 模拟第一次调用返回空，第二次调用返回消息
        mock_get_updates.side_effect = [
            [],  # 第一次调用没有消息
            [{
                'update_id': 1,
                'message': {
                    'chat': {'id': int(self.test_chat_id)},
                    'text': '用户回复'
                }
            }]  # 第二次调用有消息
        ]
        
        mock_send.return_value = {'ok': True}
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        
        # 使用较短的超时时间以加快测试
        with patch('telegram_bridge.time.time', side_effect=[0, 1, 2]):
            reply = bridge.wait_for_reply(timeout=10, prompt_message="测试提示")
            
        self.assertEqual(reply, '用户回复')
        mock_send.assert_called_once_with("测试提示")
        
    @patch('telegram_bridge.TelegramBridge.get_updates')
    @patch('telegram_bridge.time.sleep')
    def test_wait_for_reply_timeout(self, mock_sleep, mock_get_updates):
        """测试等待回复超时"""
        mock_get_updates.return_value = []  # 总是返回空
        
        bridge = TelegramBridge(self.test_bot_token, self.test_chat_id)
        
        # 模拟时间流逝超过超时时间
        with patch('telegram_bridge.time.time', side_effect=[0, 5, 10, 15]):
            reply = bridge.wait_for_reply(timeout=10)
            
        self.assertIsNone(reply)


class TestCLIInterface(unittest.TestCase):
    """测试命令行界面"""
    
    def setUp(self):
        self.test_bot_token = "123456789:TEST-BOT-TOKEN"
        self.test_chat_id = "12345"
        
    @patch('telegram_bridge.TelegramBridge')
    def test_cli_send_command(self, mock_bridge_class):
        """测试CLI发送命令"""
        mock_bridge = Mock()
        mock_bridge.send_message.return_value = {'ok': True}
        mock_bridge_class.return_value = mock_bridge
        
        # 模拟命令行参数
        test_args = ['telegram_bridge.py', 'send', '测试消息']
        
        with patch('sys.argv', test_args):
            with patch('sys.exit') as mock_exit:
                import telegram_bridge
                telegram_bridge.main()
                mock_exit.assert_not_called()
                
        mock_bridge.send_message.assert_called_once_with('测试消息')
        
    @patch('telegram_bridge.TelegramBridge')
    def test_cli_wait_command(self, mock_bridge_class):
        """测试CLI等待命令"""
        mock_bridge = Mock()
        mock_bridge.wait_for_reply.return_value = "用户回复"
        mock_bridge_class.return_value = mock_bridge
        
        test_args = ['telegram_bridge.py', 'wait', '300']
        
        with patch('sys.argv', test_args):
            with patch('sys.exit') as mock_exit:
                with patch('builtins.print') as mock_print:
                    import telegram_bridge
                    telegram_bridge.main()
                    mock_exit.assert_not_called()
                    mock_print.assert_called_with("用户回复")
                    
        mock_bridge.wait_for_reply.assert_called_once_with(timeout=300)
        
    @patch('telegram_bridge.TelegramBridge')
    def test_cli_test_command(self, mock_bridge_class):
        """测试CLI测试命令"""
        mock_bridge = Mock()
        mock_bridge.test_connection.return_value = True
        mock_bridge_class.return_value = mock_bridge
        
        test_args = ['telegram_bridge.py', 'test']
        
        with patch('sys.argv', test_args):
            with patch('sys.exit') as mock_exit:
                import telegram_bridge
                telegram_bridge.main()
                mock_exit.assert_not_called()
                
        mock_bridge.test_connection.assert_called_once()


def run_tests():
    """运行所有测试"""
    # 设置测试环境变量
    os.environ['TELEGRAM_BOT_TOKEN'] = "123456789:TEST-BOT-TOKEN"
    os.environ['TELEGRAM_CHAT_ID'] = "12345"
    
    # 创建测试套件
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # 添加测试类
    suite.addTests(loader.loadTestsFromTestCase(TestTelegramBridge))
    suite.addTests(loader.loadTestsFromTestCase(TestCLIInterface))
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)