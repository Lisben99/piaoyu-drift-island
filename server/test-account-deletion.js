const assert = require('node:assert/strict');
const fs = require('node:fs');
fs.writeFileSync = () => {};

const database = require('./src/db');
const { hasUnresolvedRecharge, purgeUserAccount } = require('./src/services/accountDeletion');

const cache = database.db();
for (const key of [
  'users', 'bottles', 'chatSessions', 'messages', 'coinTransactions', 'rechargeOrders',
  'reports', 'supportTickets', 'auditLogs', 'inviteCodes', 'smsCodes', 'emailCodes',
  'redeemCodes', 'botProfiles', 'blacklist', 'notifications', 'moments', 'follows',
  'visits', 'interactions', 'experienceEvents', 'contentDismissals', 'feedExposures',
  'deletedIdentities'
]) cache[key] = [];
cache.config = { ...database.DEFAULT_CONFIG };

const deleted = database.createUser('13800009991', 'deleted@example.com', 'secret1');
const other = database.createUser('13800009992', 'other@example.com', 'secret1');
const deletedId = deleted.id;
const otherId = other.id;

cache.chatSessions.push({ id: 'chat-1', userA: deletedId, userB: otherId });
cache.messages.push({ id: 'message-1', sessionId: 'chat-1', senderId: otherId, content: 'private' });
cache.bottles.push(
  { id: 'bottle-owned', authorId: deletedId, likes: [], replies: [] },
  { id: 'bottle-other', authorId: otherId, likes: [deletedId], replies: [{ id: 'reply-1', senderId: deletedId }] }
);
cache.moments.push(
  { id: 'moment-owned', userId: deletedId, likes: [], comments: [] },
  {
    id: 'moment-other', userId: otherId, likes: [deletedId],
    comments: [
      { id: 'comment-deleted', userId: deletedId },
      { id: 'comment-reply', userId: otherId, parentCommentId: 'comment-deleted', replyToUserId: deletedId }
    ]
  }
);
cache.follows.push({ followerId: deletedId, followeeId: otherId });
cache.visits.push({ visitorId: deletedId, targetId: otherId });
cache.interactions.push({ actorId: deletedId, targetUserId: otherId });
cache.notifications.push({ id: 'notice-1', userId: otherId, actorId: deletedId });
cache.blacklist.push({ blockerId: otherId, blockedId: deletedId });
cache.experienceEvents.push({ id: 'exp-1', userId: deletedId });
cache.contentDismissals.push({ id: 'dismiss-1', userId: deletedId, momentId: 'moment-other' });
cache.feedExposures.push({ id: 'exposure-1', userId: deletedId, momentId: 'moment-other' });
cache.supportTickets.push({ id: 'ticket-1', userId: deletedId, subject: 'subject', description: 'private', contact: 'phone' });
cache.reports.push({ id: 'report-1', reporterId: deletedId, targetId: otherId, description: 'private' });
cache.rechargeOrders.push({
  id: 'order-paid', userId: deletedId, status: 'paid', payProof: 'secret-proof',
  paymentData: { payer: 'private' }, redeemCode: { codeId: 'code-1', code: 'SECRET' }
});
cache.rechargeOrders.push({ id: 'order-submitted', userId: deletedId, status: 'submitted' });
cache.redeemCodes.push({ id: 'code-1', batch: 'order-order-paid', status: 'unused' });

assert.equal(hasUnresolvedRecharge(deletedId), true, 'submitted recharge blocks account deletion');
cache.rechargeOrders.find(order => order.id === 'order-submitted').status = 'rejected';

const result = purgeUserAccount(deletedId);
assert.equal(result.success, true);
assert.equal(database.findUserById(deletedId), undefined, 'deleted identity no longer authenticates');
assert.equal(cache.chatSessions.length, 0);
assert.equal(cache.messages.length, 0);
assert.equal(cache.bottles.some(item => item.authorId === deletedId), false);
assert.deepEqual(cache.bottles[0].likes, []);
assert.deepEqual(cache.bottles[0].replies, []);
assert.equal(cache.moments.some(item => item.userId === deletedId), false);
assert.deepEqual(cache.moments[0].likes, []);
assert.equal(cache.moments[0].comments.length, 1);
assert.equal(cache.moments[0].comments[0].parentCommentId, null);
assert.equal(cache.moments[0].comments[0].replyToUserId, null);
assert.equal(cache.coinTransactions.some(item => item.userId === deletedId), false);
assert.equal(cache.follows.length, 0);
assert.equal(cache.visits.length, 0);
assert.equal(cache.interactions.length, 0);
assert.equal(cache.notifications.length, 0);
assert.equal(cache.blacklist.length, 0);
assert.equal(cache.experienceEvents.length, 0);
assert.equal(cache.contentDismissals.length, 0);
assert.equal(cache.feedExposures.length, 0);

const paidOrder = cache.rechargeOrders.find(order => order.id === 'order-paid');
assert.notEqual(paidOrder.userId, deletedId, 'financial audit row is detached from the account');
assert.equal(paidOrder.accountDeleted, true);
assert.equal(paidOrder.payProof, null);
assert.equal(paidOrder.paymentData, null);
assert.deepEqual(paidOrder.redeemCode, { codeId: 'code-1', accountDeleted: true });
assert.equal(cache.redeemCodes[0].status, 'voided');
assert.notEqual(cache.supportTickets[0].userId, deletedId);
assert.equal(cache.supportTickets[0].contact, '');
assert.notEqual(cache.reports[0].reporterId, deletedId);

const tombstones = JSON.stringify(cache.deletedIdentities);
assert.equal(tombstones.includes('13800009991'), false, 'deleted identity is stored only as an HMAC');
assert.equal(tombstones.includes('deleted@example.com'), false);

const registeredAgain = database.createUser('13800009991', 'deleted@example.com', 'secret2');
assert.notEqual(registeredAgain.id, deletedId, 're-registration creates a fresh user id');
assert.equal(registeredAgain.coins, 0, 're-registration does not inherit balance or repeat the newcomer grant');
assert.equal(registeredAgain.onboardingRewardEligible, false);
assert.equal(cache.rechargeOrders.some(order => order.userId === registeredAgain.id), false);
assert.equal(cache.chatSessions.some(session => session.userA === registeredAgain.id || session.userB === registeredAgain.id), false);

const brandNew = database.createUser('13800009993', 'new@example.com', 'secret3');
assert.equal(brandNew.coins, 20, 'a genuinely new identity still receives the newcomer grant');

console.log('account deletion tests passed');
