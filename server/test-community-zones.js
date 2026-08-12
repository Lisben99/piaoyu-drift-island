const assert = require('node:assert/strict');
const fs = require('node:fs');
fs.writeFileSync = () => {};

const database = require('./src/db');
const zones = require('./src/services/communityZones');
const cache = database.db();
for (const key of [
  'users', 'moments', 'coinTransactions', 'experienceEvents', 'notifications', 'follows',
  'interactions', 'blacklist', 'contentDismissals', 'feedExposures', 'communityZoneProfiles',
  'communityZonePasses', 'moodCheckins'
]) cache[key] = [];
cache.config = { ...database.DEFAULT_CONFIG, community_zone_day_cost: 20, community_zone_week_cost: 50 };

const female = database.createUser('13800008881', '', 'secret1');
female.gender = 'female'; female.experienceBase = 20; female.coins = 100;
const male = database.createUser('13800008882', '', 'secret1');
male.gender = 'male'; male.experienceBase = 20; male.coins = 100;

let status = zones.getZoneStatus(female, 'letter');
assert.equal(status.level, 2);
assert.equal(status.profileComplete, false);
assert.equal(status.accessActive, false);

const letterProfile = {
  alias: '潮汐', tags: ['Switch', '新手'], experience: 'new', boundary: '拒绝线下邀约',
  purpose: '边界交流', adultConfirmed: true, rulesAccepted: true, allowStrangerChat: true
};
assert.equal(zones.saveZoneProfile(female, 'letter', letterProfile).success, true);
assert.equal(zones.saveZoneProfile(male, 'letter', { ...letterProfile, alias: '海岸' }).success, true);
const originalLetterProfileId = zones.profileFor(female.id, 'letter').id;
assert.equal(zones.saveZoneProfile(female, 'letter', { ...letterProfile, alias: '潮汐已更新' }).success, true);
assert.equal(zones.profileFor(female.id, 'letter').id, originalLetterProfileId, 'editing keeps the original profile id');
assert.equal(zones.profileFor(female.id, 'letter').alias, '潮汐已更新');

const femalePurchase = zones.purchaseZoneAccess(female, 'letter', 'day', 1000000);
const malePurchase = zones.purchaseZoneAccess(male, 'letter', 'day', 1000000);
assert.equal(femalePurchase.success, true);
assert.equal(malePurchase.success, true);
assert.equal(femalePurchase.pass.cost, 20, 'all genders use the same day price');
assert.equal(malePurchase.pass.cost, 20, 'all genders use the same day price');
assert.equal(female.coins, 80);
assert.equal(male.coins, 80);
assert.equal(zones.getZoneStatus(female, 'letter', 1000001).accessActive, true);

const matureProfile = {
  alias: '海岛姐姐', ageRange: '31-40', relationshipStatus: 'single', purpose: '认真交流',
  interests: ['旅行', '阅读'], adultConfirmed: true, rulesAccepted: true, allowStrangerChat: true
};
assert.equal(zones.saveZoneProfile(female, 'mature', matureProfile).success, true);
assert.equal(zones.saveZoneProfile(male, 'mature', { ...matureProfile, alias: '月亮上的人', ageRange: '25-30' }).success, true);
assert.equal(zones.purchaseZoneAccess(female, 'mature', 'day', 1000000).success, true);
assert.equal(zones.purchaseZoneAccess(male, 'mature', 'day', 1000000).success, true);
const matureMembers = zones.listMatureMembers(female, {}, 1000001);
assert.equal(matureMembers.success, true);
assert.equal(matureMembers.members.length, 1);
assert.equal(matureMembers.members[0].alias, '月亮上的人');
assert.equal(zones.listMatureMembers(female, { gender: 'female' }, 1000001).members.length, 0);

const moodOne = zones.checkinMood(female, 'calm', '', 1723334400000);
const moodTwo = zones.checkinMood(female, 'happy', '', 1723334401000);
assert.equal(moodOne.success, true);
assert.equal(moodTwo.success, true);
assert.equal(cache.moodCheckins.length, 1, 'one mood record per user per day');
assert.equal(cache.moodCheckins[0].mood, 'happy');

database.createMoment(female.id, { content: '普通广场内容', type: 'community' });
database.createMoment(female.id, { content: '字母圈内容', type: 'community', zoneId: 'letter' });
database.createMoment(female.id, { content: '剧情岛内容', type: 'community', zoneId: 'story' });
assert.equal(database.listMoments({ community: true, viewerId: male.id, sort: 'latest' }).items.length, 1, 'main feed excludes zone posts');
assert.equal(database.listMoments({ community: true, viewerId: male.id, zoneId: 'letter', sort: 'latest' }).items.length, 1);
assert.equal(database.listMoments({ community: true, viewerId: male.id, zoneId: 'story', sort: 'latest' }).items.length, 1);
assert.equal(zones.canAccessZone(male, 'story'), true, 'story island is free');

console.log('community zone tests passed');
