/**
 * Coin routes: balance, transactions, checkin
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, addCoinTransaction, awardExperience } = require('../db');

// Get coin balance and summary
router.get('/balance', auth, (req, res) => {
  const config = db().config;
  const today = new Date().toISOString().split('T')[0];
  const user = req.user;
  
  // Check if can checkin today
  const canCheckin = user.checkin.lastDate !== today;
  
  res.json({
    success: true,
    balance: user.coins,
    config: {
      daily_login_bonus: config.daily_login_bonus,
      consecutive_day3_bonus: config.consecutive_day3_bonus,
      consecutive_day7_bonus: config.consecutive_day7_bonus,
      bottle_publish_cost: config.bottle_publish_cost,
      chat_session_cost: config.chat_session_cost,
      permanent_chat_cost: config.permanent_chat_cost
    },
    checkin: {
      lastDate: user.checkin.lastDate,
      consecutive: user.checkin.consecutive,
      canCheckin
    }
  });
});

// Daily checkin
router.post('/checkin', auth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const user = req.user;
  const config = db().config;
  
  if (user.checkin.lastDate === today) {
    return res.json({ success: false, error: '今天已签到' });
  }
  
  // Calculate consecutive days
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (user.checkin.lastDate === yesterday) {
    user.checkin.experienceConsecutive = (user.checkin.experienceConsecutive || 0) + 1;
  } else {
    user.checkin.experienceConsecutive = 1;
  }
  if (user.checkin.lastDate === yesterday) {
    user.checkin.consecutive += 1;
  } else {
    user.checkin.consecutive = 1;
  }
  user.checkin.lastDate = today;
  
  // Calculate bonus
  let bonus = config.daily_login_bonus;
  let description = '每日签到';
  
  // Day 3 extra
  if (user.checkin.consecutive === 3) {
    bonus += config.consecutive_day3_bonus;
    description += `（连续3天额外+${config.consecutive_day3_bonus}）`;
  }
  // Day 7 extra
  if (user.checkin.consecutive === 7) {
    bonus += config.consecutive_day7_bonus;
    description += `（连续7天额外+${config.consecutive_day7_bonus}）`;
  }
  // Reset after day 7
  if (user.checkin.consecutive >= 7) {
    user.checkin.consecutive = 0;
  }
  
  addCoinTransaction(user.id, bonus, 'checkin', description);
  const experienceAwards = [awardExperience(user.id, 'daily_checkin', {
    eventKey: `checkin:${user.id}:${today}`,
    sourceId: today
  })];
  const streakPoints = { 3: 2, 7: 5, 14: 10, 30: 20 }[user.checkin.experienceConsecutive] || 0;
  if (streakPoints > 0) {
    experienceAwards.push(awardExperience(user.id, 'streak_bonus', {
      eventKey: `checkin-streak:${user.id}:${user.checkin.experienceConsecutive}:${today}`,
      sourceId: today,
      points: streakPoints
    }));
  }
  const experienceAward = experienceAwards.find(item => item.leveledUp) || experienceAwards[0];
  
  res.json({
    success: true,
    bonus,
    consecutive: user.checkin.consecutive || 7,
    coins: user.coins,
    experienceAward,
    experienceAwards
  });
});

// Get coin transactions (ledger)
router.get('/transactions', auth, (req, res) => {
  const { type, limit } = req.query;
  let txs = db().coinTransactions.filter(t => t.userId === req.user.id);
  if (type) txs = txs.filter(t => t.type === type);
  txs.sort((a, b) => b.createdAt - a.createdAt);
  if (limit) txs = txs.slice(0, parseInt(limit));
  
  res.json({ success: true, transactions: txs });
});

module.exports = router;
