// 集成测试：忘记密码（邮箱 + 手机号）全流程
// 运行：在 server 目录下 `BASE=http://localhost:3001/api node test-reset.js`（需先起本地 dev 服务）
const BASE = process.env.BASE || 'http://localhost:3000/api';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) { console.log('[ok] server is up'); return; }
    } catch (e) {}
    await wait(500);
  }
  throw new Error('server did not start in time');
}

(async () => {
  await waitHealth();
  const oldPwd = 'old123456';
  const newPwd = 'new123456';
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name} ${extra || ''}`); }
  };

  // ============ EMAIL PATH ============
  console.log('\n[EMAIL]');
  const email = 'reset.test.' + Date.now() + '@example.com';
  let s = await post('/auth/email/send', { email });
  check('email/send (register) 发码', s.success, JSON.stringify(s));
  let r = await post('/auth/register', { type: 'email', email, code: s.devCode, password: oldPwd, role: 'male' });
  check('register 注册成功', r.success, r.error || '');

  // 登录发码与重置发码用途独立限频，可连续发送
  s = await post('/auth/reset/send', { type: 'email', email });
  check('reset/send 发码', s.success, s.error || '');
  const devCode = s.devCode;

  let bad = await post('/auth/reset/confirm', { type: 'email', email, code: '000000', password: newPwd });
  check('reset/confirm 错误验证码应失败', !bad.success, bad.error || '');

  r = await post('/auth/reset/confirm', { type: 'email', email, code: devCode, password: newPwd });
  check('reset/confirm 正确验证码重置成功', r.success, r.error || '');

  r = await post('/auth/login', { account: email, password: newPwd });
  check('login 用新密码登录成功', r.success, r.error || '');

  r = await post('/auth/login', { account: email, password: oldPwd });
  check('login 用旧密码应失败', !r.success, r.error || '');

  let unreg = await post('/auth/reset/send', { type: 'email', email: 'nobody' + Date.now() + '@example.com' });
  check('reset/send 未注册邮箱应失败', !unreg.success, unreg.error || '');

  // ============ PHONE PATH ============
  console.log('\n[PHONE]');
  const phone = '138' + String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 8);
  s = await post('/auth/sms/send', { phone });
  check('sms/send (register) 发码', s.success, JSON.stringify(s));
  r = await post('/auth/register', { type: 'phone', phone, code: s.devCode, password: oldPwd, role: 'female' });
  check('register 注册成功', r.success, r.error || '');

  s = await post('/auth/reset/send', { type: 'phone', phone });
  check('reset/send 发码', s.success, s.error || '');
  r = await post('/auth/reset/confirm', { type: 'phone', phone, code: s.devCode, password: newPwd });
  check('reset/confirm 重置成功', r.success, r.error || '');
  r = await post('/auth/login', { account: phone, password: newPwd });
  check('login 用新密码登录成功', r.success, r.error || '');

  console.log(`\n=== 结果：通过 ${pass}，失败 ${fail} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e.message); process.exit(1); });
