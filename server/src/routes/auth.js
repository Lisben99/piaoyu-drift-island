/**
 * Auth routes: SMS send/verify, login, logout
 */
const express = require('express');
const router = express.Router();
const { sendVerificationCode, verifyCode } = require('../services/sms');
const { sendVerificationCode: sendEmailVerificationCode, verifyCode: verifyEmailCode } = require('../services/email');
const { signUserToken } = require('../utils/jwt');
const { findUserByPhone, findUserByEmail, createUser, reactivateUser, setUserPassword, verifyPassword, db, save } = require('../db');
const { applyInvite } = require('../services/invite');

// Shape the user object returned to clients (avoids leaking passwordHash)
function publicUser(user) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    nickname: user.nickname,
    avatar: user.avatar,
    gender: user.gender,
    role: user.role,
    coins: user.coins,
    bio: user.bio,
    status: user.status,
    isNewUser: !user.nickname
  };
}

/* ----------------------------------------------------------------
   验证码发送防刷（纵深防御第二层；服务层已有 60 秒/号的发送间隔）
   - 单 IP 在窗口内最多 _IP_MAX 次：防止脚本批量刷不同号码耗光短信/邮件额度
   - 单联系方式单日最多 _DAILY_MAX 次：防止对同一号长期骚扰式发送
   ---------------------------------------------------------------- */
const _IP_WINDOW_MS = 60 * 1000;
const _IP_MAX = 15;
const _DAILY_MAX = 20;
const _sendIpWindow = new Map(); // ip -> { count, ts }
const _sendDaily = new Map();    // `${target}:${yyyymmdd}` -> count

function _clientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.ip || (req.connection && req.connection.remoteAddress) || 'unknown');
}

function _todayStr() { return new Date().toISOString().slice(0, 10); }

// 返回 null 表示放行；返回字符串表示拦截原因
function _checkSendAbuse(req, target) {
  const ip = _clientIp(req);
  const now = Date.now();
  const w = _sendIpWindow.get(ip) || { count: 0, ts: now };
  if (now - w.ts > _IP_WINDOW_MS) { w.count = 0; w.ts = now; }
  w.count += 1;
  _sendIpWindow.set(ip, w);
  if (w.count > _IP_MAX) return '操作过于频繁，请稍后再试';

  const dk = target + ':' + _todayStr();
  const dc = (_sendDaily.get(dk) || 0) + 1;
  if (dc > _DAILY_MAX) return '今日验证码发送次数已达上限，请明天再试';
  _sendDaily.set(dk, dc);
  return null;
}

// 每小时清理一次过期的每日计数，避免内存无限增长
setInterval(() => {
  const today = _todayStr();
  for (const k of _sendDaily.keys()) {
    if (!k.endsWith(':' + today)) _sendDaily.delete(k);
  }
}, 60 * 60 * 1000).unref();

// Send SMS verification code
router.post('/sms/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '请输入正确的手机号' });
  }
  const blocked = _checkSendAbuse(req, phone);
  if (blocked) return res.json({ success: false, error: blocked });
  const result = await sendVerificationCode(phone, 'login');
  res.json(result);
});

// Send email verification code
router.post('/email/send', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ success: false, error: '请输入正确的邮箱地址' });
  }
  const blocked = _checkSendAbuse(req, email);
  if (blocked) return res.json({ success: false, error: blocked });
  const result = await sendEmailVerificationCode(email, 'login');
  res.json(result);
});

// Register with phone+code OR email+code, then set a password.
// Verification code proves ownership of the phone/email; password enables future password login.
router.post('/register', async (req, res) => {
  const { type, phone, email, code, password, role, inviteCode } = req.body;

  if (type !== 'phone' && type !== 'email') {
    return res.json({ success: false, error: '注册方式不正确' });
  }
  if (!code) {
    return res.json({ success: false, error: '请输入验证码' });
  }
  if (!password || password.length < 6) {
    return res.json({ success: false, error: '密码至少 6 位' });
  }
  if (!['male', 'female'].includes(role)) {
    return res.json({ success: false, error: '请选择性别' });
  }

  let verifyResult;
  if (type === 'email') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, error: '请输入正确的邮箱地址' });
    }
    verifyResult = await verifyEmailCode(email, code);
  } else {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: '请输入正确的手机号' });
    }
    verifyResult = await verifyCode(phone, code);
  }
  if (!verifyResult.success) return res.json(verifyResult);

  const existing = type === 'email' ? findUserByEmail(email) : findUserByPhone(phone);
  if (existing) {
    if (existing.status === 'deleted') {
      // 注销账号可重新注册：复用该记录并重置为全新账号（不重复发放注册奖励）
      const user = reactivateUser(existing, {
        phone: type === 'phone' ? phone : null,
        email: type === 'email' ? email : null,
        password,
        role
      });
      const token = signUserToken(user);
      return res.json({ success: true, token, user: publicUser(user), reactivated: true });
    }
    return res.json({ success: false, error: '该账号已注册，请直接登录' });
  }

  const user = createUser(type === 'phone' ? phone : null, type === 'email' ? email : null, password);
  user.role = role;
  user.gender = role;
  user.lastLoginAt = Date.now();
  save();

  // Apply invite reward if a valid invite code was provided (binds relationship + grants both parties coins)
  const inviteInfo = applyInvite(user, inviteCode);

  const token = signUserToken(user);
  res.json({ success: true, token, user: publicUser(user), invite: inviteInfo });
});

