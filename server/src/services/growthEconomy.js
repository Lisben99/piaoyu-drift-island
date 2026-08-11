/**
 * Growth-stage coin economy.
 * All grants are ledger-backed and idempotent so retries cannot mint coins twice.
 */
const {
  db,
  addCoinTransaction,
  computeUserLevel,
  chinaDateKey,
  findUserById
} = require('../db');

const LEVEL_DEFAULTS = {
  level_daily_coin_rewards: [20, 22, 24, 27, 30, 34, 38, 42, 46, 50],
  level_free_chat_quotas: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  level_free_bottle_quotas: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3],
  level_free_permanent_weekly: [0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
  level_upgrade_coin_rewards: [0, 20, 30, 40, 60, 80, 100, 150, 200, 300]
};

const ACTIVITY_RULES = {
  community_post: { bonus: 'daily_community_post_bonus', limit: 'daily_community_post_limit', first: 'first_community_post_bonus', label: '发布有效共鸣动态' },
  bottle_publish: { bonus: 'daily_bottle_publish_bonus', limit: 'daily_bottle_publish_limit', first: 'first_bottle_publish_bonus', label: '扔出第一个漂流瓶' },
  bottle_reply: { bonus: 'daily_bottle_reply_bonus', limit: 'daily_bottle_reply_limit', first: 'first_bottle_reply_bonus', label: '公开回应漂流瓶' },
  comment: { bonus: 'daily_comment_bonus', limit: 'daily_comment_limit', label: '评论动态' },
  mutual_chat: { bonus: 'daily_mutual_chat_bonus', limit: 'daily_mutual_chat_limit', first: 'first_mutual_chat_bonus', label: '完成双向聊天' },
  daily_prompt: { bonus: 'daily_prompt_bonus', limit: 'daily_prompt_limit', label: '参与每日一问' },
  received_like: { bonus: 'daily_received_like_bonus', limit: 'daily_received_like_limit', first: 'first_received_like_bonus', label: '收到真实用户点赞' },
  received_comment: { bonus: 'daily_received_comment_bonus', limit: 'daily_received_comment_limit', label: '收到真实用户评论' },
  first_follow: { first: 'first_follow_bonus', once: true, label: '关注用户' }
};

