/**
 * JWT utilities
 */
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'drift-island-secret-key-change-in-production';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (e) {
    return null;
  }
}

function signUserToken(user) {
  return signToken({ id: user.id, phone: user.phone, type: 'user' });
}

function signAdminToken(admin) {
  return signToken({ id: admin.id, username: admin.username, type: 'admin' });
}

module.exports = { signToken, verifyToken, signUserToken, signAdminToken };
