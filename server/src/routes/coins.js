/**
 * Coin routes: balance, transactions, checkin
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, addCoinTransaction, awardExperience, chinaDateKey } = require('../db');
const { getBenefits, getMonthlyCheckinCount, awardInviteMilestone } = require('../services/growthEconomy');

function requestNow(req) {
  return req.app && req.app.locals && typeof req.app.locals.now === 'function'
    ? Number(req.app.locals.now())
    : Date.now();
}

// Get coin balance and summary
router.get('/balance', auth, (req, res) => {
  const config = db().config;
  const today = chinaDateKey(requestNow(req));
  const user = req.user;
  const benefits = getBenefits(user, requestNow(req));
  const monthlyCount = getMonthlyCheckinCount(user.id, requestNow(req));
  
  // Check if can checkin today
  const canCheckin = user.checkin.lastDate !== today;
  
  res.json({
    success: true,
    balance: user.coins,
    config: {
      daily_login_bonus: config.daily_login_bonus,
      consecutive_day3_bonus: config.consecutive_day3_bonus,
      consecutive_day7_bonus: config.consecutive_day7_bonus,
      consecutive_day14_bonus: config.consecutive_day14_bonus,
      consecutive_day21_bonus: config.consecutive_day21_bonus,
      consecutive_day30_bonus: config.consecutive_day30_bonus,
      weekly_full_bonus: config.weekly_full_bonus,
      monthly_checkin_20_bonus: config.monthly_checkin_20_bonus,
      monthly_checkin_25_bonus: config.monthly_checkin_25_bonus,
      monthly_full_bonus: config.monthly_full_bonus,
      bottle_publish_cost: config.bottle_publish_cost,
      chat_session_cost: config.chat_session_cost,
      permanent_chat_cost: config.permanent_chat_cost,
      growth_mode_enabled: config.growth_mode_enabled !== false,
      growth_campaign_name: config.growth_campaign_name || '漂屿共建期'
    },
    checkin: {
      lastDate: user.checkin.lastDate,
      consecutive: user.checkin.consecutive,
      canCheckin,
      monthlyCount
    },
    benefits,
    growthRules: {
      tasks: [
        { label: '发布有效共鸣动态', coins: config.daily_community_post_bonus, limit: config.daily_community_post_limit },
        { label: '公开回应漂流瓶', coins: config.daily_bottle_reply_bonus, limit: config.daily_bottle_reply_limit },
        { label: '评论动态', coins: config.daily_comment_bonus, limit: config.daily_comment_limit },
        { label: '完成双向聊天', coins: config.daily_mutual_chat_bonus, limit: config.daily_mutual_chat_limit },
        { label: '收到真实用户点赞', coins: config.daily_received_like_bonus, limit: config.daily_received_like_limit },
        { label: '收到真实用户评论', coins: config.daily_received_comment_bonus, limit: config.daily_received_comment_limit }
      ],
      allTasksBonus: config.daily_all_tasks_bonus,
      weeklyTasks: [
        { label: `发布 ${config.weekly_community_goal} 条有效共鸣`, coins: config.weekly_community_bonus },
        { label: `完成 ${config.weekly_mutual_chat_goal} 次双向聊天`, coins: config.weekly_mutual_chat_bonus },
        { label: `收到 ${config.weekly_interaction_goal} 次真实互动`, coins: config.weekly_interaction_bonus },
        { label: `公开回应 ${config.weekly_bottle_reply_goal} 个漂流瓶`, coins: config.weekly_bottle_reply_bonus },
      ],
      weeklyAllBonus: config.weekly_all_tasks_bonus,
      newcomerSixBonus: config.newcomer_six_tasks_bonus,
      newcomerAllBonus: config.newcomer_all_tasks_bonus,
      firstRewards: [
        { label: '首次发布共鸣', coins: config.first_community_post_bonus },
        { label: '首次扔漂流瓶', coins: config.first_bottle_publish_bonus },
        { label: '首次公开回应', coins: config.first_bottle_reply_bonus },
        { label: '首次双向聊天', coins: config.first_mutual_chat_bonus },
        { label: '首次关注', coins: config.first_follow_bonus }
      ]
    }
  });
});

// Daily checkin
router.post('/checkin', auth, (req, res) => {
  const now = requestNow(req);
  const today = chinaDateKey(now);
  const user = req.user;
  const config = db().config;
  if (config.enable_daily_reward === false) {
    return res.json({ success: false, error: '签到奖励暂未开放' });
  }
  
  if (user.checkin.lastDate === today) {
    return res.json({ success: false, error: '今天已签到' });
  }
  
  // Calculate the real continuous streak. It no longer resets every seven days.
  const yesterday = chinaDateKey(now - 86400000);
  if (user.checkin.lastDate === yesterday) {
    user.checkin.consecutive = (Number(user.checkin.consecutive) || 0) + 1;
  } else {
    user.checkin.consecutive = 1;
  }
  user.checkin.experienceConsecutive = user.checkin.consecutive;
  user.checkin.lastDate = today;
  
  const benefits = getBenefits(user, now);
  let bonus = config.growth_mode_enabled === false
    ? Math.max(0, Number(config.daily_login_bonus) || 0)
    : benefits.dailyCheckinCoins;
  const parts = [`等级签到 +${bonus}`];
  const streak = user.checkin.consecutive;
  const exactMilestones = {
    3: Number(config.consecutive_day3_bonus) || 0,
    7: Number(config.consecutive_day7_bonus) || 0,
    14: Number(config.consecutive_day14_bonus) || 0,
    21: Number(config.consecutive_day21_bonus) || 0,
    30: Number(config.consecutive_day30_bonus) || 0
  };
  if (exactMilestones[streak] > 0) {
    bonus += exactMilestones[streak];
    parts.push(`连续${streak}天 +${exactMilestones[streak]}`);
  }
  if (streak > 0 && streak % 7 === 0 && Number(config.weekly_full_bonus) > 0) {
    bonus += Number(config.weekly_full_bonus);
    parts.push(`本周满签 +${config.weekly_full_bonus}`);
  }
  const monthlyCount = getMonthlyCheckinCount(user.id, now) + 1;
  const monthDate = new Date(now + 8 * 60 * 60 * 1000);
  const daysInMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
  const monthlyMilestones = {
    20: Number(config.monthly_checkin_20_bonus) || 0,
    25: Number(config.monthly_checkin_25_bonus) || 0,
    [daysInMonth]: Number(config.monthly_full_bonus) || 0
  };
  if (monthlyMilestones[monthlyCount] > 0) {
    bonus += monthlyMilestones[monthlyCount];
    parts.push(monthlyCount === daysInMonth ? `月度全勤 +${monthlyMilestones[monthlyCount]}` : `本月签到${monthlyCount}天 +${monthlyMilestones[monthlyCount]}`);
  }
  const checkinTx = addCoinTransaction(user.id, bonus, 'checkin', parts.join('；'), `checkin:${user.id}:${today}`);
  checkinTx.createdAt = now;
  save();
  const experienceAwards = [awardExperience(user.id, 'daily_checkin', {
    eventKey: `checkin:${user.id}:${today}`,
    sourceId: today,
    now
  })];
  const streakPoints = { 3: 2, 7: 5, 14: 10, 30: 20 }[streak] || 0;
  if (streakPoints > 0) {
    experienceAwards.push(awardExperience(user.id, 'streak_bonus', {
      eventKey: `checkin-streak:${user.id}:${user.checkin.experienceConsecutive}:${today}`,
      sourceId: today,
      points: streakPoints,
      now
    }));
  }
  const experienceAward = experienceAwards.find(item => item.leveledUp) || experienceAwards[0];
  if (streak >= 7) awardInviteMilestone(user, 'active_7d', now);
  
  res.json({
    success: true,
    bonus,
    consecutive: streak,
    monthlyCount,
    coins: user.coins,
    benefits: getBenefits(user, now),
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
