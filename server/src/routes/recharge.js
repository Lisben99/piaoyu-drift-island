/**
 * Recharge routes: packages, create order, confirm payment, order history
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save } = require('../db');
const { PACKAGES, createOrder, confirmPayment, refundOrder, getTotalCoins } = require('../services/payment');

// List packages
router.get('/packages', (req, res) => {
  res.json({ success: true, packages: PACKAGES, rate: db().config.recharge_rate });
});

// Create order
router.post('/order', auth, async (req, res) => {
  const { packageId } = req.body;
  const result = await createOrder(req.user.id, packageId);
  res.json(result);
});

// Confirm payment (dev mode) / check payment status (production)
router.post('/order/:id/confirm', auth, async (req, res) => {
  const result = await confirmPayment(req.params.id, req.body.paymentData || {});
  res.json(result);
});

// My orders
router.get('/orders', auth, (req, res) => {
  const orders = db().rechargeOrders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, orders });
});

module.exports = router;
