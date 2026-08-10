/**
 * Chat routes: start session, list sessions, get messages, send message, permanent chat
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findUserById, findChatSessionById, findChatSessionByUsers, addCoinTransaction } = require('../db');
const { moderate } = require('../services/moderation');
const { sendToUser } = require('../services/websocket');
const botEngine = require('../services/botEngine');

// Start a chat session (first message costs 1 coin)
router.post('/start', auth, async (req, res) => {
  const { targetUserId, firstMessage } = req.body;
  const config = db().config;
  
  if (!targetUserId) {
    return res.json({ success: false, error: '请选择聊天对象' });
  }
  
  const targetUser = findUserById(targetUserId);
  if (!targetUser) {
    return res.json({ success: false, error: '用户不存在' });
  }
  // Chatting with a bot is free and long-lived (AI assistant, cold-start help).
  const isBotTarget = (targetUser.account_type || 'HUMAN') === 'BOT';
  
  // Check restrictions
  if (req.user.restrictions.chat || req.user.status === 'restricted') {
    return res.json({ success: false, error: '你的账号已被限制聊天' });
  }
  if (targetUser.status === 'banned' || targetUser.status === 'frozen') {
    return res.json({ success: false, error: '对方账号不可用' });
  }
  
  // Check blacklist
  const blocked = db().blacklist.find(b =>
    (b.blockerId === targetUserId && b.blockedId === req.user.id) ||
    (b.blockerId === req.user.id && b.blockedId === targetUserId)
  );
  if (blocked) {
    return res.json({ success: false, error: '无法发起聊天，请检查黑名单设置' });
  }
  
  // Check for existing active session
  let session = findChatSessionByUsers(req.user.id, targetUserId);
  
  if (session) {
    // Existing session
    if (session.status === 'active') {
      // Check expiry
      const elapsed = (Date.now() - session.startedAt) / (1000 * 60 * 60);
      if (elapsed >= config.chat_session_hours) {
        session.status = 'expired';
        save();
      } else {
        // Session still active, just send the message
        if (firstMessage) {
          const modResult = await moderate(firstMessage);
          if (!modResult.pass) {
            return res.json({ success: false, error: modResult.reason });
          }
          const message = {
            id: genId('msg'),
            sessionId: session.id,
            senderId: req.user.id,
            content: firstMessage,
            createdAt: Date.now()
          };
          db().messages.push(message);
          session.lastMessageAt = Date.now();
          save();
          
          // Send via WebSocket
          sendToUser(targetUserId, {
            type: 'message_received',
            data: { ...message, sessionId: session.id }
          });
          botEngine.scheduleChatReply(session.id, req.user.id, firstMessage);
        }
        return res.json({ success: true, session, coins: req.user.coins });
      }
    }
    if (session.status === 'permanent') {
      // Permanent chat, no cost
      if (firstMessage) {
        const modResult = await moderate(firstMessage);
        if (!modResult.pass) {
          return res.json({ success: false, error: modResult.reason });
        }
        const message = {
          id: genId('msg'),
          sessionId: session.id,
          senderId: req.user.id,
          content: firstMessage,
          createdAt: Date.now()
        };
        db().messages.push(message);
        session.lastMessageAt = Date.now();
        save();
        sendToUser(targetUserId, {
          type: 'message_received',
          data: { ...message, sessionId: session.id }
        });
      }
      return res.json({ success: true, session, coins: req.user.coins });
    }
    if (session.status === 'expired') {
      // Need to renew - start new session
      // Check coins
      if (req.user.coins < config.chat_session_cost) {
        return res.json({ success: false, error: '漂流币不足，无法开启新会话', needRecharge: true });
      }
      if (!isBotTarget) addCoinTransaction(req.user.id, -config.chat_session_cost, 'chat_session', '开启新的聊天会话');
      
      session.status = 'active';
      session.startedAt = Date.now();
      session.expiresAt = isBotTarget ? Date.now() + 365 * 24 * 3600000 : Date.now() + config.chat_session_hours * 3600000;
      save();
      
      if (firstMessage) {
        const message = {
          id: genId('msg'),
          sessionId: session.id,
          senderId: req.user.id,
          content: firstMessage,
          createdAt: Date.now()
        };
        db().messages.push(message);
        session.lastMessageAt = Date.now();
        save();
        sendToUser(targetUserId, {
          type: 'message_received',
          data: { ...message, sessionId: session.id }
        });
      }
      return res.json({ success: true, session, coins: req.user.coins });
    }
    if (session.status === 'pending_permanent') {
      return res.json({ success: false, error: '续聊请求待确认中' });
    }
    if (session.status === 'blocked') {
      return res.json({ success: false, error: '会话已被拉黑' });
    }
  }
  
  // New session - first message costs 1 coin (free when chatting with a bot)
  if (!isBotTarget && req.user.coins < config.chat_session_cost) {
    return res.json({ success: false, error: '漂流币不足，请充值', needRecharge: true });
  }
  
  if (!isBotTarget) addCoinTransaction(req.user.id, -config.chat_session_cost, 'chat_session', '发起聊天会话');
  
  session = {
    id: genId('chat'),
    userA: req.user.id,
    userB: targetUserId,
    initiatedBy: req.user.id,
    status: 'active',
    startedAt: Date.now(),
    expiresAt: isBotTarget ? Date.now() + 365 * 24 * 3600000 : Date.now() + config.chat_session_hours * 3600000,
    lastMessageAt: null,
    permanentRequested: false,
    permanentAccepted: false,
    permanentRequestedAt: null,
    permanentResponseDeadline: null,
    hiddenFor: [],
    clearedAt: {},
    lastReadAt: {}
  };
  db().chatSessions.push(session);
  
  if (firstMessage) {
    const modResult = await moderate(firstMessage);
    if (!modResult.pass) {
      save();
      return res.json({ success: false, error: modResult.reason });
    }
    const message = {
      id: genId('msg'),
      sessionId: session.id,
      senderId: req.user.id,
      content: firstMessage,
      createdAt: Date.now()
    };
    db().messages.push(message);
    session.lastMessageAt = Date.now();
    save();
    sendToUser(targetUserId, {
      type: 'message_received',
      data: { ...message, sessionId: session.id }
    });
    botEngine.scheduleChatReply(session.id, req.user.id, firstMessage);
  }
  
  save();
  res.json({ success: true, session, coins: req.user.coins });
});

// List my chat sessions
router.get('/sessions', auth, (req, res) => {
  const now = Date.now();
  const config = db().config;
  
  // Auto-expire sessions
  db().chatSessions.forEach(s => {
    if (s.status === 'active') {
      const elapsed = (now - s.startedAt) / (1000 * 60 * 60);
      if (elapsed >= config.chat_session_hours) {
        s.status = 'expired';
      }
    }
    if (s.status === 'pending_permanent' && s.permanentResponseDeadline && now > s.permanentResponseDeadline) {
      // Auto-refund
      s.status = 'expired';
      addCoinTransaction(s.initiatedBy, config.permanent_chat_cost, 'refund', '续聊请求超时自动退款', s.id);
    }
  });
  save();
  
  const sessions = db().chatSessions
    .filter(s => s.userA === req.user.id || s.userB === req.user.id)
    .filter(s => !(s.hiddenFor && s.hiddenFor.includes(req.user.id)))
    .sort((a, b) => {
      const aTime = a.lastMessageAt || a.startedAt;
      const bTime = b.lastMessageAt || b.startedAt;
      return bTime - aTime;
    })
    .map(s => {
      const otherUserId = s.userA === req.user.id ? s.userB : s.userA;
      const otherUser = findUserById(otherUserId);
      const clearedAt = (s.clearedAt && s.clearedAt[req.user.id]) || 0;
      const lastReadAt = (s.lastReadAt && s.lastReadAt[req.user.id]) || 0;
      const visibleMessages = db().messages
        .filter(m => m.sessionId === s.id && m.createdAt > clearedAt);
      const lastMessage = visibleMessages
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      // 未读 = 对方发来的、且晚于我上次阅读时间的消息数
      const unreadCount = visibleMessages
        .filter(m => m.senderId !== req.user.id && m.createdAt > lastReadAt)
        .length;

      return {
        id: s.id,
        otherUserId,
        otherNickname: otherUser ? otherUser.nickname : '未知用户',
        otherAvatar: otherUser ? otherUser.avatar : '',
        otherGender: otherUser ? otherUser.gender : '',
        status: s.status,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        lastMessageAt: s.lastMessageAt,
        lastMessage: lastMessage ? { content: lastMessage.content, image: lastMessage.image || null, createdAt: lastMessage.createdAt, senderId: lastMessage.senderId } : null,
        unreadCount,
        permanentRequested: s.permanentRequested,
        permanentRequestedBy: s.permanentRequested ? s.initiatedBy : null,
        permanentResponseDeadline: s.permanentResponseDeadline
      };
    });
  
  res.json({ success: true, sessions });
});

// Get messages in a session
router.get('/sessions/:id/messages', auth, (req, res) => {
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.userA !== req.user.id && session.userB !== req.user.id) {
    return res.json({ success: false, error: '无权查看' });
  }

  const otherUserId = session.userA === req.user.id ? session.userB : session.userA;
  const otherUser = findUserById(otherUserId);
  const sessionWithOther = {
    ...session,
    otherUserId,
    otherNickname: otherUser ? otherUser.nickname : '未知用户',
    otherAvatar: otherUser ? otherUser.avatar : '',
    otherGender: otherUser ? otherUser.gender : ''
  };

  const clearedAt = (session.clearedAt && session.clearedAt[req.user.id]) || 0;
  const messages = db().messages
    .filter(m => m.sessionId === session.id && m.createdAt > clearedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-100); // Last 100 messages (after this user's clear)

  res.json({ success: true, messages, session: sessionWithOther });
});

// Mark a session as read (clears the unread count for the current user)
router.post('/sessions/:id/read', auth, (req, res) => {
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.userA !== req.user.id && session.userB !== req.user.id) {
    return res.json({ success: false, error: '无权操作' });
  }
  session.lastReadAt = session.lastReadAt || {};
  session.lastReadAt[req.user.id] = Date.now();
  save();
  res.json({ success: true });
});

// Hide a session for the current user (delete/hide from my list only)
router.post('/sessions/:id/hide', auth, (req, res) => {
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.userA !== req.user.id && session.userB !== req.user.id) {
    return res.json({ success: false, error: '无权操作' });
  }
  session.hiddenFor = session.hiddenFor || [];
  if (!session.hiddenFor.includes(req.user.id)) {
    session.hiddenFor.push(req.user.id);
  }
  save();
  res.json({ success: true });
});

// Delete a session for the current user: clear OUR chat history and hide it from
// our list. If the OTHER party later sends a new message, the conversation
// reappears (showing only messages from that point on). The other party's own
// history is untouched.
router.post('/sessions/:id/delete', auth, (req, res) => {
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.userA !== req.user.id && session.userB !== req.user.id) {
    return res.json({ success: false, error: '无权操作' });
  }
  session.clearedAt = session.clearedAt || {};
  session.clearedAt[req.user.id] = Date.now();
  session.hiddenFor = session.hiddenFor || [];
  if (!session.hiddenFor.includes(req.user.id)) {
    session.hiddenFor.push(req.user.id);
  }
  save();
  res.json({ success: true });
});

// Request permanent chat
router.post('/sessions/:id/request-permanent', auth, (req, res) => {
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.userA !== req.user.id && session.userB !== req.user.id) {
    return res.json({ success: false, error: '无权操作' });
  }
  if (session.status === 'permanent') {
    return res.json({ success: false, error: '已是永久会话' });
  }
  if (session.status === 'pending_permanent') {
    return res.json({ success: false, error: '续聊请求已发送，等待确认' });
  }
  
  const config = db().config;
  if (req.user.coins < config.permanent_chat_cost) {
    return res.json({ success: false, error: '漂流币不足', needRecharge: true });
  }
  
  // Pre-deduct coins
  addCoinTransaction(req.user.id, -config.permanent_chat_cost, 'permanent_chat', '请求永久续聊（预扣）');
  
  session.permanentRequested = true;
  session.permanentRequestedAt = Date.now();
  session.permanentResponseDeadline = Date.now() + 24 * 3600000; // 24h to respond
  session.status = 'pending_permanent';
  session.permanentRequesterId = req.user.id;
  save();
  
  // Notify other user
  const otherUserId = session.userA === req.user.id ? session.userB : session.userA;
  sendToUser(otherUserId, {
    type: 'permanent_chat_request',
    data: { sessionId: session.id, fromUserId: req.user.id }
  });
  
  res.json({ success: true, session, coins: req.user.coins });
});

// Accept or reject permanent chat
router.post('/sessions/:id/respond-permanent', auth, (req, res) => {
  const { accept } = req.body;
  const session = findChatSessionById(req.params.id);
  if (!session) {
    return res.json({ success: false, error: '会话不存在' });
  }
  if (session.status !== 'pending_permanent') {
    return res.json({ success: false, error: '没有待处理的续聊请求' });
  }
  // Only the non-requester can respond
  if (req.user.id === session.permanentRequesterId) {
    return res.json({ success: false, error: '请等待对方确认' });
  }
  
  const config = db().config;
  
  if (accept) {
    session.status = 'permanent';
    session.permanentAccepted = true;
  } else {
    // Reject - refund
    session.status = 'expired';
    addCoinTransaction(session.permanentRequesterId, config.permanent_chat_cost, 'refund', '续聊请求被拒绝，退款', session.id);
  }
  save();
  
  // Notify requester
  sendToUser(session.permanentRequesterId, {
    type: 'permanent_chat_response',
    data: { sessionId: session.id, accepted: accept }
  });
  
  res.json({ success: true, session });
});

module.exports = router;
