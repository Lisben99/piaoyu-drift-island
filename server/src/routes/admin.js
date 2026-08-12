/**
 * Admin routes: login, dashboard, user mgmt, bottle mgmt, coin mgmt, orders, reports, config, audit
 */
const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const { db, save, genId, findUserById, findBottleById, getMomentById, addCoinTransaction, addAuditLog, findAdminById, createBot, getBotProfiles, findBotProfileByBotId, updateBotProfile, computeUserLevel, awardExperience, DEFAULT_CONFIG } = require('../db');
const { signAdminToken } = require('../utils/jwt');
const { comparePassword, hashPassword } = require('../utils/crypto');
const { PACKAGES, refundOrder, confirmPayment, rejectOrder } = require('../services/payment');
const botEngine = require('../services/botEngine');
const aiProvider = require('../services/aiProvider');
const { sendSiteMail, listAdminMail } = require('../services/siteMail');
const { sendPopupNotification, listAdminPopups } = require('../services/popupNotifications');
const { sendToUser } = require('../services/websocket');

// Admin login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(401).json({ success: false, error: '请输入账号和密码' });
  }
  
  const admin = db().admins.find(a => a.username === username);
  if (!admin) {
    return res.status(401).json({ success: false, error: '账号不存在' });
  }
  
  if (!comparePassword(password, admin.password)) {
    return res.status(401).json({ success: false, error: '密码错误' });
  }
  
  const token = signAdminToken(admin);
  res.json({
    success: true,
    token,
    admin: { id: admin.id, username: admin.username, role: admin.role }
  });
});

// Change admin password (must be logged in and provide current password)
router.post('/change-password', adminAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: '请提供当前密码和新密码' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: '新密码至少 6 位' });
  }

  const admin = db().admins.find(a => a.id === req.admin.id);
  if (!admin) {
    return res.status(404).json({ success: false, error: '管理员不存在' });
  }
  if (!comparePassword(currentPassword, admin.password)) {
    return res.status(401).json({ success: false, error: '当前密码错误' });
  }

  admin.password = hashPassword(newPassword);
  admin.passwordChangedAt = Date.now();
  addAuditLog(admin.id, 'change_password', admin.id, '管理员修改登录密码');
  save();
  res.json({ success: true, message: '密码修改成功' });
});

// Dashboard stats
router.get('/dashboard', adminAuth, (req, res) => {
  const database = db();
  const now = Date.now();
  const todayStart = new Date().setHours(0, 0, 0, 0);
  
  // Exclude BOT accounts from human user metrics (AGENTS §5.2 / §25 rule 5).
  const humanUsers = database.users.filter(u => u.status !== 'deleted' && (u.account_type || 'HUMAN') !== 'BOT');
  const totalUsers = humanUsers.length;
  const dailyActive = humanUsers.filter(u => u.lastLoginAt && u.lastLoginAt >= todayStart).length;
  const totalBottles = database.bottles.filter(b => !b.deleted).length;
  const totalMoments = database.moments.filter(m => !m.deleted).length;
  const totalSessions = database.chatSessions.length;
  const totalRecharged = database.rechargeOrders
    .filter(o => o.status === 'paid')
    .reduce((sum, o) => sum + o.amount, 0);
  const totalCoinsInCirculation = database.users.reduce((sum, u) => sum + (u.coins || 0), 0);
  const pendingReports = database.reports.filter(r => r.status === 'pending').length;
  // 侧边栏「充值订单」角标：显示「待确认到账并发码」数量（用户已上传凭证，管理员尚未确认）
  const pendingOrders = database.rechargeOrders.filter(o => o.status === 'submitted').length;
  const pendingSupport = database.supportTickets.filter(t => t.status === 'pending' || t.status === 'replied').length;
  const penalizedAccounts = database.users.filter(u => u.status === 'banned' || u.status === 'frozen' || u.status === 'restricted').length;
  // 今日新增注册（活跃人类用户，不含已注销/BOT）
  const newUsersToday = humanUsers.filter(u => u.createdAt && u.createdAt >= todayStart).length;
  // 累计注销用户
  const deletedUsers = database.users.filter(u => u.status === 'deleted').length;
  // 累计封禁账号（从「处罚账号」中独立出来，便于单独跟踪）
  const bannedUsers = database.users.filter(u => u.status === 'banned').length;
  
  // Recent users (humans only)
  const recentUsers = database.users
    .filter(u => u.status !== 'deleted' && (u.account_type || 'HUMAN') !== 'BOT')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map(u => ({
      id: u.id, phone: u.phone, email: u.email || '', nickname: u.nickname || '未设置',
      createdAt: u.createdAt, status: u.status
    }));
  
  // Recent reports
  const recentReports = database.reports
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  
  res.json({
    success: true,
    stats: {
      totalUsers, dailyActive, totalBottles, totalMoments, totalSessions,
      totalRecharged, totalCoinsInCirculation,
      pendingReports, pendingOrders, pendingSupport, penalizedAccounts,
      newUsersToday, deletedUsers, bannedUsers
    },
    botStats: botEngine.getBotStats(),
    recentUsers,
    recentReports
  });
});

