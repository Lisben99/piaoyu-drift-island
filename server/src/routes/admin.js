/**
 * Admin routes: login, dashboard, user mgmt, bottle mgmt, coin mgmt, orders, reports, config, audit
 */
const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const { db, save, genId, findUserById, findBottleById, addCoinTransaction, addAuditLog, findAdminById } = require('../db');
const { signAdminToken } = require('../utils/jwt');
const { comparePassword, hashPassword } = require('../utils/crypto');
const { PACKAGES, refundOrder, confirmPayment, rejectOrder } = require('../services/payment');

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
  
  const totalUsers = database.users.filter(u => u.status !== 'deleted').length;
  const dailyActive = database.users.filter(u => u.lastLoginAt && u.lastLoginAt >= todayStart).length;
  const totalBottles = database.bottles.filter(b => !b.deleted).length;
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
  
  // Recent users
  const recentUsers = database.users
    .filter(u => u.status !== 'deleted')
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
      totalUsers, dailyActive, totalBottles, totalSessions,
      totalRecharged, totalCoinsInCirculation,
      pendingReports, pendingOrders, pendingSupport, penalizedAccounts
    },
    recentUsers,
    recentReports
  });
});

// User management - list
router.get('/users', adminAuth, (req, res) => {
  const { search, status, page = 1, pageSize = 20 } = req.query;
  let users = db().users.filter(u => u.status !== 'deleted');
  
  if (search) {
    const q = search.toLowerCase();
    users = users.filter(u =>
      (u.nickname && u.nickname.toLowerCase().includes(q)) ||
      u.phone.includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.id.includes(q)
    );
  }
  if (status && status !== 'all') {
    users = users.filter(u => u.status === status);
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
  
  res.json({
    success: true,
    user: {
      ...user,
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
  
  res.json({ success: true, report });
});

// Config - get
router.get('/config', adminAuth, (req, res) => {
  res.json({ success: true, config: db().config });
});

// Config - update
router.post('/config', adminAuth, (req, res) => {
  const updates = req.body;
  const oldConfig = { ...db().config };
  Object.assign(db().config, updates);
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

module.exports = router;
