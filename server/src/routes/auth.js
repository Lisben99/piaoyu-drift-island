/**
 * Auth routes: SMS send/verify, login, logout
 */
const express = require('express');
const router = express.Router();
const { sendVerificationCode, verifyCode } = require('../services/sms');
const { sendVerificationCode: sendEmailVerificationCode, verifyCode: verifyEmailCode } = require('../services/email');
const { signUserToken } = require('../utils/jwt');
const { findUserByPhone, findUserByEmail, createUser, db, save } = require('../db');

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

// Login with phone+code OR email+code (auto-create account on first verify)
router.post('/login', async (req, res) => {
  const { phone, email, code } = req.body;

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

  // Update last login
  user.lastLoginAt = Date.now();
  save();

  const token = signUserToken(user);

  res.json({
    success: true,
    token,
    user: {
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
    }
  });
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
