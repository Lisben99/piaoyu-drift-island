/**
 * End-to-end route test for the second-phase social features.
 * Mounts the real routers on a throwaway Express app with the auth middleware
 * stubbed to inject a test user, then drives them over HTTP with fetch.
 * Disk writes are stubbed so the real db.json is never touched.
 *
 * Run:  node server/test-social-server.js
 */
const fs = require('fs');
fs.writeFileSync = () => {};

const express = require('express');
const db = require('./src/db');
const { signUserToken } = require('./src/utils/jwt');

// Reset in-memory collections for a clean run.
const cache = db.db();
cache.users = []; cache.follows = []; cache.visits = [];
cache.interactions = []; cache.moments = []; cache.bottles = [];
cache.chatSessions = [];

const u1 = db.createUser('13800000001', '', ''); u1.nickname = 'Alice';
const u2 = db.createUser('13800000002', '', ''); u2.nickname = 'Bob';
const u3 = db.createUser('13800000003', '', ''); u3.nickname = 'Carol';
const TOKEN = signUserToken(u1);

// Stub auth BEFORE requiring the routers so their `const { auth } = require(...)` picks up the stub.
const authMod = require('./src/middleware/auth');
authMod.auth = (req, res, next) => { req.user = u1; next(); };
authMod.adminAuth = (req, res, next) => { req.admin = { id: 'admin-001' }; next(); };

const app = express();
app.use(express.json());
app.use('/api/follow', require('./src/routes/follow'));
app.use('/api/visits', require('./src/routes/visits'));
app.use('/api/interactions', require('./src/routes/interactions'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/moments', require('./src/routes/moments'));
app.use('/api/admin', require('./src/routes/admin'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } }

const server = app.listen(0);
const BASE = 'http://localhost:' + server.address().port;
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, json: await res.json() };
};

(async () => {
  console.log('\n[HTTP] 关注 / 访客 / 互动 / 等级 / 认证');

  // Profile of u2 as seen by u1 (should include level + follow counts, not following yet)
  let p = await call('GET', '/api/profile/' + u2.id);
  ok(p.json.success && p.json.profile.level >= 1, 'profile 含等级字段: Lv' + (p.json.profile && p.json.profile.level));
  ok(p.json.profile.following === false, 'profile.following=false (未关注)');
  ok(p.json.profile.followerCount === 0, 'profile.followerCount=0');

  // Follow toggle
  let f = await call('POST', '/api/follow/' + u2.id);
  ok(f.json.success && f.json.following === true, 'POST /api/follow/:id 关注成功');
  ok(f.json.followerCount === 1, '返回 followerCount=1');

  p = await call('GET', '/api/profile/' + u2.id);
  ok(p.json.profile.following === true, '关注后 profile.following=true');

  // Unfollow
  f = await call('POST', '/api/follow/' + u2.id);
  ok(f.json.following === false, '再次 POST 取消关注');

  // Following feed: only followed authors appear and card state is hydrated.
  db.createMoment(u2.id, { content: 'Bob community post', images: [], type: 'community' });
  db.createMoment(u3.id, { content: 'Carol community post', images: [], type: 'community' });
  await call('POST', '/api/follow/' + u2.id);
  const followingFeed = await call('GET', '/api/moments/community?sort=following');
  ok(followingFeed.json.success && followingFeed.json.moments.length === 1,
    '我关注的只返回已关注用户的动态');
  ok(followingFeed.json.moments[0].author.id === u2.id && followingFeed.json.moments[0].author.following === true,
    '关注动态携带正确的 author.following 状态');
  await call('POST', '/api/follow/' + u2.id);

  // Visits: seed a visit (u2 visits u1) then read u1's own visitors
  db.recordVisit(u2.id, u1.id);
  let v = await call('GET', '/api/visits/me');
  ok(v.json.success && v.json.visitors.length === 1, 'GET /api/visits/me 返回 1 个访客');
  ok(v.json.visitors[0].nickname === 'Bob', '访客是 Bob');
  let vOther = await call('GET', '/api/visits/me'); // sanity
  ok(vOther.json.visitCount === 1, 'visitCount=1');

  // Interactions: u2 follows u1 -> u1 receives a 'follow' interaction
  db.toggleFollow(u2.id, u1.id);
  let ix = await call('GET', '/api/interactions');
  ok(ix.json.success && ix.json.interactions.some(i => i.type === 'follow' && i.actorId === u2.id), 'GET /api/interactions 含 follow 互动');
  ok(ix.json.unreadCount >= 1, 'unreadCount>=1');
  let rd = await call('POST', '/api/interactions/read');
  ok(rd.json.unreadCount === 0, 'POST /api/interactions/read 后 unreadCount=0');

  // Moments user page includes level + verified + follow info
  let mu = await call('GET', '/api/moments/user/' + u2.id);
  ok(mu.json.success && typeof mu.json.user.level === 'number', 'moments/user 含 level');
  ok(mu.json.user.followerCount === 0, 'moments/user followerCount=0 (u1 取消关注)');

  // Admin verify
  let vf = await call('POST', '/api/admin/users/' + u2.id + '/verify', { verified: true, verifiedType: 'official' });
  ok(vf.json.success && vf.json.verified === true && vf.json.verifiedType === 'official', 'admin 设置官方认证');
  p = await call('GET', '/api/profile/' + u2.id);
  ok(p.json.profile.verified === true && p.json.profile.verifiedType === 'official', 'profile 反映认证徽章');

  // 404s
  let nf = await call('GET', '/api/profile/nope');
  ok(nf.json.success === false, '不存在用户返回 success=false');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
  await new Promise(resolve => server.close(resolve));
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(e => {
  console.error('FATAL', e);
  server.close();
  process.exitCode = 1;
});