// Login: either (account + password) or (phone|email + code).
// Code login auto-creates the account on first verify (legacy behavior, no password set).
router.post('/login', async (req, res) => {
  const { phone, email, code, account, password } = req.body;

  // ---- Password login ----
  if (password) {
    if (!account) {
      return res.json({ success: false, error: '请输入账号' });
    }
    const user = findUserByPhone(account) || findUserByEmail(account);
    if (!user) {
      return res.json({ success: false, error: '账号不存在，请先注册' });
    }
    if (user.status === 'deleted') {
      return res.json({ success: false, error: '账号已注销，请使用验证码重新注册', deleted: true });
    }
    if (!verifyPassword(user, password)) {
      // Distinguish "no password set" from "wrong password" for clearer UX
      if (!user.passwordHash) {
        return res.json({ success: false, error: '该账号未设置密码，请使用验证码登录' });
      }
      return res.json({ success: false, error: '密码错误' });
    }
    user.lastLoginAt = Date.now();
    save();
    return res.json({ success: true, token: signUserToken(user), user: publicUser(user) });
  }

  // ---- Code login (phone or email) ----
  let verifyResult;
  let user;

  if (email) {
    if (!code) {
      return res.json({ success: false, error: '请输入邮箱和验证码' });
    }
    verifyResult = await verifyEmailCode(email, code);
    if (!verifyResult.success) return res.json(verifyResult);
    user = findUserByEmail(email);
    if (!user) user = createUser(null, email);
    else if (user.status === 'deleted') reactivateUser(user, { email });
  } else {
    if (!phone || !code) {
      return res.json({ success: false, error: '请输入手机号和验证码' });
    }
    verifyResult = await verifyCode(phone, code);
    if (!verifyResult.success) return res.json(verifyResult);
    user = findUserByPhone(phone);
    if (!user) user = createUser(phone, null);
    else if (user.status === 'deleted') reactivateUser(user, { phone });
  }

  user.lastLoginAt = Date.now();
  save();

  const token = signUserToken(user);
  res.json({ success: true, token, user: publicUser(user) });
});

// Forgot password: send a verification code to email/phone (account must already exist)
router.post('/reset/send', async (req, res) => {
  const { type, phone, email } = req.body;
  if (type !== 'phone' && type !== 'email') {
    return res.json({ success: false, error: '找回方式不正确' });
  }
  if (type === 'email') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, error: '请输入正确的邮箱地址' });
    }
    const user = findUserByEmail(email);
    if (!user) return res.json({ success: false, error: '该邮箱未注册，请先注册' });
    const result = await sendEmailVerificationCode(email, 'reset');
    return res.json(result);
  }
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '请输入正确的手机号' });
  }
  const user = findUserByPhone(phone);
  if (!user) return res.json({ success: false, error: '该手机号未注册，请先注册' });
  const result = await sendVerificationCode(phone, 'reset');
  return res.json(result);
});

// Forgot password: verify the code and set a new password
router.post('/reset/confirm', async (req, res) => {
  const { type, phone, email, code, password } = req.body;
  if (type !== 'phone' && type !== 'email') {
    return res.json({ success: false, error: '找回方式不正确' });
  }
  if (!code) {
    return res.json({ success: false, error: '请输入验证码' });
  }
  if (!password || password.length < 6) {
    return res.json({ success: false, error: '新密码至少 6 位' });
  }
  let user, verifyResult;
  if (type === 'email') {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, error: '请输入正确的邮箱地址' });
    }
    user = findUserByEmail(email);
    if (!user) return res.json({ success: false, error: '该邮箱未注册，请先注册' });
    verifyResult = await verifyEmailCode(email, code);
  } else {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.json({ success: false, error: '请输入正确的手机号' });
    }
    user = findUserByPhone(phone);
    if (!user) return res.json({ success: false, error: '该手机号未注册，请先注册' });
    verifyResult = await verifyCode(phone, code);
  }
  if (!verifyResult.success) return res.json(verifyResult);

  setUserPassword(user.id, password);
  res.json({ success: true });
});

// Get current user info
router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const { verifyToken } = require('../utils/jwt');
  const decoded = verifyToken(authHeader.substring(7));
  if (!decoded) return res.status(401).json({ error: '登录已过期' });
  
  const user = findUserByPhone(decoded.phone) || db().users.find(u => u.id === decoded.id);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  if (user.status === 'deleted') return res.status(401).json({ error: '账号已注销，请重新注册', deleted: true });
  
  res.json({
    id: user.id,
    phone: user.phone,
    email: user.email,
    nickname: user.nickname,
    avatar: user.avatar,
    gender: user.gender,
    role: user.role,
    coins: user.coins,
    bio: user.bio,
    status: user.status,
    inviteCode: user.inviteCode,
    checkin: user.checkin,
    totalRecharged: user.totalRecharged,
    totalInvited: user.totalInvited,
    locationEnabled: !!user.locationEnabled
  });
});

// Set role (gender)
router.post('/role', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const { verifyToken } = require('../utils/jwt');
  const decoded = verifyToken(authHeader.substring(7));
  if (!decoded) return res.status(401).json({ error: '登录已过期' });
  
  const user = db().users.find(u => u.id === decoded.id);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  
  const { role } = req.body;
  if (!['male', 'female'].includes(role)) {
    return res.json({ success: false, error: '请选择角色' });
  }
  // 性别一经设置永久绑定，不可修改（注册时已选，或验证码登录用户仅首次引导可选）
  if (user.role) {
    return res.json({ success: false, error: '性别已设置，不可修改' });
  }
  user.role = role;
  user.gender = role;
  save();
  
  res.json({ success: true, user: { role: user.role, gender: user.gender } });
});

module.exports = router;
