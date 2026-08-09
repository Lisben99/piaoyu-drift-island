/**
 * Invite routes: invite info (code, stats, bonuses)
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db } = require('../db');

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
    inviteBonus: config.invite_bonus,
    invitedBonus: config.invited_bonus
  });
});

module.exports = router;
