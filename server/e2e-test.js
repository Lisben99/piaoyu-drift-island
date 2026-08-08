const http = require('http');

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch(e) { resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  let pass = 0, fail = 0;
  function check(name, condition) {
    if (condition) { pass++; console.log('  PASS: ' + name); }
    else { fail++; console.log('  FAIL: ' + name + ' [status=' + arguments[2] + ']'); }
  }

  // Use a fresh phone number to avoid stale checkin state
  const phone1 = '139' + String(Date.now()).slice(-8);
  const phone2 = '138' + String(Date.now()).slice(-8);

  // 1. SMS Send
  console.log('\n=== SMS Verification ===');
  let r = await api('POST', '/api/auth/sms/send', { phone: phone1 });
  check('SMS send returns success', r.status === 200 && r.data.success);
  const devCode = r.data.devCode;
  check('Dev code returned', !!devCode);
  
  // 2. Login
  r = await api('POST', '/api/auth/login', { phone: phone1, code: devCode });
  check('Login returns token', r.status === 200 && !!r.data.token);
  const token1 = r.data.token;
  const userId1 = r.data.user.id;
  check('New user gets 20 coins', r.data.user.coins === 20);
  
  // 3. Set role
  r = await api('POST', '/api/auth/role', { role: 'male' }, token1);
  check('Set role to male', r.status === 200 && r.data.user.role === 'male');
  
  // 4. Get profile
  r = await api('GET', '/api/auth/me', null, token1);
  check('Get current user', r.status === 200 && r.data.id === userId1);
  
  // 5. Create bottle
  r = await api('POST', '/api/bottles', { content: 'Hello World!', tag: 'daily' }, token1);
  check('Create bottle succeeds', r.status === 200 && r.data.success !== false);
  const bottleId = r.data.bottle ? r.data.bottle.id : null;
  check('Bottle has ID', !!bottleId);
  
  // 6. Check balance after bottle
  r = await api('GET', '/api/coins/balance', null, token1);
  check('Balance is 18 after bottle (20-2)', r.data.balance === 18);
  
  // 7. My bottles (status=displaying, not active)
  r = await api('GET', '/api/bottles/my/list?status=displaying', null, token1);
  check('My bottles list has 1 bottle', r.status === 200 && r.data.bottles.length >= 1);
  
  // 8. Second user (female)
  console.log('\n=== Second User & Chat ===');
  r = await api('POST', '/api/auth/sms/send', { phone: phone2 });
  r = await api('POST', '/api/auth/login', { phone: phone2, code: r.data.devCode });
  const token2 = r.data.token;
  const userId2 = r.data.user.id;
  check('User 2 login', r.status === 200);
  await api('POST', '/api/auth/role', { role: 'female' }, token2);
  
  // 9. List bottles
  r = await api('POST', '/api/bottles', { content: 'Hi from female user', tag: 'mood' }, token2);
  r = await api('GET', '/api/bottles', null, token2);
  check('Bottle lobby has bottles', r.data.bottles.length >= 1);
  
  // 10. Start chat session
  r = await api('POST', '/api/chat/start', { targetUserId: userId1, firstMessage: 'Hello!' }, token2);
  check('Start chat session', r.status === 200 && r.data.success);
  const sessionId = r.data.session ? r.data.session.id : null;
  check('Chat session created', !!sessionId);
  // User2: 20 (bonus) - 2 (bottle) - 1 (chat) = 17
  check('Chat cost 1 coin (balance=17)', r.data.coins === 17);
  
  // 11. Get sessions
  r = await api('GET', '/api/chat/sessions', null, token2);
  check('Get chat sessions', r.status === 200 && r.data.sessions.length >= 1);
  
  // 12. Get messages
  r = await api('GET', '/api/chat/sessions/' + sessionId + '/messages', null, token2);
  check('Get chat messages', r.status === 200 && r.data.messages.length >= 1);
  
  // 13. Request permanent chat
  r = await api('POST', '/api/chat/sessions/' + sessionId + '/request-permanent', {}, token2);
  check('Request permanent chat', r.status === 200 && r.data.success);
  // User2: 17 - 2 (permanent) = 15
  check('Permanent chat cost 2 coins (balance=15)', r.data.coins === 15);
  
  // 14. Accept permanent chat (as user1)
  r = await api('POST', '/api/chat/sessions/' + sessionId + '/respond-permanent', { accept: true }, token1);
  check('Accept permanent chat', r.status === 200 && r.data.success);
  
  // 15. Daily checkin (user1)
  console.log('\n=== Coins & Checkin ===');
  r = await api('POST', '/api/coins/checkin', {}, token1);
  check('Daily checkin succeeds', r.status === 200 && r.data.success);
  check('Checkin bonus received (coins > 18)', r.data.coins > 18);
  
  // 16. Checkin again (should fail with success=false)
  r = await api('POST', '/api/coins/checkin', {}, token1);
  check('Double checkin rejected', r.data.success === false);
  
  // 17. Coin transactions
  r = await api('GET', '/api/coins/transactions', null, token1);
  check('Transaction history has entries', r.status === 200 && r.data.transactions.length >= 3);
  
  // 18. Recharge
  console.log('\n=== Recharge ===');
  r = await api('GET', '/api/recharge/packages', null, token1);
  check('Get 4 recharge packages', r.status === 200 && r.data.packages.length === 4);
  
  r = await api('POST', '/api/recharge/order', { packageId: 'pkg1' }, token1);
  check('Create recharge order', r.status === 200 && r.data.success && r.data.orderId);
  const orderId = r.data.orderId;
  
  r = await api('POST', '/api/recharge/order/' + orderId + '/confirm', {}, token1);
  check('Confirm payment', r.status === 200 && r.data.success);
  check('Coins credited (10 coins added)', r.data.balance >= 28);
  
  // 19. Invite
  console.log('\n=== Invite ===');
  r = await api('GET', '/api/invite/info', null, token1);
  check('Get invite info', r.status === 200 && r.data.inviteCode);
  check('Monthly invite limit exists', r.data.monthlyLimit !== undefined);
  
  // 20. Profile
  console.log('\n=== Profile ===');
  r = await api('POST', '/api/profile/edit', { nickname: 'TestUser1', bio: 'Hello bio' }, token1);
  check('Edit profile', r.status === 200 && r.data.profile.nickname === 'TestUser1');
  
  r = await api('GET', '/api/profile/' + userId1, null, token1);
  check('Get public profile', r.status === 200);
  
  // 21. Report
  console.log('\n=== Report ===');
  r = await api('POST', '/api/reports', { targetUserId: userId2, reason: 'spam', description: 'Testing' }, token1);
  check('Create report', r.status === 200);
  
  // 22. Blacklist
  console.log('\n=== Blacklist ===');
  r = await api('POST', '/api/blacklist/block', { targetUserId: userId2 }, token1);
  check('Block user', r.status === 200);
  
  r = await api('GET', '/api/blacklist', null, token1);
  check('Get blacklist', r.status === 200 && r.data.blacklist.length >= 1);
  
  r = await api('POST', '/api/blacklist/unblock', { targetUserId: userId2 }, token1);
  check('Unblock user', r.status === 200);
  
  // 23. Admin
  console.log('\n=== Admin ===');
  r = await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  check('Admin login', r.status === 200 && r.data.token);
  const adminToken = r.data.token;
  
  r = await api('GET', '/api/admin/dashboard', null, adminToken);
  check('Admin dashboard', r.status === 200 && r.data.stats);
  check('Dashboard has user count', r.data.stats.totalUsers !== undefined);
  
  r = await api('GET', '/api/admin/users?page=1&limit=10', null, adminToken);
  check('Admin user list', r.status === 200 && r.data.users.length >= 2);
  
  r = await api('GET', '/api/admin/users/' + userId1, null, adminToken);
  check('Admin user detail', r.status === 200);
  
  r = await api('GET', '/api/admin/bottles?page=1&limit=10', null, adminToken);
  check('Admin bottle list', r.status === 200);
  
  r = await api('GET', '/api/admin/coins/stats', null, adminToken);
  check('Admin coin stats', r.status === 200);
  
  r = await api('GET', '/api/admin/orders?page=1&limit=10', null, adminToken);
  check('Admin order list', r.status === 200);
  
  r = await api('GET', '/api/admin/reports?page=1&limit=10', null, adminToken);
  check('Admin report list', r.status === 200);
  
  r = await api('GET', '/api/admin/config', null, adminToken);
  check('Admin config', r.status === 200 && r.data.config);
  
  r = await api('GET', '/api/admin/audit?page=1&limit=10', null, adminToken);
  check('Admin audit log', r.status === 200);
  
  // 24. Admin penalize user
  r = await api('POST', '/api/admin/users/' + userId2 + '/penalize', { action: 'restrict_publish' }, adminToken);
  check('Admin penalize user', r.status === 200);
  
  r = await api('POST', '/api/admin/users/' + userId2 + '/penalize', { action: 'restore' }, adminToken);
  check('Admin restore user', r.status === 200);
  
  // 25. Security tests
  console.log('\n=== Security ===');
  r = await api('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
  check('Admin wrong password rejected', r.status === 401);
  
  r = await api('GET', '/api/auth/me');
  check('Unauthenticated request rejected', r.status === 401);
  
  r = await api('GET', '/api/admin/dashboard');
  check('Admin route without token rejected', r.status === 401);
  
  r = await api('GET', '/api/admin/dashboard', null, token1);
  check('User token cannot access admin', r.status === 401);
  
  // Summary
  console.log('\n=== Results: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
