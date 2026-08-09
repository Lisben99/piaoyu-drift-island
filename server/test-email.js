/**
 * End-to-end test for the email-verification registration channel + redeem flow.
 * Boots the real server (file-mode DB) and exercises the full HTTP flow in dev mode
 * (no SMTP configured → verification code is returned as devCode, no real email sent).
 */
process.env.PORT = process.env.PORT || '3099';
const BASE = 'http://localhost:' + process.env.PORT + '/api';

// Start from a clean DB so each run is isolated
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
  console.log('[health] ok, email_provider =', health.email_provider, '| sms_provider =', health.sms_provider);
  if (health.email_provider !== 'dev') throw new Error('expected email_provider=dev for this test');

  const admin = db().admins[0];
  const adminToken = signAdminToken(admin);
  const A = { Authorization: 'Bearer ' + adminToken };

  // --- 1. Send email verification code (dev mode → returns devCode) ---
  const email = 'newuser_' + Date.now() + '@example.com';
  let send = await api('/auth/email/send', { method: 'POST', body: { email } });
  if (!send.data.success) throw new Error('email send failed: ' + JSON.stringify(send.data));
  if (!send.data.devCode) throw new Error('dev mode should return devCode');
  const devCode = send.data.devCode;
  console.log('[email] code sent, devCode =', devCode);

  // --- 2. Invalid email rejected ---
  let bad = await api('/auth/email/send', { method: 'POST', body: { email: 'not-an-email' } });
  if (bad.data.success) throw new Error('invalid email should be rejected');
  console.log('[email] invalid email rejected');

  // --- 3. Login with email + code → auto-create account ---
  let login = await api('/auth/login', { method: 'POST', body: { email, code: devCode } });
  if (!login.data.success) throw new Error('email login failed: ' + JSON.stringify(login.data));
  const userToken = login.data.token;
  const user = login.data.user;
  if (user.email !== email) throw new Error('login response missing email');
  if (user.phone) throw new Error('email user should have empty phone');
  if (!user.isNewUser) throw new Error('first login should be new user');
  const startCoins = user.coins;
  const U = { Authorization: 'Bearer ' + userToken };
  console.log('[user] logged in via email, coins =', startCoins, '(new_user_bonus)');

  // --- 4. /auth/me resolves for email user (JWT by id) ---
  let me = await api('/auth/me', { headers: U });
  if (!me.data || me.data.id !== user.id) throw new Error('me endpoint failed for email user');
  if (me.data.email !== email) throw new Error('me missing email');
  console.log('[me] resolves for email user');

  // --- 5. Wrong code rejected ---
  let send2 = await api('/auth/email/send', { method: 'POST', body: { email } });
  let badLogin = await api('/auth/login', { method: 'POST', body: { email, code: '000000' } });
  if (badLogin.data.success) throw new Error('wrong code should be rejected');
  console.log('[auth] wrong code rejected');

  // --- 6. Generate a redeem code via admin, then user redeems it ---
  let gen = await api('/admin/redeem-codes/generate', { method: 'POST', headers: A, body: { coins: 10, count: 1, prefix: 'MAIL', note: 'e2e-email' } });
  if (!gen.data.success || !gen.data.codes || !gen.data.codes[0]) throw new Error('generate redeem code failed: ' + JSON.stringify(gen.data));
  const code = gen.data.codes[0].code;
  console.log('[admin] generated redeem code', code);

  let redeem = await api('/redeem/redeem', { method: 'POST', headers: U, body: { code } });
  if (!redeem.data.success) throw new Error('redeem failed: ' + JSON.stringify(redeem.data));
  if (redeem.data.coins !== 10) throw new Error('expected +10 coins, got ' + redeem.data.coins);
  console.log('[redeem] +10 coins, balance =', redeem.data.balance);

  // --- 7. Balance sanity: new_user_bonus (20) + redeem (10) = 30 ---
  if (redeem.data.balance !== startCoins + 10) throw new Error('balance mismatch: ' + redeem.data.balance + ' vs ' + (startCoins + 10));
  console.log('[balance] final =', redeem.data.balance, '(start', startCoins, '+ 10 redeemed)');

  // --- 8. Phone channel still works (regression guard) ---
  const phone = '13800000987';
  let sms = await api('/auth/sms/send', { method: 'POST', body: { phone } });
  let plogin = await api('/auth/login', { method: 'POST', body: { phone, code: sms.data.devCode } });
  if (!plogin.data.success || plogin.data.user.phone !== phone) throw new Error('phone channel regression');
  console.log('[phone] channel still works (regression ok)');

  console.log('\n✅ ALL EMAIL-REGISTRATION E2E TESTS PASSED');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ TEST FAILED:', e.message); process.exit(1); });
