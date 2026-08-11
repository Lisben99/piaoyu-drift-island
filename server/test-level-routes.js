const assert = require('assert');
const fs = require('fs');

fs.writeFileSync = () => {};

const express = require('express');
const levelDb = require('./src/db');
const { signUserToken } = require('./src/utils/jwt');

const cache = levelDb.db();
cache.users = [];
cache.moments = [];
cache.bottles = [];
cache.chatSessions = [];
cache.reports = [];
cache.experienceEvents = [];

const alice = levelDb.createUser('13800009101', '', 'secret1');
alice.nickname = 'Alice';
const token = signUserToken(alice);

const authModule = require('./src/middleware/auth');
authModule.auth = (req, res, next) => { req.user = alice; next(); };
authModule.adminAuth = (req, res, next) => { req.admin = { id: 'admin-001' }; next(); };

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/moments', require('./src/routes/moments'));
app.use('/api/coins', require('./src/routes/coins'));
app.use('/api/bottles', require('./src/routes/bottles'));
app.use('/api/reports', require('./src/routes/report'));
app.use('/api/admin', require('./src/routes/admin'));
app.use((req, res) => res.status(404).json({ error: 'not found' }));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

(async () => {
  const meBefore = await call('GET', '/api/auth/me');
  assert.equal(meBefore.json.level, 1, 'auth/me uses the server level summary');
  assert.equal(meBefore.json.exp, 0, 'auth/me starts a new user at zero experience');

  const created = await call('POST', '/api/moments', { content: '第一条社区动态', type: 'community' });
  assert.equal(created.json.success, true);
  assert.equal(created.json.experienceAward.awarded, 3, 'creating a moment awards three experience');

  const detail = await call('GET', '/api/profile/level/me');
  assert.equal(detail.json.success, true, 'level detail endpoint exists');
  assert.equal(detail.json.level.exp, 3, 'level detail reflects route awards');
  assert.equal(detail.json.tiers.length, 10, 'level detail exposes all ten public tiers');
  assert.ok(detail.json.rules.some(rule => rule.type === 'moment_created'), 'level detail exposes public earning rules');
  assert.equal(detail.json.history[0].type, 'moment_created', 'level detail includes recent experience history');

  const checkin = await call('POST', '/api/coins/checkin');
  assert.equal(checkin.json.success, true);
  assert.equal(checkin.json.experienceAward.awarded, 2, 'daily check-in awards experience');

  const checkinAgain = await call('POST', '/api/coins/checkin');
  assert.equal(checkinAgain.json.success, false, 'duplicate check-in keeps the existing business behavior');
  assert.equal(levelDb.computeUserLevel(alice).exp, 5, 'a duplicate check-in does not add experience');

  alice.account_type = 'BOT'; // Skip delayed bot scheduling in this route test.
  const bottle = await call('POST', '/api/bottles', { content: '测试漂流瓶', anonymous: false });
  assert.equal(bottle.json.experienceAward.awarded, 2, 'creating a bottle awards two experience');
  alice.account_type = 'HUMAN';

  const bob = levelDb.createUser('13800009102', '', 'secret2');
  bob.nickname = 'Bob';
  const bobBottle = {
    id: levelDb.genId('bottle'), content: 'Bob bottle', authorId: bob.id,
    authorGender: '', anonymous: false, status: 'displaying', deleted: false,
    replies: [], createdAt: Date.now()
  };
  cache.bottles.push(bobBottle);
  const reply = await call('POST', `/api/bottles/${bobBottle.id}/reply`, { content: '有效回复' });
  assert.equal(reply.json.experienceAward.awarded, 3, 'replying to a bottle awards three experience');

  const commentedMoment = levelDb.createMoment(bob.id, { content: 'Bob post', type: 'community' });
  const comment = await call('POST', `/api/moments/${commentedMoment.id}/comment`, { content: '有效评论' });
  assert.equal(comment.json.experienceAward.awarded, 1, 'commenting awards one experience');
  const like = await call('POST', `/api/moments/${commentedMoment.id}/like`);
  assert.equal(like.json.liked, true);
  assert.equal(levelDb.computeUserLevel(bob).exp, 1, 'the post author receives one experience for a like');
  await call('POST', `/api/moments/${commentedMoment.id}/like`);
  await call('POST', `/api/moments/${commentedMoment.id}/like`);
  assert.equal(levelDb.computeUserLevel(bob).exp, 1, 'unlike then re-like cannot award twice');

  const profile = await call('POST', '/api/profile/edit', {
    nickname: 'Alice', bio: '已经完善资料', avatar: 'data:image/png;base64,AA=='
  });
  assert.equal(profile.json.experienceAward.awarded, 10, 'completing all profile fields awards ten experience once');
  const profileAgain = await call('POST', '/api/profile/edit', { bio: '再次保存' });
  assert.equal(profileAgain.json.experienceAward.awarded, 0, 'saving a complete profile again is idempotent');

  const report = await call('POST', '/api/reports', {
    targetType: 'user', targetId: bob.id, reason: '广告引流', description: '测试举报'
  });
  assert.equal(report.json.success, true);
  const handled = await call('POST', `/api/admin/reports/${report.json.report.id}/handle`, {
    result: 'resolved', note: '确认有效'
  });
  assert.equal(handled.json.experienceAward.awarded, 2, 'an accepted report awards its reporter');

  const publicProfile = await call('GET', `/api/profile/${alice.id}`);
  const detailAfter = await call('GET', '/api/profile/level/me');
  assert.equal(publicProfile.json.profile.exp, levelDb.computeUserLevel(alice).exp, 'public profile uses the same experience summary');
  assert.equal(publicProfile.json.profile.level, detailAfter.json.level.level, 'public and detail levels agree');

  console.log('level routes: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
