#!/usr/bin/env python3
"""
用户绑定系统测试
"""

import unittest
import tempfile
import os
import shutil
import time
from user_binding import UserBindingManager

class TestUserBinding(unittest.TestCase):
    
    def setUp(self):
        """设置测试环境"""
        self.test_dir = tempfile.mkdtemp()
        self.manager = UserBindingManager(data_dir=self.test_dir)
        
    def tearDown(self):
        """清理测试环境"""
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)
    
    def test_generate_user_key(self):
        """测试用户密钥生成"""
        chat_id = "12345"
        user_key = self.manager.generate_user_key(chat_id)
        
        # 检查密钥格式
        self.assertTrue(user_key.startswith("CK"))
        self.assertEqual(len(user_key), 14)  # CK + 8位随机 + 4位时间戳
        self.assertTrue(user_key[2:].isupper())
    
    def test_create_binding_request(self):
        """测试创建绑定请求"""
        chat_id = "12345"
        username = "testuser"
        
        user_key = self.manager.create_binding_request(chat_id, username)
        
        # 检查密钥格式
        self.assertTrue(user_key.startswith("CK"))
        
        # 检查待绑定数据
        pending = self.manager._load_pending_bindings()
        self.assertIn(user_key, pending)
        self.assertEqual(pending[user_key]['chat_id'], chat_id)
        self.assertEqual(pending[user_key]['username'], username)
        self.assertEqual(pending[user_key]['status'], 'pending')
    
    def test_confirm_binding_success(self):
        """测试成功确认绑定"""
        chat_id = "12345"
        username = "testuser"
        
        # 创建绑定请求
        user_key = self.manager.create_binding_request(chat_id, username)
        
        # 确认绑定
        success, message = self.manager.confirm_binding(user_key)
        
        self.assertTrue(success)
        self.assertIn("绑定成功", message)
        
        # 检查绑定数据
        bindings = self.manager.list_bindings()
        self.assertIn(user_key, bindings)
        self.assertEqual(bindings[user_key]['chat_id'], chat_id)
        self.assertEqual(bindings[user_key]['status'], 'active')
        
        # 检查待绑定数据已清理
        pending = self.manager._load_pending_bindings()
        self.assertNotIn(user_key, pending)
    
    def test_confirm_binding_invalid_key(self):
        """测试确认无效密钥"""
        success, message = self.manager.confirm_binding("CKINVALID1")
        
        self.assertFalse(success)
        self.assertIn("无效或已过期", message)
    
    def test_confirm_binding_expired(self):
        """测试确认过期密钥"""
        chat_id = "12345"
        user_key = self.manager.create_binding_request(chat_id)
        
        # 手动设置过期时间
        pending = self.manager._load_pending_bindings()
        pending[user_key]['created_at'] = time.time() - 700  # 700秒前，超过10分钟
        self.manager._save_pending_bindings(pending)
        
        success, message = self.manager.confirm_binding(user_key)
        
        self.assertFalse(success)
        self.assertIn("已过期", message)
    
    def test_get_chat_id_by_key(self):
        """测试根据密钥获取chat_id"""
        chat_id = "12345"
        user_key = self.manager.create_binding_request(chat_id)
        self.manager.confirm_binding(user_key)
        
        # 获取chat_id
        result_chat_id = self.manager.get_chat_id_by_key(user_key)
        self.assertEqual(result_chat_id, chat_id)
        
        # 测试无效密钥
        invalid_result = self.manager.get_chat_id_by_key("CKINVALID1")
        self.assertIsNone(invalid_result)
    
    def test_get_user_key_by_chat_id(self):
        """测试根据chat_id获取用户密钥"""
        chat_id = "12345"
        user_key = self.manager.create_binding_request(chat_id)
        self.manager.confirm_binding(user_key)
        
        # 获取用户密钥
        result_key = self.manager.get_user_key_by_chat_id(chat_id)
        self.assertEqual(result_key, user_key)
        
        # 测试无效chat_id
        invalid_result = self.manager.get_user_key_by_chat_id("99999")
        self.assertIsNone(invalid_result)
    
    def test_revoke_binding(self):
        """测试撤销绑定"""
        chat_id = "12345"
        user_key = self.manager.create_binding_request(chat_id)
        self.manager.confirm_binding(user_key)
        
        # 撤销绑定
        success = self.manager.revoke_binding(user_key)
        self.assertTrue(success)
        
        # 检查绑定已删除
        bindings = self.manager.list_bindings()
        self.assertNotIn(user_key, bindings)
        
        # 测试撤销不存在的绑定
        success = self.manager.revoke_binding("CKINVALID1")
        self.assertFalse(success)
    
    def test_multiple_users(self):
        """测试多用户场景"""
        # 创建两个用户的绑定
        user1_chat_id = "12345"
        user1_username = "user1"
        user1_key = self.manager.create_binding_request(user1_chat_id, user1_username)
        self.manager.confirm_binding(user1_key)
        
        user2_chat_id = "67890"
        user2_username = "user2"
        user2_key = self.manager.create_binding_request(user2_chat_id, user2_username)
        self.manager.confirm_binding(user2_key)
        
        # 检查两个绑定都存在且互不影响
        bindings = self.manager.list_bindings()
        self.assertIn(user1_key, bindings)
        self.assertIn(user2_key, bindings)
        
        self.assertEqual(bindings[user1_key]['chat_id'], user1_chat_id)
        self.assertEqual(bindings[user2_key]['chat_id'], user2_chat_id)
        
        # 检查密钥解析正确
        self.assertEqual(self.manager.get_chat_id_by_key(user1_key), user1_chat_id)
        self.assertEqual(self.manager.get_chat_id_by_key(user2_key), user2_chat_id)
        
        # 检查反向查找正确
        self.assertEqual(self.manager.get_user_key_by_chat_id(user1_chat_id), user1_key)
        self.assertEqual(self.manager.get_user_key_by_chat_id(user2_chat_id), user2_key)
    
    def test_cleanup_expired_pending(self):
        """测试清理过期的待绑定请求"""
        # 创建一个正常的请求
        user_key1 = self.manager.create_binding_request("12345", "user1")
        
        # 创建一个过期的请求
        user_key2 = self.manager.create_binding_request("67890", "user2")
        pending = self.manager._load_pending_bindings()
        pending[user_key2]['created_at'] = time.time() - 700  # 过期
        self.manager._save_pending_bindings(pending)
        
        # 创建新请求应该清理过期的
        user_key3 = self.manager.create_binding_request("11111", "user3")
        
        pending = self.manager._load_pending_bindings()
        self.assertIn(user_key1, pending)  # 正常的仍在
        self.assertNotIn(user_key2, pending)  # 过期的被清理
        self.assertIn(user_key3, pending)  # 新的存在


def run_tests():
    """运行所有测试"""
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestUserBinding)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == "__main__":
    print("🧪 运行用户绑定系统测试...")
    success = run_tests()
    
    if success:
        print("\n✅ 所有测试通过！")
        exit(0)
    else:
        print("\n❌ 有测试失败！")
        exit(1)