// User management - list
router.get('/users', adminAuth, (req, res) => {
  const { search, status, page = 1, pageSize = 20 } = req.query;
  let users;
  if (status === 'deleted') {
    // 查看已注销账号（默认列表隐藏注销用户，便于审核）
    users = db().users.filter(u => u.status === 'deleted');
  } else {
    users = db().users.filter(u => u.status !== 'deleted');
    if (status && status !== 'all') {
      users = users.filter(u => u.status === status);
    }
  }
  
  if (search) {
    const q = search.toLowerCase();
    users = users.filter(u =>
      (u.nickname && u.nickname.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.id.includes(q)
    );
  }
  
  const total = users.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = users
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize))
    .map(u => ({
      id: u.id, phone: u.phone, email: u.email || '', nickname: u.nickname || '未设置',
      gender: u.gender, role: u.role, coins: u.coins,
      status: u.status, restrictions: u.restrictions,
      totalRecharged: u.totalRecharged, totalInvited: u.totalInvited,
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt
    }));
  
  res.json({ success: true, users: paged, total, page: parseInt(page), pageSize: parseInt(pageSize) });
});

// User detail
router.get('/users/:id', adminAuth, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.json({ success: false, error: '用户不存在' });
  }
  
  const bottles = db().bottles.filter(b => b.authorId === user.id).slice(-20);
  const transactions = db().coinTransactions.filter(t => t.userId === user.id).slice(-20);
  const orders = db().rechargeOrders.filter(o => o.userId === user.id);
  const lvl = computeUserLevel(user);

  res.json({
    success: true,
    user: {
      ...user,
      level: lvl.level,
      levelTitle: lvl.title,
      bottles,
      transactions,
      orders
    }
  });
});

// Penalize user
router.post('/users/:id/penalize', adminAuth, (req, res) => {
  const { action, reason } = req.body;
  const user = findUserById(req.params.id);
  if (!user) {
    return res.json({ success: false, error: '用户不存在' });
  }
  
  const validActions = ['restrict_publish', 'restrict_chat', 'freeze', 'ban', 'restore'];
  if (!validActions.includes(action)) {
    return res.json({ success: false, error: '无效的操作' });
  }
  
  switch (action) {
    case 'restrict_publish':
      user.restrictions.publish = true;
      if (user.status === 'active') user.status = 'restricted';
      break;
    case 'restrict_chat':
      user.restrictions.chat = true;
      if (user.status === 'active') user.status = 'restricted';
      break;
    case 'freeze':
      user.status = 'frozen';
      break;
    case 'ban':
      user.status = 'banned';
      break;
    case 'restore':
      user.status = 'active';
      user.restrictions = { publish: false, chat: false };
      break;
  }
  
  addAuditLog(req.admin.id, 'penalize', user.id, `${action}: ${reason || '无'}`);
  save();
  
  res.json({ success: true, user: { id: user.id, status: user.status, restrictions: user.restrictions } });
});

