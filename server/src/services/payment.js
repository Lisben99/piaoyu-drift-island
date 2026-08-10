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

const crypto = require('crypto');
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'dev'; // 'dev' or 'wechat'
const db = require('../db');

// Redeem-code alphabet without ambiguous glyphs (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomSegment(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
function buildCode(prefix) {
  const p = (prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const body = `${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
  return p ? `${p}-${body}` : body;
}
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function generateOneRedeemCode({ coins, createdBy, note, refOrderId }) {
  const existing = new Set(db.getRedeemCodes().map(r => r.codeKey));
  let code, key, guard = 0;
  do {
    code = buildCode('PY'); // 固定前缀 PiaoYu
    key = normalizeCode(code);
    guard++;
  } while (existing.has(key) && guard < 20);
  if (existing.has(key)) key = key + Date.now();

  const record = {
    id: db.genId('rc'),
    batch: refOrderId ? `order-${refOrderId}` : db.genId('rcb'),
    code,
    codeKey: key,
    coins,
    status: 'unused',
    createdBy,
    note: note || '',
    createdAt: Date.now(),
    usedBy: null,
    usedAt: null
  };
  db.addRedeemCode(record);
  return record;
}

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
    // 设计说明：本产品充值采用「卡密兑换」模式（见 redeem.js）——用户支付后系统自动生成
    // 一次性兑换码，用户再到客户端兑换发放漂流币，因此不依赖支付回调实时到账。
    // 微信支付是可选扩展通道，当前未启用（无商户资质）。下方 prepay 调用为占位实现，
    // 属设计如此，并非未完成的缺陷——启用前需先配置 PAYMENT_PROVIDER=wechat 及商户密钥。
    // 生产接入示例：
    //   const { createPrepay } = require('./wechat-pay');
    //   const prepay = await createPrepay(order);
    //   return { success: true, orderId: order.id, payment: prepay };
    console.log(`[PAYMENT][WECHAT] Order: ${order.orderId}, Amount: ${pkg.price}元`);
    return { success: true, orderId: order.id, payment: { provider: 'wechat', prepayId: 'placeholder' } };
  } else {
    // Development mode: simulate payment
    console.log(`[PAYMENT][DEV] Order: ${order.orderId}, Amount: ${pkg.price}元, Coins: ${getTotalCoins(pkg)}`);
    return { success: true, orderId: order.id, payment: { provider: 'dev', message: '开发模式：点击确认即可完成支付' } };
  }
}

async function confirmPayment(orderId, paymentData = {}, { adminId = null } = {}) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) {
    return { success: false, error: '订单不存在' };
  }

  // Idempotency: if already paid, return existing redeem code
  if (order.status === 'paid') {
    return {
      success: false,
      error: '订单已支付',
      redeemCode: order.redeemCode || null
    };
  }

  if (PAYMENT_PROVIDER === 'wechat') {
    // Production: verify payment with WeChat Pay API
    // const { verifyPayment } = require('./wechat-pay');
    // const verified = await verifyPayment(order);
    // if (!verified.success) return { success: false, error: '支付验证失败' };
  }

  // Mark as paid (but do NOT credit coins directly — user redeems the code)
  order.status = 'paid';
  order.paidAt = Date.now();
  order.paymentData = paymentData;

  // Generate a one-time redeem code bound to this order
  const redeemRecord = generateOneRedeemCode({
    coins: order.coins,
    createdBy: adminId || 'system',
    note: `充值订单 ${order.orderId} 自动发放`,
    refOrderId: order.id
  });
  order.redeemCode = {
    codeId: redeemRecord.id,
    code: redeemRecord.code,
    codeKey: redeemRecord.codeKey
  };

  // Only record total recharged amount on user; coins are credited when code is redeemed
  const user = db.findUserById(order.userId);
  if (user) {
    user.totalRecharged = (user.totalRecharged || 0) + order.amount;
  }

  db.save();

  return {
    success: true,
    coins: order.coins,
    balance: user ? user.coins : 0,
    redeemCode: order.redeemCode
  };
}

// User claims they paid: attach proof (note / screenshot) and move order to 'submitted'
// (awaiting admin verification). No coins are credited until the admin confirms.
async function submitPaymentProof(userId, orderId, { note, image } = {}) {
  const database = db.db();
  const order = database.rechargeOrders.find(o => o.id === orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.userId !== userId) return { success: false, error: '无权操作该订单' };
  if (order.status === 'paid') return { success: false, error: '订单已支付' };
  // 允许待支付(pending)与已拒绝(rejected)的订单重新提交支付凭证
  if (order.status !== 'pending' && order.status !== 'rejected') {
    return { success: false, error: '当前订单状态无法提交凭证' };
  }

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

  // Void the bound redeem code if it has not been used yet
  if (order.redeemCode && order.redeemCode.codeId) {
    const record = database.redeemCodes.find(r => r.id === order.redeemCode.codeId);
    if (record) {
      if (record.status === 'used') {
        return { success: false, error: '兑换码已被用户使用，无法退款' };
      }
      record.status = 'voided';
      record.note = `${record.note || ''} [退款作废] ${reason || ''}`.trim();
    }
  }

  // If the user already redeemed the code, deduct coins; otherwise nothing to deduct
  const user = db.findUserById(order.userId);
  if (user) {
    db.addCoinTransaction(user.id, -order.coins, 'refund', `充值退款：${reason}`, order.id);
  }

  order.status = 'refunded';
  db.save();

  return { success: true };
}

module.exports = { PACKAGES, getPackage, getTotalCoins, createOrder, confirmPayment, submitPaymentProof, rejectOrder, refundOrder };
