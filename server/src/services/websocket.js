/**
 * WebSocket service for real-time chat
 */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../utils/jwt');
const { findUserById, db, save } = require('../db');

const MODERATION_PROVIDER = process.env.MODERATION_PROVIDER || 'local';

let wss = null;
// Map: userId -> Set<WebSocket>
const connections = new Map();

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    // Parse token from URL query
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    
    if (!token) {
      ws.close(4001, 'No token');
      return;
    }
    
    const decoded = verifyToken(token);
    if (!decoded || decoded.type !== 'user') {
      ws.close(4002, 'Invalid token');
      return;
    }
    
    const user = findUserById(decoded.id);
    if (!user) {
      ws.close(4003, 'User not found');
      return;
    }
    
    ws.userId = user.id;
    ws.userName = user.nickname || user.phone;
    
    // Register connection
    if (!connections.has(user.id)) {
      connections.set(user.id, new Set());
    }
    connections.get(user.id).add(ws);
    
    console.log(`[WS] User ${user.id} connected (${connections.get(user.id).size} connections)`);
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[WS] Message parse error:', e);
      }
    });
    
    ws.on('close', () => {
      const conns = connections.get(user.id);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) {
          connections.delete(user.id);
        }
      }
      console.log(`[WS] User ${user.id} disconnected`);
    });
  });
}

async function handleMessage(ws, msg) {
  const { type, data } = msg;
  
  if (type === 'chat_message') {
    // Send a chat message (text and/or image)
    const { sessionId, content, image } = data;
    const database = db();
    const session = database.chatSessions.find(s => s.id === sessionId);
    
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', error: '会话不存在' }));
      return;
    }
    
    // Check user is part of session
    if (session.userA !== ws.userId && session.userB !== ws.userId) {
      ws.send(JSON.stringify({ type: 'error', error: '无权发送消息' }));
      return;
    }
    
    // Check session status
    if (session.status === 'expired') {
      ws.send(JSON.stringify({ type: 'error', error: '会话已过期，请续聊' }));
      return;
    }
    
    if (session.status === 'blocked') {
      ws.send(JSON.stringify({ type: 'error', error: '对方已拉黑你' }));
      return;
    }
    
    // Content moderation (text only; images are not text-moderated here)
    if (content) {
      const { moderate } = require('./moderation');
      const modResult = await moderate(content);
      if (!modResult.pass) {
        ws.send(JSON.stringify({ type: 'error', error: modResult.reason }));
        return;
      }
    }
    
    // Create message
    const message = {
      id: database.genId ? database.genId('msg') : `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      sessionId,
      senderId: ws.userId,
      content: content || '',
      image: image || null,
      createdAt: Date.now(),
      moderated: MODERATION_PROVIDER !== 'local'
    };
    database.messages.push(message);
    save();
    
    // Send to sender
    ws.send(JSON.stringify({
      type: 'message_sent',
      data: message
    }));
    
    // Send to recipient
    const recipientId = session.userA === ws.userId ? session.userB : session.userA;
    sendToUser(recipientId, {
      type: 'message_received',
      data: { ...message, sessionId }
    });
    
    // Update session last message time
    session.lastMessageAt = Date.now();
    save();
    
  } else if (type === 'typing') {
    const { sessionId } = data;
    const database = db();
    const session = database.chatSessions.find(s => s.id === sessionId);
    if (session) {
      const recipientId = session.userA === ws.userId ? session.userB : session.userA;
      sendToUser(recipientId, {
        type: 'typing',
        data: { sessionId, userId: ws.userId }
      });
    }
  }
}

function sendToUser(userId, message) {
  const conns = connections.get(userId);
  if (conns) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    conns.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        ws.send(data);
      }
    });
    return true;
  }
  return false;
}

function isUserOnline(userId) {
  return connections.has(userId);
}

module.exports = { init, sendToUser, isUserOnline };
