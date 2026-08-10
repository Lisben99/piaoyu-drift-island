/**
 * Authentication middleware
 */
const { verifyToken } = require('../utils/jwt');
const { findUserById, db } = require('../db');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded || decoded.type !== 'user') {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  const user = findUserById(decoded.id);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  if (user.status === 'banned') {
    return res.status(403).json({ error: '账号已被封禁' });
  }
  if (user.status === 'frozen') {
    return res.status(403).json({ error: '账号已被冻结' });
  }
  if (user.status === 'deleted') {
    // 返回 401，复用前端自动清 token + 跳登录逻辑，确保注销后无法继续使用
    return res.status(401).json({ error: '账号已注销，请重新注册', deleted: true });
  }
  req.user = user;
  next();
}

function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '管理员未登录' });
  }
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded || decoded.type !== 'admin') {
    return res.status(401).json({ error: '管理员登录已过期' });
  }
  const { findAdminById } = require('../db');
  const admin = findAdminById(decoded.id);
  if (!admin) {
    return res.status(401).json({ error: '管理员不存在' });
  }
  req.admin = admin;
  next();
}

module.exports = { auth, adminAuth };
