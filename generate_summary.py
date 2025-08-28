#!/usr/bin/env python3
import json
import sys
import os
from datetime import datetime

def extract_conversation_summary(transcript_path):
    """从对话记录中提取摘要"""
    try:
        if not os.path.exists(transcript_path):
            return "无法找到对话记录文件"
        
        user_messages = []
        last_user_timestamp = None
        last_assistant_timestamp = None
        
        # 读取 JSONL 格式文件
        with open(transcript_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    
                    # 提取用户消息和时间戳
                    if entry.get('type') == 'user':
                        message = entry.get('message', {})
                        content = message.get('content', '')
                        timestamp = entry.get('timestamp')
                        
                        # 处理多媒体消息（图片+文本）
                        if isinstance(content, list):
                            # 提取文本部分
                            text_parts = []
                            has_image = False
                            for item in content:
                                if isinstance(item, dict):
                                    if item.get('type') == 'text':
                                        text_parts.append(item.get('text', ''))
                                    elif item.get('type') == 'image':
                                        has_image = True
                            
                            content_text = ' '.join(text_parts).strip()
                            if has_image:
                                content_text = f"[图片] {content_text}".strip()
                            content = content_text
                        
                        elif isinstance(content, str) and content.strip():
                            content = content.strip()
                        
                        if content:
                            user_messages.append(content[:100])
                            if timestamp:
                                last_user_timestamp = timestamp
                    
                    # 提取助手时间戳
                    elif entry.get('type') == 'assistant':
                        timestamp = entry.get('timestamp')
                        
                        if timestamp:
                            last_assistant_timestamp = timestamp
                            
                except json.JSONDecodeError:
                    continue
        
        # 计算对话时长
        duration_text = ""
        if last_user_timestamp and last_assistant_timestamp:
            try:
                # 解析 ISO 8601 时间戳 (2025-08-21T06:55:01.705Z)
                user_time = datetime.fromisoformat(last_user_timestamp.replace('Z', '+00:00'))
                assistant_time = datetime.fromisoformat(last_assistant_timestamp.replace('Z', '+00:00'))
                duration = assistant_time - user_time
                total_seconds = int(duration.total_seconds())
                
                if total_seconds >= 60:
                    minutes = total_seconds // 60
                    seconds = total_seconds % 60
                    duration_text = f"{minutes}分{seconds}秒"
                else:
                    duration_text = f"{total_seconds}秒"
            except:
                duration_text = ""
        
        # 生成摘要
        summary_parts = []
        
        if user_messages:
            latest_request = user_messages[-1]
            # 移除换行符和多余空格
            latest_request = ' '.join(latest_request.split())
            if len(latest_request) > 50:
                latest_request = latest_request[:50] + "..."
            summary_parts.append(f"最近请求: {latest_request}")
        
        if len(user_messages) > 1:
            summary_parts.append(f"共{len(user_messages)}轮对话")
        
        summary_text = "\\n".join(summary_parts) if summary_parts else "完成了一次对话会话"
        
        # 如果有耗时信息，单独返回
        if duration_text:
            return f"{summary_text}|||{duration_text}"
        else:
            return summary_text
        
    except Exception as e:
        return f"解析对话记录失败: {str(e)[:50]}"

def main():
    # 从环境变量或命令行参数获取 transcript_path
    transcript_path = os.environ.get('transcript_path') or (sys.argv[1] if len(sys.argv) > 1 else None)
    
    if not transcript_path:
        print("Claude Code 任务完成")
        return
    
    summary = extract_conversation_summary(transcript_path)
    print(summary)

if __name__ == "__main__":
    main()