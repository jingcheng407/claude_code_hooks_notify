#!/usr/bin/env python3
"""
User Binding System for Claude Code Hook Telegram
多用户隔离和绑定管理
"""

import json
import os
import time
import hashlib
import secrets
from pathlib import Path

class UserBindingManager:
    def __init__(self, data_dir=None):
        self.data_dir = Path(data_dir or os.path.expanduser("~/.claude_telegram"))
        self.data_dir.mkdir(exist_ok=True)
        self.bindings_file = self.data_dir / "user_bindings.json"
        self.pending_file = self.data_dir / "pending_bindings.json"
        
    def generate_user_key(self, chat_id):
        """为用户生成唯一的绑定密钥"""
        # 生成8位随机密钥
        random_part = secrets.token_hex(4).upper()
        # 添加时间戳确保唯一性
        timestamp = str(int(time.time()))[-4:]
        user_key = f"CK{random_part}{timestamp}"
        
        return user_key
    
    def create_binding_request(self, chat_id, username=None):
        """创建绑定请求"""
        user_key = self.generate_user_key(chat_id)
        
        # 加载现有的待绑定请求
        pending = self._load_pending_bindings()
        
        # 清理过期的请求（10分钟过期）
        current_time = time.time()
        pending = {k: v for k, v in pending.items() 
                  if current_time - v.get('created_at', 0) < 600}
        
        # 添加新的绑定请求
        pending[user_key] = {
            'chat_id': str(chat_id),
            'username': username,
            'created_at': current_time,
            'status': 'pending'
        }
        
        self._save_pending_bindings(pending)
        return user_key
    
    def confirm_binding(self, user_key):
        """确认绑定（当用户在项目中使用密钥时调用）"""
        pending = self._load_pending_bindings()
        
        if user_key not in pending:
            return False, "绑定密钥无效或已过期"
        
        # 检查是否过期（10分钟）
        if time.time() - pending[user_key]['created_at'] > 600:
            del pending[user_key]
            self._save_pending_bindings(pending)
            return False, "绑定密钥已过期，请重新获取"
        
        # 加载现有绑定
        bindings = self._load_bindings()
        
        # 创建绑定
        chat_id = pending[user_key]['chat_id']
        bindings[user_key] = {
            'chat_id': chat_id,
            'username': pending[user_key].get('username'),
            'created_at': time.time(),
            'last_used': time.time(),
            'status': 'active'
        }
        
        # 保存并清理
        self._save_bindings(bindings)
        del pending[user_key]
        self._save_pending_bindings(pending)
        
        return True, f"绑定成功！用户密钥：{user_key}"
    
    def get_chat_id_by_key(self, user_key):
        """根据用户密钥获取chat_id"""
        bindings = self._load_bindings()
        
        if user_key in bindings:
            # 更新最后使用时间
            bindings[user_key]['last_used'] = time.time()
            self._save_bindings(bindings)
            return bindings[user_key]['chat_id']
        
        return None
    
    def get_user_key_by_chat_id(self, chat_id):
        """根据chat_id获取用户密钥"""
        bindings = self._load_bindings()
        
        for user_key, data in bindings.items():
            if data['chat_id'] == str(chat_id):
                return user_key
        
        return None
    
    def list_bindings(self):
        """列出所有绑定"""
        return self._load_bindings()
    
    def revoke_binding(self, user_key):
        """撤销绑定"""
        bindings = self._load_bindings()
        
        if user_key in bindings:
            del bindings[user_key]
            self._save_bindings(bindings)
            return True
        
        return False
    
    def _load_bindings(self):
        """加载绑定数据"""
        if self.bindings_file.exists():
            try:
                with open(self.bindings_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}
    
    def _save_bindings(self, bindings):
        """保存绑定数据"""
        with open(self.bindings_file, 'w', encoding='utf-8') as f:
            json.dump(bindings, f, indent=2, ensure_ascii=False)
    
    def _load_pending_bindings(self):
        """加载待绑定数据"""
        if self.pending_file.exists():
            try:
                with open(self.pending_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}
    
    def _save_pending_bindings(self, pending):
        """保存待绑定数据"""
        with open(self.pending_file, 'w', encoding='utf-8') as f:
            json.dump(pending, f, indent=2, ensure_ascii=False)


def main():
    """命令行接口"""
    import sys
    
    manager = UserBindingManager()
    
    if len(sys.argv) < 2:
        print("用法:")
        print("  python3 user_binding.py generate <chat_id> [username]  # 生成绑定密钥")
        print("  python3 user_binding.py confirm <user_key>            # 确认绑定")
        print("  python3 user_binding.py get <user_key>                # 获取chat_id")
        print("  python3 user_binding.py list                          # 列出所有绑定")
        print("  python3 user_binding.py revoke <user_key>            # 撤销绑定")
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "generate":
        if len(sys.argv) < 3:
            print("错误：需要提供chat_id")
            sys.exit(1)
        
        chat_id = sys.argv[2]
        username = sys.argv[3] if len(sys.argv) > 3 else None
        
        user_key = manager.create_binding_request(chat_id, username)
        print(f"绑定密钥已生成：{user_key}")
        print(f"请在10分钟内在项目中使用此密钥完成绑定")
    
    elif command == "confirm":
        if len(sys.argv) < 3:
            print("错误：需要提供user_key")
            sys.exit(1)
        
        user_key = sys.argv[2]
        success, message = manager.confirm_binding(user_key)
        print(message)
        sys.exit(0 if success else 1)
    
    elif command == "get":
        if len(sys.argv) < 3:
            print("错误：需要提供user_key")
            sys.exit(1)
        
        user_key = sys.argv[2]
        chat_id = manager.get_chat_id_by_key(user_key)
        
        if chat_id:
            print(chat_id)
        else:
            print("未找到对应的chat_id")
            sys.exit(1)
    
    elif command == "list":
        bindings = manager.list_bindings()
        
        if not bindings:
            print("暂无绑定用户")
        else:
            print("已绑定用户：")
            for key, data in bindings.items():
                username = data.get('username', '未知')
                last_used = time.strftime('%Y-%m-%d %H:%M:%S', 
                                        time.localtime(data.get('last_used', 0)))
                print(f"  {key}: {username} (chat_id: {data['chat_id']}, 最后使用: {last_used})")
    
    elif command == "revoke":
        if len(sys.argv) < 3:
            print("错误：需要提供user_key")
            sys.exit(1)
        
        user_key = sys.argv[2]
        
        if manager.revoke_binding(user_key):
            print(f"绑定 {user_key} 已撤销")
        else:
            print(f"未找到绑定 {user_key}")
            sys.exit(1)
    
    else:
        print(f"未知命令：{command}")
        sys.exit(1)


if __name__ == "__main__":
    main()