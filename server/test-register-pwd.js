/**
 * Test: register (phone/email + code → set password) and account+password login.
 * Boots the real server (file-mode DB). Dev mode returns devCode, no real SMS/email.
 */
process.env.PORT = process.env.PORT || '3098';
const BASE = 'http://localhost:' + process.env.PORT + '/api';

const fs = require('fs');
const path = require('path');
try { fs.unlinkSync(path.join(__dirname, '..', 'data', 'db.json')); } catch (e) {}

require('./src/index');
const { db } = require('./src/db');

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

async function sendCode(endpoint, field, value) {
  const body = {}; body[field] = value;
  const r = await api(endpoint, { method: 'POST', body });
  if (!r.data.success) throw new Error('send failed: ' + JSON.stringify(r.data));
  return r.data.devCode;
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function main() {
  const health = await waitForHealth();
  console.log('[health] email_provider =', health.email_provider, '| sms_provider =', health.sms_provider);

  // ===== 1. Email register with password =====
  const email = 'reg_' + Date.now() + '@example.com';
  const pw = 'secret123';
  const eCode = await sendCode('/auth/email/send', 'email', email);
  let reg = await api('/auth/register', { method: 'POST', body: { type: 'email', email, code: eCode, password: pw } });
  assert(reg.data.success, 'email register failed: ' + JSON.stringify(reg.data));
  assert(reg.data.token, 'register should return token');
  assert(reg.data.user.email === email, 'register response email mismatch');
  // passwordHash persisted
  const eUser = db().users.find(u => u.email === email);
  assert(eUser && eUser.passwordHash && eUser.passwordHash.length > 10, 'passwordHash not stored');
  console.log('[1] email register + password stored ✓');

  // ===== 2. Password login (correct) =====
  let pl = await api('/auth/login', { method: 'POST', body: { account: email, password: pw } });
  assert(pl.data.success, 'password login failed: ' + JSON.stringify(pl.data));
  assert(pl.data.token, 'password login should return token');
  console.log('[2] password login (correct) ✓');

  // ===== 3. Password login (wrong password) =====
  let wp = await api('/auth/login', { method: 'POST', body: { account: email, password: 'wrongpw' } });
  assert(!wp.data.success && wp.data.error === '密码错误', 'wrong password should be rejected: ' + JSON.stringify(wp.data));
  console.log('[3] password login (wrong password) rejected ✓');

  // ===== 4. Password login (nonexistent account) =====
  let na = await api('/auth/login', { method: 'POST', body: { account: 'nobody@example.com', password: 'x' } });
  assert(!na.data.success && na.data.error === '账号不存在，请先注册', 'nonexistent account should be rejected: ' + JSON.stringify(na.data));
  console.log('[4] nonexistent account rejected ✓');

  // ===== 5. Re-register same email (must wait out the 60s send cooldown) =====
  await sleep(61000);
  const eCode2 = await sendCode('/auth/email/send', 'email', email);
  let dup = await api('/auth/register', { method: 'POST', body: { type: 'email', email, code: eCode2, password: pw } });
  assert(!dup.data.success && dup.data.error === '该账号已注册，请直接登录', 'duplicate register should be rejected: ' + JSON.stringify(dup.data));
  console.log('[5] duplicate register rejected ✓');

  // ===== 6. Short password rejected at register =====
  const email2 = 'short_' + Date.now() + '@example.com';
  const sCode = await sendCode('/auth/email/send', 'email', email2);
  let short = await api('/auth/register', { method: 'POST', body: { type: 'email', email: email2, code: sCode, password: '123' } });
  assert(!short.data.success, 'short password should be rejected: ' + JSON.stringify(short.data));
  console.log('[6] short password (<6) rejected at register ✓');

  // ===== 7. Phone register + password login =====
  const phone = '1390000' + String(Math.floor(Math.random() * 9000) + 1000);
  const pCode = await sendCode('/auth/sms/send', 'phone', phone);
  let preg = await api('/auth/register', { method: 'POST', body: { type: 'phone', phone, code: pCode, password: pw } });
  assert(preg.data.success && preg.data.user.phone === phone, 'phone register failed: ' + JSON.stringify(preg.data));
  let ppl = await api('/auth/login', { method: 'POST', body: { account: phone, password: pw } });
  assert(ppl.data.success, 'phone password login failed: ' + JSON.stringify(ppl.data));
  console.log('[7] phone register + password login ✓');

  // ===== 8. Code-only user (no password) cannot password-login =====
  const email3 = 'codeonly_' + Date.now() + '@example.com';
  const cCode = await sendCode('/auth/email/send', 'email', email3);
  let cl = await api('/auth/login', { method: 'POST', body: { email: email3, code: cCode } }); // auto-create, no password
  assert(cl.data.success, 'code login failed: ' + JSON.stringify(cl.data));
  let noPw = await api('/auth/login', { method: 'POST', body: { account: email3, password: 'anypw' } });
  assert(!noPw.data.success && noPw.data.error === '该账号未设置密码，请使用验证码登录', 'no-password account should be rejected: ' + JSON.stringify(noPw.data));
  console.log('[8] code-only account rejected from password login ✓');

  console.log('\n✅ ALL REGISTER + PASSWORD-LOGIN TESTS PASSED');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ TEST FAILED:', e.message); process.exit(1); });