function numberConfig(key, fallback = 0) {
  const value = Number(db().config[key]);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function levelArray(config, key) {
  const raw = config[key];
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') return raw.split(',').map(item => Number(item.trim()));
  return LEVEL_DEFAULTS[key].slice();
}

function levelValue(config, key, level) {
  const list = levelArray(config, key);
  const index = Math.max(0, Math.min(9, (Number(level) || 1) - 1));
  const value = Number(list[index]);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : LEVEL_DEFAULTS[key][index];
}

function chinaMonthKey(now = Date.now()) {
  return chinaDateKey(now).slice(0, 7);
}

function chinaWeekKey(now = Date.now()) {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const day = shifted.getUTCDay() || 7;
  shifted.setUTCDate(shifted.getUTCDate() - day + 1);
  return shifted.toISOString().slice(0, 10);
}

function isHuman(user) {
  return user && (user.account_type || 'HUMAN') === 'HUMAN';
}

function transactionsFor(userId, type) {
  return (db().coinTransactions || []).filter(tx => tx.userId === userId && (!type || tx.type === type));
}

function countOnDate(userId, type, now = Date.now()) {
  const dateKey = chinaDateKey(now);
  return transactionsFor(userId, type).filter(tx => chinaDateKey(tx.createdAt) === dateKey).length;
}

function countInWeek(userId, type, now = Date.now()) {
  const weekKey = chinaWeekKey(now);
  return transactionsFor(userId, type).filter(tx => chinaWeekKey(tx.createdAt) === weekKey).length;
}

function awardCoinOnce(userId, amount, type, description, eventKey, now = Date.now()) {
  const user = findUserById(userId);
  const normalizedAmount = Math.max(0, Math.round(Number(amount) || 0));
  if (!isHuman(user) || normalizedAmount <= 0) return null;
  const refId = String(eventKey || '').trim();
  if (!refId) throw new Error('Growth coin eventKey is required');
  const exists = transactionsFor(userId, type).some(tx => tx.refId === refId);
  if (exists) return null;
  return addCoinTransaction(userId, normalizedAmount, type, description, refId);
}

function maybeAwardDailyCompletion(userId, now = Date.now()) {
  const required = ['growth_community_post', 'growth_bottle_reply', 'growth_comment', 'growth_mutual_chat'];
  if (!required.every(type => countOnDate(userId, type, now) > 0)) return null;
  const dateKey = chinaDateKey(now);
  return awardCoinOnce(
    userId,
    numberConfig('daily_all_tasks_bonus', 10),
    'daily_all_tasks',
    '完成全部每日活跃任务',
    `daily-all:${userId}:${dateKey}`,
    now
  );
}

function maybeAwardWeeklyProgress(userId, now = Date.now()) {
  const weekKey = chinaWeekKey(now);
  const weekly = [
    { id: 'community', types: ['growth_community_post'], goal: numberConfig('weekly_community_goal', 3), bonus: numberConfig('weekly_community_bonus', 20), label: '每周发布3条有效共鸣' },
    { id: 'mutual-chat', types: ['growth_mutual_chat'], goal: numberConfig('weekly_mutual_chat_goal', 5), bonus: numberConfig('weekly_mutual_chat_bonus', 20), label: '每周完成5次双向聊天' },
    { id: 'interaction', types: ['growth_received_like', 'growth_received_comment'], goal: numberConfig('weekly_interaction_goal', 10), bonus: numberConfig('weekly_interaction_bonus', 20), label: '每周收到10次真实互动' },
    { id: 'bottle-reply', types: ['growth_bottle_reply'], goal: numberConfig('weekly_bottle_reply_goal', 5), bonus: numberConfig('weekly_bottle_reply_bonus', 15), label: '每周公开回应5个漂流瓶' },
    { id: 'prompt', types: ['growth_daily_prompt'], goal: numberConfig('weekly_prompt_goal', 3), bonus: numberConfig('weekly_prompt_bonus', 15), label: '每周参与3次每日一问' }
  ];
  const awards = [];
  let completed = 0;
  for (const task of weekly) {
    const progress = task.types.reduce((sum, type) => sum + countInWeek(userId, type, now), 0);
    if (task.goal > 0 && progress >= task.goal) {
      completed += 1;
      const tx = awardCoinOnce(userId, task.bonus, `weekly_${task.id}`, task.label, `weekly:${task.id}:${userId}:${weekKey}`, now);
      if (tx) awards.push(tx);
    }
  }
  if (completed === weekly.length) {
    const all = awardCoinOnce(userId, numberConfig('weekly_all_tasks_bonus', 50), 'weekly_all_tasks', '完成全部每周活跃任务', `weekly:all:${userId}:${weekKey}`, now);
    if (all) awards.push(all);
  }
  return awards;
}

function maybeAwardNewcomerProgress(userId, now = Date.now()) {
  const user = findUserById(userId);
  if (!isHuman(user) || now - Number(user.createdAt || now) > 7 * 86400000) return [];
  const requiredTypes = [
    'profile_completed', 'interest_completed', 'first_community_post', 'first_bottle_publish',
    'first_bottle_reply', 'first_mutual_chat', 'first_follow', 'first_received_like'
  ];
  const completed = requiredTypes.filter(type => transactionsFor(userId, type).length > 0).length;
  const awards = [];
  if (completed >= 6) {
    const six = awardCoinOnce(userId, numberConfig('newcomer_six_tasks_bonus', 30), 'newcomer_tasks', '新人七日任务完成6项', `newcomer:6:${userId}`, now);
    if (six) awards.push(six);
  }
  if (completed === requiredTypes.length) {
    const all = awardCoinOnce(userId, numberConfig('newcomer_all_tasks_bonus', 80), 'newcomer_all_tasks', '新人七日任务全部完成', `newcomer:all:${userId}`, now);
    if (all) awards.push(all);
  }
  return awards;
}

function awardGrowthActivity(userId, activity, sourceId, now = Date.now()) {
  const user = findUserById(userId);
  const rule = ACTIVITY_RULES[activity];
  if (!rule || !isHuman(user) || db().config.growth_mode_enabled === false) return [];
  const awards = [];
  if (rule.first) {
    const first = awardCoinOnce(
      userId,
      numberConfig(rule.first, 0),
      `first_${activity}`,
      `首次${rule.label}`,
      `first:${activity}:${userId}`,
      now
    );
    if (first) awards.push(first);
  }
  if (rule.once) return awards;
  const limit = Math.max(0, numberConfig(rule.limit, 0));
  const dailyType = `growth_${activity}`;
  if (limit > 0 && countOnDate(userId, dailyType, now) < limit) {
    const dateKey = chinaDateKey(now);
    const daily = awardCoinOnce(
      userId,
      numberConfig(rule.bonus, 0),
      dailyType,
      `共建期任务：${rule.label}`,
      `daily:${activity}:${userId}:${dateKey}:${sourceId}`,
      now
    );
    if (daily) awards.push(daily);
  }
  const completion = maybeAwardDailyCompletion(userId, now);
  if (completion) awards.push(completion);
  awards.push(...maybeAwardWeeklyProgress(userId, now));
  awards.push(...maybeAwardNewcomerProgress(userId, now));
  return awards;
}

function awardInviteMilestone(userOrId, milestone, now = Date.now()) {
  const user = typeof userOrId === 'string' ? findUserById(userOrId) : userOrId;
  if (!isHuman(user) || !user.invitedBy || user.inviteRewardEligible === false || db().config.growth_mode_enabled === false) return null;
  const inviter = findUserById(user.invitedBy);
  if (!isHuman(inviter)) return null;
  const keyMap = {
    profile: ['invite_profile_bonus', '受邀好友完善资料'],
    publish: ['invite_first_publish_bonus', '受邀好友完成首次发布'],
    mutual_chat: ['invite_first_chat_bonus', '受邀好友完成首次双向聊天'],
    active_7d: ['invite_active_7d_bonus', '受邀好友连续活跃7天']
  };
  const entry = keyMap[milestone];
  if (!entry) return null;
  return awardCoinOnce(inviter.id, numberConfig(entry[0], 0), 'invite_milestone', entry[1], `invite:${user.id}:${milestone}`, now);
}

function getBenefits(user, now = Date.now()) {
  const config = db().config;
  const level = computeUserLevel(user).level;
  const benefits = {
    level,
    dailyCheckinCoins: levelValue(config, 'level_daily_coin_rewards', level),
    freeChats: levelValue(config, 'level_free_chat_quotas', level),
    freeBottles: levelValue(config, 'level_free_bottle_quotas', level),
    freePermanentWeekly: levelValue(config, 'level_free_permanent_weekly', level)
  };
  const dateKey = chinaDateKey(now);
  const weekKey = chinaWeekKey(now);
  benefits.usedFreeChats = transactionsFor(user.id, 'free_chat_session').filter(tx => tx.refId && tx.refId.includes(`:${dateKey}:`)).length;
  benefits.usedFreeBottles = transactionsFor(user.id, 'free_bottle_publish').filter(tx => tx.refId && tx.refId.includes(`:${dateKey}:`)).length;
  benefits.usedFreePermanentWeekly = transactionsFor(user.id, 'free_permanent_chat').filter(tx => tx.refId && tx.refId.includes(`:${weekKey}:`)).length;
  benefits.remainingFreeChats = Math.max(0, benefits.freeChats - benefits.usedFreeChats);
  benefits.remainingFreeBottles = Math.max(0, benefits.freeBottles - benefits.usedFreeBottles);
  benefits.remainingFreePermanentWeekly = Math.max(0, benefits.freePermanentWeekly - benefits.usedFreePermanentWeekly);
  return benefits;
}

function consumeGrowthAction(user, action, sourceId, now = Date.now()) {
  const config = db().config;
  const benefits = getBenefits(user, now);
  const dateKey = chinaDateKey(now);
  const weekKey = chinaWeekKey(now);
  const rules = {
    chat: { remaining: 'remainingFreeChats', freeType: 'free_chat_session', paidType: 'chat_session', cost: 'chat_session_cost', period: dateKey, label: '发起聊天会话' },
    bottle: { remaining: 'remainingFreeBottles', freeType: 'free_bottle_publish', paidType: 'bottle_publish', cost: 'bottle_publish_cost', period: dateKey, label: '发布漂流瓶' },
    permanent: { remaining: 'remainingFreePermanentWeekly', freeType: 'free_permanent_chat', paidType: 'permanent_chat', cost: 'permanent_chat_cost', period: weekKey, label: '请求永久续聊（预扣）' }
  };
  const rule = rules[action];
  if (!rule) throw new Error('Unknown growth action');
  const refId = `${action}:${rule.period}:${sourceId}:${Date.now()}`;
  if (db().config.growth_mode_enabled !== false && benefits[rule.remaining] > 0) {
    addCoinTransaction(user.id, 0, rule.freeType, `${rule.label}（等级免费额度）`, refId);
    return { success: true, free: true, charged: 0, benefits: getBenefits(user, now) };
  }
  const cost = numberConfig(rule.cost, 0);
  if ((Number(user.coins) || 0) < cost) {
    return { success: false, error: '漂流币不足，请先签到或完成任务', needRecharge: true, cost, benefits };
  }
  addCoinTransaction(user.id, -cost, rule.paidType, rule.label, refId);
  return { success: true, free: false, charged: cost, benefits: getBenefits(user, now) };
}

function getMonthlyCheckinCount(userId, now = Date.now()) {
  const monthKey = chinaMonthKey(now);
  const days = new Set(
    transactionsFor(userId, 'checkin')
      .filter(tx => chinaMonthKey(tx.createdAt) === monthKey)
      .map(tx => chinaDateKey(tx.createdAt))
  );
  return days.size;
}

module.exports = {
  LEVEL_DEFAULTS,
  levelValue,
  chinaMonthKey,
  chinaWeekKey,
  awardCoinOnce,
  awardGrowthActivity,
  maybeAwardWeeklyProgress,
  maybeAwardNewcomerProgress,
  awardInviteMilestone,
  getBenefits,
  consumeGrowthAction,
  getMonthlyCheckinCount
};
