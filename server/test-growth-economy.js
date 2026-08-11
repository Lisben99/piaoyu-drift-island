const assert = require('node:assert/strict');
const fs = require('node:fs');
fs.writeFileSync = () => {};

const database = require('./src/db');
const economy = require('./src/services/growthEconomy');
const cache = database.db();
cache.users = [];
cache.coinTransactions = [];
cache.experienceEvents = [];
cache.notifications = [];
cache.config = { ...database.DEFAULT_CONFIG };

const user = database.createUser('13800007771', '', 'secret1');
assert.equal(user.coins, 20, 'new user receives the growth registration grant');

let benefits = economy.getBenefits(user);
assert.equal(benefits.dailyCheckinCoins, 20);
assert.equal(benefits.remainingFreeChats, 1);
assert.equal(benefits.remainingFreeBottles, 1);

const freeChat = economy.consumeGrowthAction(user, 'chat', 'user-b');
assert.equal(freeChat.success, true);
assert.equal(freeChat.free, true);
assert.equal(user.coins, 20);

const paidChat = economy.consumeGrowthAction(user, 'chat', 'user-c');
assert.equal(paidChat.free, false);
assert.equal(paidChat.charged, 1);
assert.equal(user.coins, 19);

const firstPost = economy.awardGrowthActivity(user.id, 'community_post', 'moment-1');
assert.equal(firstPost.reduce((sum, tx) => sum + tx.amount, 0), 25, 'first community post combines newcomer and daily rewards');
assert.equal(economy.awardGrowthActivity(user.id, 'community_post', 'moment-1').length, 0, 'retrying the same event is idempotent');
assert.equal(economy.awardGrowthActivity(user.id, 'community_post', 'moment-2').reduce((sum, tx) => sum + tx.amount, 0), 5);
assert.equal(economy.awardGrowthActivity(user.id, 'community_post', 'moment-3').length, 0, 'daily activity cap prevents farming');

user.experienceBase = 220;
benefits = economy.getBenefits(user);
assert.equal(benefits.level, 5);
assert.equal(benefits.dailyCheckinCoins, 30);
assert.equal(benefits.freeChats, 3);
assert.equal(benefits.freeBottles, 2);

const levelingUser = database.createUser('13800007772', '', 'secret1');
const beforeCoins = levelingUser.coins;
const award = database.awardExperience(levelingUser.id, 'streak_bonus', {
  eventKey: 'growth-level-2',
  points: 20
});
assert.equal(award.level.level, 2);
assert.equal(levelingUser.coins, beforeCoins + 20, 'level two automatically grants its configured coin reward');

console.log('growth economy tests passed');
