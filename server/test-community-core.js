const assert = require('node:assert/strict');
const fs = require('node:fs');

fs.writeFileSync = () => {};

const catalog = require('./src/communityCatalog');
const db = require('./src/db');

assert.ok(catalog.COMMUNITY_INTERESTS.length >= 10, 'interest catalog');
assert.ok(catalog.COMMUNITY_MOODS.some(item => item.id === 'calm'), 'mood catalog');
assert.equal(catalog.getTodayPrompt(new Date('2026-08-11T04:00:00Z').getTime()).dateKey, '2026-08-11');

const cache = db.db();
cache.users = []; cache.moments = []; cache.follows = []; cache.interactions = [];
cache.contentDismissals = []; cache.feedExposures = []; cache.experienceEvents = [];
const user = db.createUser('13900000001', '', '');
user.interestIds = ['music'];
const moment = db.createMoment(user.id, {
  content: 'hello', type: 'community', topicId: 'music', mood: 'calm', dailyPromptId: 'prompt-1'
});
assert.equal(moment.topicId, 'music');
assert.equal(moment.mood, 'calm');
assert.equal(moment.dailyPromptId, 'prompt-1');
assert.equal(db.listMoments({ community: true, viewerId: user.id, topicId: 'music' }).items.length, 1);
assert.equal(db.listMoments({ community: true, viewerId: user.id, topicId: 'travel' }).items.length, 0);

const now = Date.now();
const musicAuthor = db.createUser('13900000002', '', ''); musicAuthor.nickname = 'music';
const travelAuthor = db.createUser('13900000003', '', ''); travelAuthor.nickname = 'travel';
const inactiveAuthor = db.createUser('13900000004', '', ''); inactiveAuthor.status = 'banned';
const recent = db.createMoment(travelAuthor.id, { content: 'new', type: 'community', topicId: 'travel' });
recent.createdAt = now - 2 * 60 * 60 * 1000;
const recommended = db.createMoment(musicAuthor.id, { content: 'matched', type: 'community', topicId: 'music' });
recommended.createdAt = now - 2 * 86400000;
recommended.likes = ['a', 'b', 'c'];
const repeatedAuthor = db.createMoment(musicAuthor.id, { content: 'same author', type: 'community', topicId: 'music' });
repeatedAuthor.createdAt = now - 3 * 86400000;
const exploration = db.createMoment(travelAuthor.id, { content: 'explore', type: 'community', topicId: 'travel' });
exploration.createdAt = now - 4 * 86400000;
const selfOld = db.createMoment(user.id, { content: 'self', type: 'community', topicId: 'music' });
selfOld.createdAt = now - 2 * 86400000;
const inactivePost = db.createMoment(inactiveAuthor.id, { content: 'banned', type: 'community', topicId: 'music' });
inactivePost.createdAt = now - 2 * 86400000;

const latest = db.listMoments({ community: true, viewerId: user.id, sort: 'latest', now }).items;
const recommend = db.listMoments({ community: true, viewerId: user.id, sort: 'recommend', now, feedSessionId: 'session-a' }).items;
assert.ok(latest.some(item => item.id === recent.id), 'latest includes recent content');
assert.ok(!latest.some(item => item.id === recommended.id), 'latest excludes recommendation-age content');
assert.ok(recommend.some(item => item.id === recommended.id), 'recommend includes interest-matched older content');
assert.ok(!recommend.some(item => item.id === recent.id), 'recommend never repeats the latest pool');
assert.ok(!recommend.some(item => item.userId === user.id), 'recommend excludes the viewer');
assert.ok(!recommend.some(item => item.userId === inactiveAuthor.id), 'recommend excludes inactive authors');
assert.equal(recommend.filter(item => item.userId === musicAuthor.id).length, 1, 'one author appears at most once per recommendation block');
assert.equal(recommend[0].id, recommended.id, 'interest and quality place the matched content first');

db.recordFeedExposures(user.id, recommend.map(item => item.id), { feed: 'recommend', sessionId: 'session-a', now });
const sameSession = db.listMoments({ community: true, viewerId: user.id, sort: 'recommend', now, feedSessionId: 'session-a' }).items;
const newSession = db.listMoments({ community: true, viewerId: user.id, sort: 'recommend', now, feedSessionId: 'session-b' }).items;
assert.ok(sameSession.some(item => item.id === recommended.id), 'pagination in one session remains stable');
assert.ok(!newSession.some(item => item.id === recommended.id), 'a new session hides content seen within 24 hours');

console.log('community core assertions passed');
