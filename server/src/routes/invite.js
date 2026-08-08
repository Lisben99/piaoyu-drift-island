/**
 * Invite routes: invite code, simulate invite
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, addCoinTransaction, findUserById } = require('../db');

// Get my invite info
router.get('/info', auth, (req, res) => {
  const config = db().config;
  // Count invites this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthInvites = db().users.filter(u =>
    u.invitedBy === req.user.id && u.createdAt >= monthStart
  ).length;
  
  res.json({
    success: true,
    inviteCode: req.user.inviteCode,
    totalInvited: req.user.totalInvited || 0,
    monthInvited: monthInvites,
    monthlyLimit: config.invite_monthly_limit,
    inviteBonus: config.invite_bonus
  });
});

// Simulate invite (dev mode - in production, new users register with invite code)
router.post('/simulate', auth, (req, res) => {
  const config = db().config;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthInvites = db().users.filter(u =>
    u.invitedBy === req.user.id && u.createdAt >= monthStart
  ).length;
  
  if (monthInvites >= config.invite_monthly_limit) {
    return res.json({ success: false, error: `本月邀请已达上限（${config.invite_monthly_limit}人）` });
  }
  
  addCoinTransaction(req.user.id, config.invite_bonus, 'invite', '邀请好友奖励');
  req.user.totalInvited = (req.user.totalInvited || 0) + 1;
  save();
  
  res.json({
    success: true,
    bonus: config.invite_bonus,
    coins: req.user.coins,
    totalInvited: req.user.totalInvited,
    remaining: config.invite_monthly_limit - monthInvites - 1
  });
});

module.exports = router;
