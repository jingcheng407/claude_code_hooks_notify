#!/usr/bin/env python3
"""简单的WebSocket测试"""

import asyncio
import websockets
import json

async def test():
    uri = "ws://localhost:8080/device"
    async with websockets.connect(uri) as websocket:
        print("Connected")
        
        # 发送注册消息
        msg = {
            "type": "device_register",
            "device_id": "test123",
            "device_name": "Test",
            "platform": "Linux",
            "status": "online"
        }
        
        await websocket.send(json.dumps(msg))
        print(f"Sent: {msg}")
        
        # 接收响应
        response = await websocket.recv()
        print(f"Received: {response}")
        
        # 保持连接
        await asyncio.sleep(5)
        
        print("Closing")

asyncio.run(test())