// Set/clear a user's verification badge (认证徽章).
// verifiedType: 'personal' (黄V) | 'official' (蓝V). Clearing verified unsets both.
router.post('/users/:id/verify', adminAuth, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.json({ success: false, error: '用户不存在' });
  }
  const { verified, verifiedType } = req.body || {};
  user.verified = !!verified;
  if (user.verified) {
    user.verifiedType = verifiedType === 'official' ? 'official' : 'personal';
    user.verifiedAt = Date.now();
  } else {
    user.verifiedType = '';
    user.verifiedAt = null;
  }
  addAuditLog(req.admin.id, 'verify_user', user.id, `认证设置: ${user.verified ? user.verifiedType : '取消认证'}`);
  save();
  res.json({ success: true, verified: user.verified, verifiedType: user.verifiedType });
});

// Bottle management - list
router.get('/bottles', adminAuth, (req, res) => {
  const { search, status, page = 1, pageSize = 20 } = req.query;
  let bottles = db().bottles;
  
  if (search) {
    bottles = bottles.filter(b => b.content.includes(search));
  }
  if (status && status !== 'all') {
    bottles = bottles.filter(b => b.status === status);
  }
  
  const total = bottles.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = bottles
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize))
    .map(b => {
      const author = findUserById(b.authorId);
      return {
        ...b,
        authorNickname: author ? author.nickname : '未知'
      };
    });
  
  res.json({ success: true, bottles: paged, total });
});

// Admin delete bottle
router.delete('/bottles/:id', adminAuth, (req, res) => {
  const bottle = findBottleById(req.params.id);
  if (!bottle) {
    return res.json({ success: false, error: '漂流瓶不存在' });
  }
  bottle.deleted = true;
  bottle.status = 'deleted';
  bottle.adminDeleted = true;
  bottle.adminDeletedBy = req.admin.id;
  addAuditLog(req.admin.id, 'delete_bottle', bottle.id, '管理员删除漂流瓶');
  save();
  res.json({ success: true });
});

// ===== Moment (动态) management =====
// List all moments (content moderation). Supports search + status filter + pagination.
router.get('/moments', adminAuth, (req, res) => {
  const { search, status, page = 1, pageSize = 20 } = req.query;
  let moments = db().moments;
  if (status === 'deleted') {
    moments = moments.filter(m => m.deleted);
  } else {
    moments = moments.filter(m => !m.deleted);
    if (status === 'image') moments = moments.filter(m => (m.images || []).length > 0);
  }
  if (search) {
    const q = String(search).toLowerCase();
    moments = moments.filter(m =>
      (m.content && m.content.toLowerCase().includes(q)) ||
      (m.userId && m.userId.toLowerCase().includes(q))
    );
  }
  const total = moments.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = moments
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize))
    .map(m => {
      const author = findUserById(m.userId) || {};
      const imgs = m.images || [];
      return {
        id: m.id,
        content: m.content || '',
        imageCount: imgs.length,
        preview: imgs[0] || '',
        authorId: m.userId,
        authorNickname: author.nickname || '用户',
        authorGender: author.gender || '',
        likeCount: (m.likes || []).length,
        commentCount: (m.comments || []).length,
        createdAt: m.createdAt,
        deleted: !!m.deleted
      };
    });
  res.json({ success: true, moments: paged, total });
});

// Moment detail (all images + comments) for the moderation modal.
router.get('/moments/:id', adminAuth, (req, res) => {
  const m = getMomentById(req.params.id);
  if (!m) return res.json({ success: false, error: '动态不存在' });
  const author = findUserById(m.userId) || {};
  res.json({
    success: true,
    moment: {
      id: m.id,
      content: m.content || '',
      images: m.images || [],
      authorId: m.userId,
      authorNickname: author.nickname || '用户',
      authorGender: author.gender || '',
      likeCount: (m.likes || []).length,
      createdAt: m.createdAt,
      deleted: !!m.deleted,
      comments: (m.comments || []).map(c => {
        const cu = findUserById(c.userId) || {};
        return { id: c.id, userId: c.userId, nickname: cu.nickname || '用户', content: c.content, createdAt: c.createdAt };
      })
    }
  });
});

