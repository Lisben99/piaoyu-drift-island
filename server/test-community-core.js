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
cache.contentDismissals = []; cache.experienceEvents = [];
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

console.log('community core assertions passed');
