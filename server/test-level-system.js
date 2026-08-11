const assert = require('assert');
const fs = require('fs');

// Keep this integration-style unit test entirely in memory.
fs.writeFileSync = () => {};

const levelDb = require('./src/db');
const cache = levelDb.db();

cache.users = [];
cache.moments = [];
cache.bottles = [];
cache.chatSessions = [];
cache.experienceEvents = [];

const baseNow = Date.parse('2026-08-11T02:00:00.000Z');
const nextDay = baseNow + 24 * 60 * 60 * 1000;

const fresh = levelDb.createUser('13800009001', '', 'secret1');
assert.equal(levelDb.computeUserLevel(fresh).exp, 0, 'new users start with zero experience');
assert.equal(levelDb.computeUserLevel(fresh).level, 1, 'new users start at level one');

const first = levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b1',
  sourceId: 'b1',
  now: baseNow
});
assert.equal(first.awarded, 2, 'first bottle awards two experience');
assert.equal(levelDb.computeUserLevel(fresh).exp, 2, 'awarded experience is reflected in level summary');

const duplicate = levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b1',
  sourceId: 'b1',
  now: baseNow + 1000
});
assert.equal(duplicate.awarded, 0, 'a retried business event is idempotent');
assert.equal(duplicate.reason, 'duplicate', 'duplicate result explains why no experience was added');

assert.equal(levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b2', sourceId: 'b2', now: baseNow + 2000
}).awarded, 2);
assert.equal(levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b3', sourceId: 'b3', now: baseNow + 3000
}).awarded, 2);
const capped = levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b4', sourceId: 'b4', now: baseNow + 4000
});
assert.equal(capped.awarded, 0, 'the fourth same-day bottle is capped');
assert.equal(capped.reason, 'daily_limit');
assert.equal(levelDb.awardExperience(fresh.id, 'bottle_created', {
  eventKey: 'bottle:b5', sourceId: 'b5', now: nextDay
}).awarded, 2, 'the daily cap resets on the next China calendar day');

const levelUp = levelDb.awardExperience(fresh.id, 'streak_bonus', {
  eventKey: 'streak:20', sourceId: '20', points: 20, now: nextDay + 1000
});
assert.equal(levelUp.leveledUp, true, 'crossing a threshold reports an upgrade');
assert.equal(levelDb.computeUserLevel(fresh).level, 2, 'twenty cumulative experience reaches at least level two');

const maxed = levelDb.awardExperience(fresh.id, 'streak_bonus', {
  eventKey: 'streak:max', sourceId: 'max', points: 2000, now: nextDay + 2000
});
assert.equal(maxed.level.level, 10, 'experience above the final threshold remains level ten');
assert.equal(maxed.level.progress, 100, 'max level progress is complete');
assert.equal(maxed.level.nextExp, null, 'max level has no next threshold');

const history = levelDb.getExperienceHistory(fresh.id, 3);
assert.equal(history.length, 3, 'history honors its limit');
assert.ok(history[0].createdAt >= history[1].createdAt, 'history is newest first');
assert.ok(history.every(item => item.userId === fresh.id), 'history never leaks another user');

const legacy = levelDb.createUser('13800009002', '', 'secret2');
delete legacy.experienceBase;
delete legacy.experienceMigratedAt;
levelDb.createMoment(legacy.id, { content: 'legacy one' });
levelDb.createMoment(legacy.id, { content: 'legacy two' });
levelDb.migrateExperienceSystem();
const legacyBase = levelDb.computeUserLevel(legacy).exp;
assert.ok(legacyBase >= 20, 'legacy contribution score becomes a one-time baseline');
levelDb.createMoment(legacy.id, { content: 'after migration without an award event' });
levelDb.migrateExperienceSystem();
assert.equal(levelDb.computeUserLevel(legacy).exp, legacyBase, 'legacy baseline stays frozen after migration');

assert.throws(
  () => levelDb.awardExperience(fresh.id, 'unknown_rule', { eventKey: 'bad:1', now: baseNow }),
  /experience rule/i,
  'unknown experience rules are rejected'
);

console.log('level system core: all assertions passed');