// Admin delete a moment (marks deleted + audit log).
router.delete('/moments/:id', adminAuth, (req, res) => {
  const m = getMomentById(req.params.id);
  if (!m) return res.json({ success: false, error: '动态不存在' });
  if (m.deleted) return res.json({ success: false, error: '动态已删除' });
  m.deleted = true;
  m.adminDeleted = true;
  m.adminDeletedBy = req.admin.id;
  addAuditLog(req.admin.id, 'delete_moment', m.id, `管理员删除动态（作者 ${m.userId || '未知'}）`);
  save();
  res.json({ success: true });
});

// Coin management - stats
router.get('/coins/stats', adminAuth, (req, res) => {
  const txs = db().coinTransactions;
  const credits = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const debits = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
  
  const byType = {};
  txs.forEach(t => {
    if (!byType[t.type]) byType[t.type] = { count: 0, total: 0 };
    byType[t.type].count++;
    byType[t.type].total += t.amount;
  });
  
  const adminAdjusts = txs
    .filter(t => t.type === 'admin_adjust')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);
  
  res.json({ success: true, credits, debits, byType, adminAdjusts });
});

// Coin management - adjust
router.post('/coins/adjust', adminAuth, (req, res) => {
  const { userId, amount, reason } = req.body;
  const user = findUserById(userId);
  if (!user) {
    return res.json({ success: false, error: '用户不存在' });
  }
  
  addCoinTransaction(userId, amount, 'admin_adjust', `管理员调整：${reason || '无'}`);
  addAuditLog(req.admin.id, 'coin_adjust', userId, `调整${amount > 0 ? '+' : ''}${amount}: ${reason || '无'}`);
  
  res.json({ success: true, coins: user.coins });
});

// Recharge orders - list
router.get('/orders', adminAuth, (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  let orders = db().rechargeOrders;
  if (status && status !== 'all') {
    orders = orders.filter(o => o.status === status);
  }
  const total = orders.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = orders
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize))
    .map(o => {
      const user = findUserById(o.userId);
      return { ...o, userNickname: user ? user.nickname : '未知', userPhone: user ? user.phone : '' };
    });
  
  res.json({ success: true, orders: paged, total });
});

// Confirm a recharge order: admin verifies the user's payment proof, then a redeem code is generated
// The user must redeem the code in-app to receive the coins.
router.post('/orders/:id/confirm', adminAuth, async (req, res) => {
  const result = await confirmPayment(req.params.id, {}, { adminId: req.admin.id });
  if (result.success) {
    addAuditLog(req.admin.id, 'recharge_confirm', req.params.id, `确认充值到账，发放兑换码 ${result.redeemCode ? result.redeemCode.code : 'unknown'}（${result.coins} 枚漂流币）`);
  }
  res.json(result);
});

// Reject a recharge order (payment not received / mismatched)
router.post('/orders/:id/reject', adminAuth, async (req, res) => {
  const { reason } = req.body || {};
  const result = await rejectOrder(req.params.id, reason);
  if (result.success) {
    addAuditLog(req.admin.id, 'recharge_reject', req.params.id, `拒绝充值：${reason || ''}`);
  }
  res.json(result);
});

// Refund order
router.post('/orders/:id/refund', adminAuth, async (req, res) => {
  const { reason } = req.body;
  const result = await refundOrder(req.params.id, reason || '管理员退款');
  if (result.success) {
    addAuditLog(req.admin.id, 'refund', req.params.id, `退款: ${reason || '无'}`);
  }
  res.json(result);
});

// Reports - list
router.get('/reports', adminAuth, (req, res) => {
  const { status, page = 1, pageSize = 20 } = req.query;
  let reports = db().reports;
  if (status && status !== 'all') {
    reports = reports.filter(r => r.status === status);
  }
  const total = reports.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = reports
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(start, start + parseInt(pageSize));
  
  res.json({ success: true, reports: paged, total });
});

