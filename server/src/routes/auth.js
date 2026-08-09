/**
 * Auth routes: SMS send/verify, login, logout
 */
const express = require('express');
const router = express.Router();
const { sendVerificationCode, verifyCode } = require('../services/sms');
const { sendVerificationCode: sendEmailVerificationCode, verifyCode: verifyEmailCode } = require('../services/email');
const { signUserToken } = require('../utils/jwt');
const { findUserByPhone, findUserByEmail, createUser, setUserPassword, verifyPassword, db, save } = require('../db');

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

// Send SMS verification code
router.post('/sms/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '请输入正确的手机号' });
  }
  const result = await sendVerificationCode(phone);
  res.json(result);
});

// Send email verification code
router.post('/email/send', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ success: false, error: '请输入正确的邮箱地址' });
  }
  const result = await sendEmailVerificationCode(email);
  res.json(result);
});

// Register with phone+code OR email+code, then set a password.
// Verification code proves ownership of the phone/email; password enables future password login.
router.post('/register', async (req, res) => {
  const { type, phone, email, code, password } = req.body;

  if (type !== 'phone' && type !== 'email') {
    return res.json({ success: false, error: '注册方式不正确' });
  }
  if (!code) {
    return res.json({ success: false, error: '请输入验证码' });
  }
  if (!password || password.length < 6) {
    return res.json({ success: false, error: '密码至少 6 位' });
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
    return res.json({ success: false, error: '该账号已注册，请直接登录' });
  }

  const user = createUser(type === 'phone' ? phone : null, type === 'email' ? email : null, password);
  user.lastLoginAt = Date.now();
  save();

  const token = signUserToken(user);
  res.json({ success: true, token, user: publicUser(user) });
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
  } else {
    if (!phone || !code) {
      return res.json({ success: false, error: '请输入手机号和验证码' });
    }
    verifyResult = await verifyCode(phone, code);
    if (!verifyResult.success) return res.json(verifyResult);
    user = findUserByPhone(phone);
    if (!user) user = createUser(phone, null);
  }

  user.lastLoginAt = Date.now();
  save();

  const token = signUserToken(user);
  res.json({ success: true, token, user: publicUser(user) });
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
    totalInvited: user.totalInvited
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
  
  user.role = role;
  user.gender = role;
  save();
  
  res.json({ success: true, user: { role: user.role, gender: user.gender } });
});

module.exports = router;
