/**
 * End-to-end test for the card-code (兑换码) recharge feature.
 * Boots the real server (file-mode DB) and exercises the full HTTP flow.
 */
process.env.PORT = process.env.PORT || '3099';
const BASE = 'http://localhost:' + process.env.PORT + '/api';

// Boot the server (side-effect: loads db, mounts routes, starts listening)
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
  console.log('[health] redeem_provider =', health.redeem_provider);
  if (health.redeem_provider !== 'cardcode') throw new Error('redeem_provider not exposed in health');

  // --- Admin token (signed directly; avoids needing the real admin password) ---
  const admin = db().admins[0];
  const adminToken = signAdminToken(admin);

  // --- Mounting / auth guard checks ---
  let g = await api('/admin/redeem-codes/generate', { method: 'POST', body: { coins: 10, count: 1 } });
  if (g.status !== 401) throw new Error('generate without token should be 401, got ' + g.status);
  let u = await api('/redeem/redeem', { method: 'POST', body: { code: 'X' } });
  if (u.status !== 401) throw new Error('redeem without token should be 401, got ' + u.status);
  console.log('[guard] admin + user routes correctly require auth (401)');
  let bad = await api('/admin/redeem-codes/generate', { method: 'POST', headers: { Authorization: 'Bearer garbage' }, body: { coins: 10, count: 1 } });
  if (bad.status !== 401) throw new Error('generate with bad token should be 401, got ' + bad.status);
  console.log('[guard] bad token rejected (401)');

  // --- Generate a batch of codes ---
  g = await api('/admin/redeem-codes/generate', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + adminToken },
    body: { coins: 50, count: 3, prefix: 'TEST', note: 'e2e-test' }
  });
  if (!g.data.success) throw new Error('generate failed: ' + JSON.stringify(g.data));
  if (g.data.count !== 3) throw new Error('expected 3 codes, got ' + g.data.count);
  const [c1, c2] = g.data.codes.map(x => x.code);
  console.log('[generate] created', g.data.count, 'codes, first =', c1);

  // --- List codes (admin) ---
  let list = await api('/admin/redeem-codes', { headers: { Authorization: 'Bearer ' + adminToken } });
  if (!list.data.success || list.data.total < 3) throw new Error('list failed: ' + JSON.stringify(list.data));
  console.log('[list] total codes =', list.data.total);

  // --- Register + login a user via dev SMS ---
  const phone = '13800000099';
  let sms = await api('/auth/sms/send', { method: 'POST', body: { phone } });
  if (!sms.data.success) throw new Error('sms send failed: ' + JSON.stringify(sms.data));
  const devCode = sms.data.devCode;
  let login = await api('/auth/login', { method: 'POST', body: { phone, code: devCode } });
  if (!login.data.success) throw new Error('user login failed: ' + JSON.stringify(login.data));
  const userToken = login.data.token;
  const startCoins = login.data.user.coins;
  console.log('[user] logged in, start coins =', startCoins);

  // --- Redeem code 1 ---
  let r1 = await api('/redeem/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken }, body: { code: c1 } });
  if (!r1.data.success) throw new Error('redeem failed: ' + JSON.stringify(r1.data));
  if (r1.data.coins !== 50) throw new Error('expected 50 coins, got ' + r1.data.coins);
  if (r1.data.balance !== startCoins + 50) throw new Error('balance mismatch: ' + r1.data.balance);
  console.log('[redeem] ok, +' + r1.data.coins + ' coins, balance =', r1.data.balance);

  // --- Duplicate redeem (same code) must fail ---
  let r2 = await api('/redeem/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken }, body: { code: c1 } });
  if (r2.data.success) throw new Error('duplicate redeem should fail');
  console.log('[redeem] duplicate rejected:', r2.data.error);

  // --- Invalid code must fail ---
  let r3 = await api('/redeem/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken }, body: { code: 'ZZZZ-0000-0000-0000' } });
  if (r3.data.success) throw new Error('invalid redeem should fail');
  console.log('[redeem] invalid rejected:', r3.data.error);

  // --- Case / dash / space insensitive redeem (code 2) ---
  const c2messy = c2.toLowerCase().replace(/-/g, ' ');
  let r4 = await api('/redeem/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken }, body: { code: c2messy } });
  if (!r4.data.success) throw new Error('case/space-insensitive redeem failed: ' + JSON.stringify(r4.data));
  console.log('[redeem] case/space-insensitive ok, balance =', r4.data.balance);

  console.log('\n✅ ALL REDEEM E2E TESTS PASSED');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ TEST FAILED:', e.message); process.exit(1); });