// Handle report
router.post('/reports/:id/handle', adminAuth, (req, res) => {
  const { result, note } = req.body;
  const report = db().reports.find(r => r.id === req.params.id);
  if (!report) {
    return res.json({ success: false, error: '举报不存在' });
  }
  
  report.status = result === 'dismissed' ? 'dismissed' : 'resolved';
  report.handledAt = Date.now();
  report.handleResult = result;
  report.handleNote = note || '';
  report.handledBy = req.admin.id;
  
  addAuditLog(req.admin.id, 'handle_report', report.id, `${result}: ${note || '无'}`);
  save();
  const experienceAward = result === 'dismissed' ? null : awardExperience(report.reporterId, 'report_accepted', {
    eventKey: `report:${report.id}`,
    sourceId: report.id
  });
  res.json({ success: true, report, experienceAward });
});

// Config - get
router.get('/config', adminAuth, (req, res) => {
  res.json({ success: true, config: db().config });
});

// Config - update
router.post('/config', adminAuth, (req, res) => {
  const requested = req.body || {};
  const updates = {};
  for (const [key, raw] of Object.entries(requested)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) continue;
    const expected = DEFAULT_CONFIG[key];
    if (Array.isArray(expected)) {
      const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
      const parsed = values.map(value => Number(value));
      if (parsed.length !== expected.length || parsed.some(value => !Number.isFinite(value) || value < 0)) {
        return res.status(400).json({ success: false, error: `${key} 必须包含 ${expected.length} 个非负数字` });
      }
      updates[key] = parsed.map(value => Math.round(value));
    } else if (typeof expected === 'boolean') {
      updates[key] = raw === true || raw === 'true';
    } else if (typeof expected === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 1000000) {
        return res.status(400).json({ success: false, error: `${key} 必须是有效的非负数字` });
      }
      updates[key] = value;
    } else {
      const value = String(raw == null ? '' : raw).slice(0, key === 'paymentQR' ? 4000000 : 500);
      if (key === 'coin_operation_mode' && !['free', 'normal'].includes(value)) {
        return res.status(400).json({ success: false, error: '运营模式只能是免费推广模式或正常运营模式' });
      }
      updates[key] = value;
    }
  }
  if (!Object.keys(updates).length) return res.status(400).json({ success: false, error: '没有可保存的配置' });
  const oldConfig = { ...db().config };
  Object.assign(db().config, updates);
  console.log('[Admin] config updated:', JSON.stringify(updates));
  addAuditLog(req.admin.id, 'config_update', 'config', `配置更新: ${JSON.stringify(updates)}`);
  save();
  res.json({ success: true, config: db().config });
});

// Audit logs
router.get('/audit', adminAuth, (req, res) => {
  const { page = 1, pageSize = 50 } = req.query;
  const logs = db().auditLogs.sort((a, b) => b.createdAt - a.createdAt);
  const total = logs.length;
  const start = (parseInt(page) - 1) * parseInt(pageSize);
  const paged = logs.slice(start, start + parseInt(pageSize));
  
  res.json({ success: true, logs: paged, total });
});

// ===== Site mail =====
router.get('/mail', adminAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const result = listAdminMail({ limit, offset: (page - 1) * limit });
  res.json({ success: true, mails: result.items, total: result.total, page, pageSize: limit });
});

router.post('/mail/send', adminAuth, (req, res) => {
  try {
    const result = sendSiteMail({ ...(req.body || {}), adminId: req.admin.id });
    addAuditLog(req.admin.id, 'site_mail_send', result.mail.id,
      `发送站内信“${result.mail.title}”，送达 ${result.recipients.length} 人`);
    for (const user of result.recipients) {
      sendToUser(user.id, { type: 'site_mail', data: { mailId: result.mail.id, title: result.mail.title } });
    }
    res.json({
      success: true,
      mail: result.mail,
      deliveredCount: result.recipients.length,
      unresolved: result.unresolved
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || '发送失败' });
  }
});

