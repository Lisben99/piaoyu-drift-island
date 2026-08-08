/**
 * Auth routes: SMS send/verify, login, logout
 */
const express = require('express');
const router = express.Router();
const { sendVerificationCode, verifyCode } = require('../services/sms');
const { signUserToken } = require('../utils/jwt');
const { findUserByPhone, createUser, db, save } = require('../db');

// Send SMS verification code
router.post('/sms/send', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.json({ success: false, error: '请输入正确的手机号' });
  }
  const result = await sendVerificationCode(phone);
  res.json(result);
});

// Login with phone + code
router.post('/login', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.json({ success: false, error: '请输入手机号和验证码' });
  }
  
  const verifyResult = await verifyCode(phone, code);
  if (!verifyResult.success) {
    return res.json(verifyResult);
  }
  
  // Find or create user
  let user = findUserByPhone(phone);
  if (!user) {
    user = createUser(phone);
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
