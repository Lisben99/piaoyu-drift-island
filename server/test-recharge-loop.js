/**
 * End-to-end test for the "收款 → 提交凭证 → 管理员确认 → 发币" closed loop.
 * Boots the real server (file-mode DB) and exercises the full HTTP flow.
 */
process.env.PORT = process.env.PORT || '3098';
const BASE = 'http://localhost:' + process.env.PORT + '/api';

// Start from a clean DB so each run is isolated (avoids cross-run pollution)
const fs = require('fs');
const path = require('path');
try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'db.json')); } catch (e) {}

require('./src/index');
const { db } = require('./src/db');
const { signAdminToken } = require('./src/utils/jwt');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('server did not start');
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, data: await res.json() };
}

async function main() {
  const health = await waitForHealth();
  console.log('[health] ok, redeem_provider =', health.redeem_provider);

  const admin = db().admins[0];
  const adminToken = signAdminToken(admin);
  const A = { Authorization: 'Bearer ' + adminToken };

  // --- Configure operator payment QR via admin config ---
  let cfg = await api('/admin/config', { method: 'POST', headers: A, body: { paymentQR: 'data:image/png;base64,TESTQR', paymentQRNote: '微信扫码付款，备注填手机号' } });
  if (!cfg.data.success) throw new Error('config save failed: ' + JSON.stringify(cfg.data));
  console.log('[config] paymentQR saved');

  // --- Public packages now expose paymentQR + note ---
  let pkgs = await api('/recharge/packages');
  if (!pkgs.data.paymentQR) throw new Error('packages missing paymentQR');
  if (pkgs.data.paymentQRNote !== '微信扫码付款，备注填手机号') throw new Error('packages missing paymentQRNote');
  console.log('[packages] exposes paymentQR + note');

  // --- Register + login a user via dev SMS ---
  const phone = '13800000123';
  let sms = await api('/auth/sms/send', { method: 'POST', body: { phone } });
  const devCode = sms.data.devCode;
  let login = await api('/auth/login', { method: 'POST', body: { phone, code: devCode } });
  const userToken = login.data.token;
  const startCoins = login.data.user.coins;
  const U = { Authorization: 'Bearer ' + userToken };
  console.log('[user] logged in, start coins =', startCoins);
  const bal = async () => (await api('/coins/balance', { headers: U })).data.balance;
  console.log('[dbg] balance after login =', await bal());

  // --- User creates a recharge order (pkg2 => 55 coins) ---
  let ord = await api('/recharge/order', { method: 'POST', headers: U, body: { packageId: 'pkg2' } });
  if (!ord.data.success) throw new Error('create order failed: ' + JSON.stringify(ord.data));
  const orderId = ord.data.orderId;
  console.log('[order] created', orderId, 'coins =', ord.data.payment && ord.data.payment.coins);

  // --- User self-confirm must be blocked (no merchant callback) ---
  let selfConfirm = await api('/recharge/order/' + orderId + '/confirm', { method: 'POST', headers: U, body: {} });
  if (selfConfirm.data.success) throw new Error('user self-confirm should be blocked');
  console.log('[guard] user self-confirm blocked:', selfConfirm.data.error);

  // --- User submits payment proof ---
  let pay = await api('/recharge/order/' + orderId + '/pay', { method: 'POST', headers: U, body: { note: '转账备注13800000123', image: 'data:image/jpeg;base64,PROOF' } });
  if (!pay.data.success || pay.data.status !== 'submitted') throw new Error('submit proof failed: ' + JSON.stringify(pay.data));
  console.log('[pay] proof submitted, status =', pay.data.status);
  console.log('[dbg] balance after pay =', await bal());

  // --- Admin sees the submitted order with proof ---
  let list = await api('/admin/orders?status=submitted', { headers: A });
  const found = list.data.orders.find(o => o.id === orderId);
  if (!found) throw new Error('submitted order not visible to admin');
  if (found.payProof.note !== '转账备注13800000123') throw new Error('payProof note missing');
  if (!found.payProof.image) throw new Error('payProof image missing');
  console.log('[admin] sees submitted order with proof');
  console.log('[dbg] balance before admin confirm =', await bal());

  // --- Admin confirms -> coins credited ---
  let conf = await api('/admin/orders/' + orderId + '/confirm', { method: 'POST', headers: A, body: {} });
  if (!conf.data.success) throw new Error('admin confirm failed: ' + JSON.stringify(conf.data));
  if (conf.data.coins !== 55) throw new Error('expected 55 coins, got ' + conf.data.coins);
  console.log('[admin] confirmed, +' + conf.data.coins + ' coins, balance =', conf.data.balance);

  // --- Re-query user balance ---
  let me = await api('/recharge/orders', { headers: U });
  const myOrder = me.data.orders.find(o => o.id === orderId);
  if (myOrder.status !== 'paid') throw new Error('order should be paid, got ' + myOrder.status);
  console.log('[user] order status =', myOrder.status, '| coins delta =', login.data.user.coins);

  // --- Reject flow ---
  let ord2 = await api('/recharge/order', { method: 'POST', headers: U, body: { packageId: 'pkg1' } });
  const orderId2 = ord2.data.orderId;
  await api('/recharge/order/' + orderId2 + '/pay', { method: 'POST', headers: U, body: { note: 'nope' } });
  let rej = await api('/admin/orders/' + orderId2 + '/reject', { method: 'POST', headers: A, body: { reason: '未收到付款' } });
  if (!rej.data.success) throw new Error('reject failed: ' + JSON.stringify(rej.data));
  let me2 = await api('/recharge/orders', { headers: U });
  const myOrder2 = me2.data.orders.find(o => o.id === orderId2);
  if (myOrder2.status !== 'rejected') throw new Error('order should be rejected, got ' + myOrder2.status);
  console.log('[admin] rejected order, status =', myOrder2.status);

  // --- Balance sanity: only the confirmed 55 coins added (use server-returned balance) ---
  if (conf.data.balance !== startCoins + 55) throw new Error('final balance mismatch: ' + conf.data.balance + ' vs ' + (startCoins + 55));
  console.log('[balance] final =', conf.data.balance, '(start', startCoins, '+ 55 confirmed)');

  console.log('\n✅ ALL RECHARGE-LOOP E2E TESTS PASSED');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ TEST FAILED:', e.message); process.exit(1); });