router.get('/popups', adminAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const result = listAdminPopups({ limit, offset: (page - 1) * limit });
  res.json({ success: true, popups: result.items, total: result.total, page, pageSize: limit });
});

router.post('/popups/send', adminAuth, (req, res) => {
  try {
    const result = sendPopupNotification({ ...(req.body || {}), adminId: req.admin.id });
    addAuditLog(req.admin.id, 'popup_notification_send', result.popup.id,
      `发送重要弹窗“${result.popup.title}”，送达 ${result.recipients.length} 人`);
    for (const user of result.recipients) {
      sendToUser(user.id, { type: 'important_popup', data: { popupId: result.popup.id } });
    }
    res.json({
      success: true,
      popup: result.popup,
      deliveredCount: result.recipients.length,
      unresolved: result.unresolved
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || '发送失败' });
  }
});

// ===== Bot management (AGENTS §16) =====
// List bot profiles (joined with linked user info)
router.get('/bots', adminAuth, (req, res) => {
  const profiles = getBotProfiles().map(p => {
    const user = findUserById(p.userId);
    return {
      botId: p.botId,
      userId: p.userId,
      displayName: p.displayName,
      genderDisplay: p.genderDisplay,
      personaPrompt: p.personaPrompt,
      speakingStyle: p.speakingStyle,
      activityWeight: p.activityWeight,
      enabled: p.enabled,
      dailyPosts: p.dailyPosts || 0,
      dailyReplies: p.dailyReplies || 0,
      dailyMaxPosts: p.dailyMaxPosts != null ? p.dailyMaxPosts : db().config.bot_daily_max_posts,
      dailyMaxReplies: p.dailyMaxReplies != null ? p.dailyMaxReplies : db().config.bot_daily_max_replies,
      nickname: user ? user.nickname : ''
    };
  });
  res.json({ success: true, bots: profiles, aiConfigured: aiProvider.isConfigured(), aiProvider: aiProvider.providerLabel() });
});

// Create a new bot
router.post('/bots', adminAuth, (req, res) => {
  const { displayName, genderDisplay, personaPrompt, speakingStyle, activityWeight } = req.body;
  if (!displayName || !displayName.trim()) {
    return res.json({ success: false, error: '请填写机器人昵称' });
  }
  const profile = createBot(displayName.trim(), genderDisplay || 'neutral', personaPrompt || '', speakingStyle || '', activityWeight);
  addAuditLog(req.admin.id, 'bot_create', profile.botId, `创建机器人: ${displayName}`);
  save();
  res.json({ success: true, bot: profile });
});

// Update a bot (toggle enabled, edit persona, caps, weight)
router.put('/bots/:id', adminAuth, (req, res) => {
  const updates = req.body || {};
  if (updates.activityWeight != null) updates.activityWeight = parseFloat(updates.activityWeight);
  if (updates.dailyMaxPosts != null) updates.dailyMaxPosts = parseInt(updates.dailyMaxPosts);
  if (updates.dailyMaxReplies != null) updates.dailyMaxReplies = parseInt(updates.dailyMaxReplies);
  const p = updateBotProfile(req.params.id, updates);
  if (!p) return res.json({ success: false, error: '机器人不存在' });
  addAuditLog(req.admin.id, 'bot_update', req.params.id, `更新机器人: ${JSON.stringify(updates)}`);
  save();
  res.json({ success: true, bot: p });
});

// Delete a bot (removes profile from the active pool; past bottles remain)
router.delete('/bots/:id', adminAuth, (req, res) => {
  const list = db().botProfiles;
  const idx = list.findIndex(b => b.botId === req.params.id);
  if (idx === -1) return res.json({ success: false, error: '机器人不存在' });
  const removed = list.splice(idx, 1)[0];
  addAuditLog(req.admin.id, 'bot_delete', req.params.id, `删除机器人: ${removed.displayName}`);
  save();
  res.json({ success: true });
});

module.exports = router;
