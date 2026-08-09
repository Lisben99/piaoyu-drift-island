/**
 * WeChat Pay v3 Service
 * 
 * Production flow:
 * 1. Create prepay order via WeChat Pay API
 * 2. Return payment parameters to frontend
 * 3. User completes payment in WeChat
 * 4. WeChat calls our callback URL
 * 5. Verify callback signature
 * 6. Idempotently credit coins to user
 * 
 * To enable production payment:
 * 1. Set PAYMENT_PROVIDER=wechat
 * 2. Set WECHAT_PAY_MCHID, WECHAT_PAY_APPID, WECHAT_PAY_SERIAL, WECHAT_PAY_PRIVATE_KEY, WECHAT_PAY_APIV3
 * 3. Configure callback URL in WeChat Pay merchant dashboard
 * 4. Install wechatpay-axios-plugin or use raw HTTP
 */

const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'dev'; // 'dev' or 'wechat'
const db = require('../db');

const PACKAGES = [
  { id: 'pkg1', price: 1, coins: 10, label: '10枚' },
  { id: 'pkg2', price: 5, coins: 50, coinsBonus: 5, label: '55枚（送5枚）' },
  { id: 'pkg3', price: 10, coins: 100, coinsBonus: 12, label: '112枚（送12枚）' },
  { id: 'pkg4', price: 20, coins: 200, coinsBonus: 30, label: '230枚（送30枚）' }
];

function getPackage(pkgId) {
  return PACKAGES.find(p => p.id === pkgId);
}

function getTotalCoins(pkg) {
  return pkg.coins + (pkg.coinsBonus || 0);
}

async function createOrder(userId, pkgId) {
  const pkg = getPackage(pkgId);
  if (!pkg) {
    return { success: false, error: '无效的充值套餐' };
  }
  
  const order = {
    id: db.genId('order'),
    orderId: db.genId('ord'),
    userId,
    packageId: pkgId,
    amount: pkg.price,
    coins: getTotalCoins(pkg),
    status: 'pending', // pending, paid, failed, refunded
    paymentMethod: PAYMENT_PROVIDER,
    createdAt: Date.now(),
    paidAt: null,
    paymentData: null
  };
  
  db.db().rechargeOrders.push(order);
  db.save();
  
  if (PAYMENT_PROVIDER === 'wechat') {
    // Production: call WeChat Pay API to create prepay order
    // const { createPrepay } = require('./wechat-pay');
    // const prepay = await createPrepay(order);
    // return { success: true, orderId: order.id, payment: prepay };
    
    console.log(`[PAYMENT][WECHAT] Order: ${order.orderId}, Amount: ${pkg.price}元`);
    return { success: true, orderId: order.id, payment: { provider: 'wechat', prepayId: 'placeholder' } };
  } else {
    // Development mode: simulate payment
    console.log(`[PAYMENT][DEV] Order: ${order.orderId}, Amount: ${pkg.price}元, Coins: ${getTotalCoins(pkg)}`);
    return { success: true, orderId: order.id, payment: { provider: 'dev', message: '开发模式：点击确认即可完成支付' } };
  }
}

async function confirmPayment(orderId, paymentData = {}) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) {
    return { success: false, error: '订单不存在' };
  }
  
  // Idempotency check
  if (order.status === 'paid') {
    return { success: false, error: '订单已支付' };
  }
  
  if (PAYMENT_PROVIDER === 'wechat') {
    // Production: verify payment with WeChat Pay API
    // const { verifyPayment } = require('./wechat-pay');
    // const verified = await verifyPayment(order);
    // if (!verified.success) return { success: false, error: '支付验证失败' };
  }
  
  // Mark as paid
  order.status = 'paid';
  order.paidAt = Date.now();
  order.paymentData = paymentData;
  
  // Credit coins (addCoinTransaction already increments user.coins — do not double-add)
  const user = db.findUserById(order.userId);
  if (user) {
    user.totalRecharged = (user.totalRecharged || 0) + order.amount;
    db.addCoinTransaction(user.id, order.coins, 'recharge', `充值${order.amount}元获得${order.coins}枚漂流币`, order.id);
  }
  
  db.save();
  
  return { success: true, coins: order.coins, balance: user ? user.coins : 0 };
}

// User claims they paid: attach proof (note / screenshot) and move order to 'submitted'
// (awaiting admin verification). No coins are credited until the admin confirms.
async function submitPaymentProof(userId, orderId, { note, image } = {}) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.userId !== userId) return { success: false, error: '无权操作该订单' };
  if (order.status === 'paid') return { success: false, error: '订单已支付' };
  if (order.status === 'rejected') return { success: false, error: '订单已被拒绝' };

  // Guard against oversized inline images (keeps the JSON DB small)
  const img = image || '';
  if (img && img.length > 1.5 * 1024 * 1024) {
    return { success: false, error: '截图过大，请压缩后重试' };
  }

  order.status = 'submitted';
  order.payProof = {
    note: (note || '').toString().slice(0, 200),
    image: img,
    submittedAt: Date.now()
  };
  db.save();
  return { success: true, status: order.status };
}

// Admin rejects a submitted/pending order (e.g. payment not received)
async function rejectOrder(orderId, reason) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status === 'paid') return { success: false, error: '订单已支付，无法拒绝' };
  order.status = 'rejected';
  order.rejectReason = (reason || '').toString().slice(0, 200);
  order.rejectedAt = Date.now();
  db.save();
  return { success: true };
}

async function refundOrder(orderId, reason) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) {
    return { success: false, error: '订单不存在' };
  }
  if (order.status !== 'paid') {
    return { success: false, error: '订单状态不支持退款' };
  }
  
  // Refund via WeChat Pay API in production
  // For now, just deduct coins (addCoinTransaction handles the deduction) and mark as refunded
  const user = db.findUserById(order.userId);
  if (user) {
    db.addCoinTransaction(user.id, -order.coins, 'refund', `充值退款：${reason}`, order.id);
  }
  
  order.status = 'refunded';
  db.save();
  
  return { success: true };
}

module.exports = { PACKAGES, getPackage, getTotalCoins, createOrder, confirmPayment, submitPaymentProof, rejectOrder, refundOrder };
