/**
 * Redeem-code (卡密充值) routes.
 *
 * Admin router  -> mounted at /api/admin (requires adminAuth)
 * User router   -> mounted at /api/redeem (requires user auth)
 */
const express = require('express');
const { adminAuth } = require('../middleware/auth');
const { auth } = require('../middleware/auth');
const { db, addAuditLog } = require('../db');
const { generateCodes, redeemCode, listCodes } = require('../services/redeem');

// ===== Admin router =====
const admin = express.Router();

// Generate a batch of redeem codes
admin.post('/redeem-codes/generate', adminAuth, (req, res) => {
  const { coins, count, prefix, note } = req.body;
  const result = generateCodes({ coins, count, prefix, note, createdBy: req.admin.id });
  if (!result.success) {
    return res.json(result);
  }
  addAuditLog(req.admin.id, 'redeem_generate', result.batch, `生成卡密 ${result.count} 张，每张 ${result.codes[0].coins} 币${note ? '，备注:' + note : ''}`);
  res.json({
    success: true,
    batch: result.batch,
    count: result.count,
    codes: result.codes.map(c => ({ code: c.code, coins: c.coins }))
  });
});

// List redeem codes
admin.get('/redeem-codes', adminAuth, (req, res) => {
  const { status, page, pageSize } = req.query;
  const result = listCodes({ status, page, pageSize });
  res.json(result);
});

// ===== User router =====
const user = express.Router();

// Redeem a code
user.post('/redeem', auth, async (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.json({ success: false, error: '请输入兑换码' });
  }
  const result = redeemCode(req.user.id, code.trim());
  res.json(result);
});

module.exports = { admin, user };
