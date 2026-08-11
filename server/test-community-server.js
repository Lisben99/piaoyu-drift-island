const assert = require('node:assert/strict');
const fs = require('node:fs');
fs.writeFileSync = () => {};

const express = require('express');
const db = require('./src/db');
const cache = db.db();
cache.users = []; cache.moments = []; cache.follows = []; cache.interactions = [];
cache.blacklist = []; cache.contentDismissals = []; cache.experienceEvents = [];
const user = db.createUser('13900000002', '', ''); user.nickname = '共鸣测试者';
const other = db.createUser('13900000003', '', ''); other.nickname = '音乐旅人';

const authMod = require('./src/middleware/auth');
authMod.auth = (req, res, next) => { req.user = user; next(); };

const app = express(); app.use(express.json());
app.use('/api/community', require('./src/routes/community'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/moments', require('./src/routes/moments'));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, json: await response.json() };
};

(async () => {
  try {
    const catalog = await call('GET', '/api/community/catalog');
    assert.equal(catalog.status, 200); assert.ok(catalog.json.interests.length >= 10);
    const interests = await call('PATCH', '/api/profile/interests', { interestIds: ['music', 'reading', 'travel'] });
    assert.deepEqual(interests.json.interestIds, ['music', 'reading', 'travel']);
    const policy = await call('PATCH', '/api/profile/chat-policy', { strangerChatPolicy: 'closed' });
    assert.equal(policy.json.strangerChatPolicy, 'closed');
    db.createMoment(other.id, { content: '一首歌的共鸣', type: 'community', topicId: 'music', mood: 'calm' });
    db.createMoment(other.id, { content: 'private hidden', type: 'moment' });
    const feed = await call('GET', '/api/moments/community?sort=recommend&topicId=music');
    assert.equal(feed.json.moments.length, 1); assert.equal(feed.json.moments[0].topicId, 'music');
    assert.equal(feed.json.moments[0].resonanceCount, 0);
    const search = await call('GET', '/api/community/search?q=private');
    assert.equal(search.json.moments.length, 0, 'private moment must not be searchable');
    console.log('community server assertions passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
