#!/usr/bin/env node
/**
 * 中继服务 - 无状态字节流路由
 * 仅负责在设备和客户端之间转发数据，不存储任何敏感信息
 */

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const crypto = require('crypto');

class RelayServer {
    constructor(port = 8080) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        
        // 设备连接管理 (device_id -> WebSocket)
        this.devices = new Map();
        
        // 客户端连接管理 (connection_id -> {client, device})
        this.connections = new Map();
        
        // 设置健康检查端点
        this.setupHttpEndpoints();
        
        // 设置WebSocket服务器
        this.setupWebSocketServers();
        
        // 启动心跳检查
        this.startHeartbeat();
        
        console.log(`[RelayServer] 初始化完成，端口: ${port}`);
    }
    
    setupHttpEndpoints() {
        // 健康检查
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                devices: this.devices.size,
                connections: this.connections.size,
                uptime: process.uptime()
            });
        });
        
        // 设备列表（仅用于调试）
        this.app.get('/devices', (req, res) => {
            const devices = Array.from(this.devices.keys()).map(id => ({
                id,
                connected: true
            }));
            res.json(devices);
        });
    }
    
    setupWebSocketServers() {
        // 设备WebSocket服务器 (/device)
        this.deviceWss = new WebSocket.Server({
            server: this.server,
            path: '/device'
        });
        
        // 客户端WebSocket服务器 (/client)
        this.clientWss = new WebSocket.Server({
            server: this.server,
            path: '/client'
        });
        
        // 处理设备连接
        this.deviceWss.on('connection', (ws, req) => {
            console.log('[Device] 新设备连接');
            this.handleDeviceConnection(ws);
        });
        
        // 处理客户端连接
        this.clientWss.on('connection', (ws, req) => {
            console.log('[Client] 新客户端连接');
            this.handleClientConnection(ws);
        });
    }
    
    handleDeviceConnection(ws) {
        let deviceId = null;
        let deviceInfo = {};
        
        // 设置心跳
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        
        ws.on('message', (data) => {
            try {
                // 处理Buffer或字符串
                const messageStr = data.toString();
                const message = JSON.parse(messageStr);
                
                switch (message.type) {
                    case 'device_register':
                        deviceId = message.device_id;
                        deviceInfo = {
                            name: message.device_name,
                            platform: message.platform,
                            capabilities: message.capabilities || {}
                        };
                        
                        // 注册设备
                        this.devices.set(deviceId, ws);
                        ws.deviceId = deviceId;
                        ws.deviceInfo = deviceInfo;
                        
                        console.log(`[Device] 设备注册成功: ${deviceId} (${deviceInfo.name})`);
                        
                        // 发送注册确认
                        ws.send(JSON.stringify({
                            type: 'register_success',
                            device_id: deviceId
                        }));
                        break;
                        
                    case 'terminal_output':
                    case 'connection_ready':
                    case 'auth_failed':
                    case 'connection_failed':
                        // 转发消息到对应的客户端
                        const connectionId = message.connection_id;
                        const connection = this.connections.get(connectionId);
                        
                        if (connection && connection.client.readyState === WebSocket.OPEN) {
                            connection.client.send(JSON.stringify(message));
                        }
                        break;
                        
                    case 'pong':
                        // 心跳响应
                        ws.isAlive = true;
                        break;
                        
                    default:
                        console.log(`[Device] 未知消息类型: ${message.type}`);
                }
            } catch (error) {
                console.error('[Device] 消息处理错误:', error);
            }
        });
        
        ws.on('close', () => {
            if (deviceId) {
                console.log(`[Device] 设备断开连接: ${deviceId}`);
                this.devices.delete(deviceId);
                
                // 通知所有相关客户端
                this.connections.forEach((connection, connectionId) => {
                    if (connection.deviceId === deviceId) {
                        if (connection.client.readyState === WebSocket.OPEN) {
                            connection.client.send(JSON.stringify({
                                type: 'device_disconnected',
                                device_id: deviceId
                            }));
                        }
                        this.connections.delete(connectionId);
                    }
                });
            }
        });
        
        ws.on('error', (error) => {
            console.error('[Device] WebSocket错误:', error);
        });
    }
    
    handleClientConnection(ws) {
        let connectionId = null;
        
        // 设置心跳
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        
        ws.on('message', (data) => {
            try {
                // 处理Buffer或字符串
                const messageStr = data.toString();
                const message = JSON.parse(messageStr);
                
                switch (message.type) {
                    case 'connect':
                        // 客户端请求连接到设备
                        const deviceId = message.device_id;
                        const device = this.devices.get(deviceId);
                        
                        if (!device || device.readyState !== WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                error: '设备不在线'
                            }));
                            return;
                        }
                        
                        // 生成连接ID
                        connectionId = this.generateConnectionId();
                        ws.connectionId = connectionId;
                        
                        // 保存连接映射
                        this.connections.set(connectionId, {
                            client: ws,
                            device: device,
                            deviceId: deviceId,
                            createdAt: new Date()
                        });
                        
                        console.log(`[Client] 连接建立: ${connectionId} -> ${deviceId}`);
                        
                        // 转发连接请求到设备
                        device.send(JSON.stringify({
                            type: 'client_connect',
                            connection_id: connectionId,
                            auth_token: message.auth_token,
                            telegram_user_id: message.telegram_user_id,
                            cols: message.cols || 80,
                            rows: message.rows || 24
                        }));
                        break;
                        
                    case 'terminal_input':
                    case 'terminal_resize':
                        // 转发到设备
                        if (connectionId) {
                            const connection = this.connections.get(connectionId);
                            if (connection && connection.device.readyState === WebSocket.OPEN) {
                                connection.device.send(JSON.stringify({
                                    ...message,
                                    connection_id: connectionId
                                }));
                            }
                        }
                        break;
                        
                    case 'ping':
                        ws.send(JSON.stringify({ type: 'pong' }));
                        break;
                        
                    default:
                        console.log(`[Client] 未知消息类型: ${message.type}`);
                }
            } catch (error) {
                console.error('[Client] 消息处理错误:', error);
            }
        });
        
        ws.on('close', () => {
            if (connectionId) {
                console.log(`[Client] 客户端断开连接: ${connectionId}`);
                
                const connection = this.connections.get(connectionId);
                if (connection && connection.device.readyState === WebSocket.OPEN) {
                    // 通知设备客户端已断开
                    connection.device.send(JSON.stringify({
                        type: 'client_disconnect',
                        connection_id: connectionId
                    }));
                }
                
                this.connections.delete(connectionId);
            }
        });
        
        ws.on('error', (error) => {
            console.error('[Client] WebSocket错误:', error);
        });
    }
    
    generateConnectionId() {
        return 'conn_' + crypto.randomBytes(8).toString('hex');
    }
    
    startHeartbeat() {
        // 每30秒检查一次连接状态
        setInterval(() => {
            // 检查设备连接
            this.deviceWss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('[Heartbeat] 设备连接超时，断开连接');
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
            
            // 检查客户端连接
            this.clientWss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log('[Heartbeat] 客户端连接超时，断开连接');
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.ping();
            });
            
            // 清理过期连接
            const now = new Date();
            this.connections.forEach((connection, connectionId) => {
                const age = now - connection.createdAt;
                // 超过24小时的连接自动清理
                if (age > 24 * 60 * 60 * 1000) {
                    console.log(`[Cleanup] 清理过期连接: ${connectionId}`);
                    if (connection.client.readyState === WebSocket.OPEN) {
                        connection.client.close();
                    }
                    this.connections.delete(connectionId);
                }
            });
        }, 30000);
    }
    
    start() {
        this.server.listen(this.port, () => {
            console.log(`[RelayServer] 服务启动成功`);
            console.log(`  HTTP服务: http://localhost:${this.port}`);
            console.log(`  设备WebSocket: ws://localhost:${this.port}/device`);
            console.log(`  客户端WebSocket: ws://localhost:${this.port}/client`);
            console.log(`  健康检查: http://localhost:${this.port}/health`);
        });
    }
    
    stop() {
        console.log('[RelayServer] 正在关闭服务...');
        
        // 关闭所有WebSocket连接
        this.deviceWss.clients.forEach(ws => ws.close());
        this.clientWss.clients.forEach(ws => ws.close());
        
        // 关闭HTTP服务器
        this.server.close(() => {
            console.log('[RelayServer] 服务已关闭');
            process.exit(0);
        });
    }
}

// 主程序
if (require.main === module) {
    const port = process.env.PORT || 8080;
    const server = new RelayServer(port);
    
    // 优雅退出
    process.on('SIGTERM', () => server.stop());
    process.on('SIGINT', () => server.stop());
    
    // 启动服务
    server.start();
}

module.exports = RelayServer;