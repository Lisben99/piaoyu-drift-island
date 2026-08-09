/**
 * Recharge routes: packages, create order, confirm payment, order history
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save } = require('../db');
const { PACKAGES, createOrder, confirmPayment, submitPaymentProof, refundOrder, getTotalCoins } = require('../services/payment');

// List packages + operator payment QR (public; used by the recharge page)
router.get('/packages', (req, res) => {
  const cfg = db().config;
  res.json({
    success: true,
    packages: PACKAGES,
    rate: cfg.recharge_rate,
    paymentQR: cfg.paymentQR || '',
    paymentQRNote: cfg.paymentQRNote || ''
  });
});

// Create order
router.post('/order', auth, async (req, res) => {
  const { packageId } = req.body;
  const result = await createOrder(req.user.id, packageId);
  res.json(result);
});

// User claims they paid: attach proof, order -> 'submitted' (awaiting admin confirm)
router.post('/order/:id/pay', auth, async (req, res) => {
  const { note, image } = req.body || {};
  const result = await submitPaymentProof(req.user.id, req.params.id, { note, image });
  res.json(result);
});

// Payment confirmation is admin-only (no merchant callback available for personal accounts).
// The user-facing confirm endpoint is disabled to prevent self-crediting.
router.post('/order/:id/confirm', auth, (req, res) => {
  res.json({ success: false, error: '支付需由管理员确认，请先在「我已支付」中提交凭证，等待管理员核实到账。' });
});

// My orders
router.get('/orders', auth, (req, res) => {
  const orders = db().rechargeOrders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, orders });
});

module.exports = router;
