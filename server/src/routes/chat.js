/**
 * Chat routes: start session, list sessions, get messages, send message, permanent chat
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findUserById, findChatSessionById, findChatSessionByUsers, addCoinTransaction, createNotification, getUnreadNotificationCount, isFollowing } = require('../db');

// Notify a chat recipient of a new incoming message (skip bots / self).
function notifyNewMessage(recipientId, sessionId, fromUserId) {
  if (!recipientId || recipientId === fromUserId) return;
  const recipient = findUserById(recipientId);
  if (!recipient) return;
  if ((recipient.account_type || 'HUMAN') === 'BOT') return; // bots don't need notifications
  const actor = findUserById(fromUserId);
  const notif = createNotification({
    userId: recipientId,
    type: 'chat_message',
    title: '新私信',
    content: (actor ? (actor.nickname || '匿名用户') : '有人') + ' 给你发了一条消息',
    refId: sessionId,
    refType: 'chat',
    actorId: fromUserId
  });
  if (notif) {
    const { sendToUser } = require('../services/websocket');
    sendToUser(recipientId, { type: 'notification', data: { id: notif.id, unreadCount: getUnreadNotificationCount(recipientId) } });
  }
}

// Friendly display name for the other side of a chat (handles deleted / empty-nickname users).
function safeNickname(user) {
  if (!user) return '漂流瓶友';
  if (user.status === 'deleted') return '已注销用户';
  return user.nickname || '漂流瓶友';
}

const { moderate } = require('../services/moderation');
const { sendToUser } = require('../services/websocket');
const botEngine = require('../services/botEngine');
const { consumeGrowthAction } = require('../services/growthEconomy');

function refundUnansweredOpening(session) {
  if (!session || session.openingChargeRefunded || !(Number(session.openingChargeAmount) > 0)) return false;
  const responderId = session.initiatedBy === session.userA ? session.userB : session.userA;
  const answered = (db().messages || []).some(message => message.sessionId === session.id && message.senderId === responderId);
  if (answered) return false;
  addCoinTransaction(session.initiatedBy, Number(session.openingChargeAmount), 'refund', '私聊请求未获回应，自动退款', `chat-unanswered:${session.id}`);
  session.openingChargeRefunded = true;
  return true;
}

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
  if (firstMessage) {
    const modResult = await moderate(firstMessage);
    if (!modResult.pass) return res.json({ success: false, error: modResult.reason });
  }
  
  // Check for existing active session
  let session = findChatSessionByUsers(req.user.id, targetUserId);
  if (!session && !isBotTarget) {
    const policy = targetUser.strangerChatPolicy || 'all';
    if (policy === 'closed') return res.json({ success: false, error: '对方已关闭陌生人私聊' });
    if (policy === 'followers' && !isFollowing(req.user.id, targetUserId)) {
      return res.json({ success: false, error: '对方仅接收关注者的私聊' });
    }
  }
  
  if (session) {
    // Existing session
    if (session.status === 'active') {
      // Check expiry
      const elapsed = (Date.now() - (session.activatedAt || session.startedAt)) / (1000 * 60 * 60);
      if (elapsed >= config.chat_session_hours) {
        session.status = 'expired';
        refundUnansweredOpening(session);
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
          notifyNewMessage(targetUserId, session.id, req.user.id);
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
        notifyNewMessage(targetUserId, session.id, req.user.id);
      }
      return res.json({ success: true, session, coins: req.user.coins });
    }
    if (session.status === 'expired') {
      // Need to renew - start new session
      const economy = isBotTarget
        ? { success: true, free: true, charged: 0 }
        : consumeGrowthAction(req.user, 'chat', `renew:${session.id}`);
      if (!economy.success) return res.json(economy);
      
      session.status = 'active';
      session.startedAt = Date.now();
      session.expiresAt = isBotTarget ? Date.now() + 365 * 24 * 3600000 : Date.now() + config.chat_session_hours * 3600000;
      session.initiatedBy = req.user.id;
      session.openingChargeAmount = economy.charged || 0;
      session.openingChargeRefunded = false;
      session.activatedAt = null;
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
        notifyNewMessage(targetUserId, session.id, req.user.id);
      }
      return res.json({ success: true, session, coins: req.user.coins, economy });
    }
    if (session.status === 'pending_permanent') {
      return res.json({ success: false, error: '续聊请求待确认中' });
    }
    if (session.status === 'blocked') {
      return res.json({ success: false, error: '会话已被拉黑' });
    }
  }
  
  const economy = isBotTarget
    ? { success: true, free: true, charged: 0 }
    : consumeGrowthAction(req.user, 'chat', `new:${targetUserId}`);
  if (!economy.success) return res.json(economy);
  
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
    ,openingChargeAmount: economy.charged || 0
    ,openingChargeRefunded: false
    ,activatedAt: null
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
    notifyNewMessage(targetUserId, session.id, req.user.id);
    botEngine.scheduleChatReply(session.id, req.user.id, firstMessage);
  }
  
  save();
  res.json({ success: true, session, coins: req.user.coins, economy });
});

// List my chat sessions
router.get('/sessions', auth, (req, res) => {
  const now = Date.now();
  const config = db().config;
  
  // Auto-expire sessions
  db().chatSessions.forEach(s => {
    if (s.status === 'active') {
      const elapsed = (now - (s.activatedAt || s.startedAt)) / (1000 * 60 * 60);
      if (elapsed >= config.chat_session_hours) {
        s.status = 'expired';
        refundUnansweredOpening(s);
      }
    }
    if (s.status === 'pending_permanent' && s.permanentResponseDeadline && now > s.permanentResponseDeadline) {
      // Auto-refund
      s.status = 'expired';
      const refundAmount = s.permanentChargeAmount === undefined
        ? Math.max(0, Number(config.permanent_chat_cost) || 0)
        : Math.max(0, Number(s.permanentChargeAmount) || 0);
      if (refundAmount > 0) addCoinTransaction(s.permanentRequesterId || s.initiatedBy, refundAmount, 'refund', '续聊请求超时自动退款', s.id);
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
        otherNickname: safeNickname(otherUser),
        otherAvatar: otherUser && otherUser.status !== 'deleted' ? otherUser.avatar : '',
        otherGender: otherUser && otherUser.status !== 'deleted' ? otherUser.gender : '',
        status: s.status,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        lastMessageAt: s.lastMessageAt,
        lastMessage: lastMessage ? { content: lastMessage.content, image: lastMessage.image || null, createdAt: lastMessage.createdAt, senderId: lastMessage.senderId } : null,
        unreadCount,
        permanentRequested: s.permanentRequested,
        permanentRequestedBy: s.permanentRequested ? s.permanentRequesterId : null,
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
    otherNickname: safeNickname(otherUser),
    otherAvatar: otherUser && otherUser.status !== 'deleted' ? otherUser.avatar : '',
    otherGender: otherUser && otherUser.status !== 'deleted' ? otherUser.gender : '',
    permanentRequestedBy: session.permanentRequested ? session.permanentRequesterId : null
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
  
  const economy = consumeGrowthAction(req.user, 'permanent', session.id);
  if (!economy.success) return res.json(economy);
  
  session.permanentRequested = true;
  session.permanentRequestedAt = Date.now();
  session.permanentResponseDeadline = Date.now() + 24 * 3600000; // 24h to respond
  session.status = 'pending_permanent';
  session.permanentRequesterId = req.user.id;
  session.permanentChargeAmount = economy.charged || 0;
  save();
  
  // Notify other user
  const otherUserId = session.userA === req.user.id ? session.userB : session.userA;
  sendToUser(otherUserId, {
    type: 'permanent_chat_request',
    data: { sessionId: session.id, fromUserId: req.user.id }
  });
  
  res.json({ success: true, session, coins: req.user.coins, economy });
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
  
  if (accept) {
    session.status = 'permanent';
    session.permanentAccepted = true;
  } else {
    // Reject - refund
    session.status = 'expired';
    const refundAmount = session.permanentChargeAmount === undefined
      ? Math.max(0, Number(db().config.permanent_chat_cost) || 0)
      : Math.max(0, Number(session.permanentChargeAmount) || 0);
    if (refundAmount > 0) addCoinTransaction(session.permanentRequesterId, refundAmount, 'refund', '续聊请求被拒绝，退款', session.id);
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
