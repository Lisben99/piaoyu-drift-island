/**
 * Blacklist routes: block, unblock, list
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findUserById, findChatSessionByUsers, addCoinTransaction } = require('../db');

// List my blacklist
router.get('/', auth, (req, res) => {
  const blocked = db().blacklist
    .filter(b => b.blockerId === req.user.id)
    .map(b => {
      const user = findUserById(b.blockedId);
      return {
        id: b.id,
        blockedId: b.blockedId,
        blockedNickname: user ? user.nickname : '未知用户',
        blockedAvatar: user ? user.avatar : '',
        createdAt: b.createdAt
      };
    });
  res.json({ success: true, blacklist: blocked });
});

// Block a user
router.post('/block', auth, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === req.user.id) {
    return res.json({ success: false, error: '无效的用户' });
  }
  
  // Check if already blocked
  const existing = db().blacklist.find(b =>
    b.blockerId === req.user.id && b.blockedId === targetUserId
  );
  if (existing) {
    return res.json({ success: false, error: '已拉黑该用户' });
  }
  
  const block = {
    id: genId('block'),
    blockerId: req.user.id,
    blockedId: targetUserId,
    createdAt: Date.now()
  };
  db().blacklist.push(block);
  
  // Cancel pending permanent request and refund
  const session = findChatSessionByUsers(req.user.id, targetUserId);
  if (session && session.status === 'pending_permanent') {
    session.status = 'blocked';
    const refundAmount = session.permanentChargeAmount === undefined
      ? Math.max(0, Number(db().config.permanent_chat_cost) || 0)
      : Math.max(0, Number(session.permanentChargeAmount) || 0);
    if (refundAmount > 0) addCoinTransaction(session.permanentRequesterId, refundAmount, 'refund', '拉黑用户，续聊请求取消退款', session.id);
  }
  if (session && session.status === 'active') {
    session.status = 'blocked';
  }
  if (session && session.status === 'permanent') {
    session.status = 'blocked';
  }
  
  save();
  res.json({ success: true });
});

// Unblock a user
router.post('/unblock', auth, (req, res) => {
  const { targetUserId } = req.body;
  const idx = db().blacklist.findIndex(b =>
    b.blockerId === req.user.id && b.blockedId === targetUserId
  );
  if (idx === -1) {
    return res.json({ success: false, error: '未拉黑该用户' });
  }
  
  db().blacklist.splice(idx, 1);
  
  // Restore permanent session if existed
  const session = findChatSessionByUsers(req.user.id, targetUserId);
  if (session && session.status === 'blocked') {
    // Check if it was permanent before blocking
    session.status = 'permanent';
  }
  
  save();
  res.json({ success: true });
});

module.exports = router;
