const WebSocket = require('ws');

// 创建一个简单的测试服务器
const wss = new WebSocket.Server({ port: 8081 });

wss.on('connection', function connection(ws) {
  console.log('Client connected');
  
  ws.on('message', function message(data) {
    console.log('Received:', data.toString());
    
    // 回复一个简单消息
    ws.send(JSON.stringify({ type: 'ack' }));
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

console.log('Test server running on ws://localhost:8081');