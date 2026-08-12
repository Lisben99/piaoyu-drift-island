const crypto = require('crypto');
const { db, findUserById, save } = require('../db');
const { identityHash } = require('../utils/accountIdentity');

function hasUnresolvedRecharge(userId) {
  return (db().rechargeOrders || []).some(order => order.userId === userId && order.status === 'submitted');
}

function rememberDeletedIdentity(database, type, value, deletionRef, deletedAt) {
  const hash = identityHash(type, value);
  if (!hash) return;
  if (!Array.isArray(database.deletedIdentities)) database.deletedIdentities = [];
  const existing = database.deletedIdentities.find(record => record.hash === hash);
  if (existing) {
    existing.deletedAt = deletedAt;
    existing.deletionRef = deletionRef;
    existing.deletionCount = (Number(existing.deletionCount) || 1) + 1;
    return;
  }
  database.deletedIdentities.push({ type, hash, deletionRef, deletedAt, deletionCount: 1 });
}

function purgeUserAccount(userOrId, { reason = 'user_request' } = {}) {
  const database = db();
  const user = typeof userOrId === 'string' ? findUserById(userOrId) : userOrId;
  if (!user) return { success: false, error: '用户不存在' };

  const userId = user.id;
  const deletedAt = Date.now();
  const deletionRef = `deleted-${crypto.randomBytes(12).toString('hex')}`;
  const summary = {};
  const removeWhere = (key, predicate) => {
    const list = Array.isArray(database[key]) ? database[key] : [];
    const retained = list.filter(item => !predicate(item));
    summary[key] = list.length - retained.length;
    database[key] = retained;
  };

  rememberDeletedIdentity(database, 'phone', user.phone, deletionRef, deletedAt);
  rememberDeletedIdentity(database, 'email', user.email, deletionRef, deletedAt);

  const sessionIds = new Set((database.chatSessions || [])
    .filter(session => session.userA === userId || session.userB === userId)
    .map(session => session.id));
  const messageIds = new Set((database.messages || [])
    .filter(message => message.senderId === userId || sessionIds.has(message.sessionId))
    .map(message => message.id));
  const bottleIds = new Set((database.bottles || []).filter(bottle => bottle.authorId === userId).map(bottle => bottle.id));
  const momentIds = new Set((database.moments || []).filter(moment => moment.userId === userId).map(moment => moment.id));
  const orderIds = new Set((database.rechargeOrders || []).filter(order => order.userId === userId).map(order => order.id));
  const hostedStoryRoomIds = new Set((database.storyRooms || []).filter(room => room.hostId === userId).map(room => room.id));

  removeWhere('chatSessions', session => sessionIds.has(session.id));
  removeWhere('messages', message => message.senderId === userId || sessionIds.has(message.sessionId));

  const bottles = Array.isArray(database.bottles) ? database.bottles : [];
  summary.bottles = bottles.filter(bottle => bottle.authorId === userId).length;
  database.bottles = bottles
    .filter(bottle => bottle.authorId !== userId)
    .map(bottle => ({
      ...bottle,
      likes: Array.isArray(bottle.likes) ? bottle.likes.filter(id => id !== userId) : [],
      replies: Array.isArray(bottle.replies) ? bottle.replies.filter(reply => reply.senderId !== userId) : []
    }));

  const moments = Array.isArray(database.moments) ? database.moments : [];
  summary.moments = moments.filter(moment => moment.userId === userId).length;
  database.moments = moments
    .filter(moment => moment.userId !== userId)
    .map(moment => {
      const comments = Array.isArray(moment.comments) ? moment.comments : [];
      const removedCommentIds = new Set(comments.filter(comment => comment.userId === userId).map(comment => comment.id));
      return {
        ...moment,
        likes: Array.isArray(moment.likes) ? moment.likes.filter(id => id !== userId) : [],
        comments: comments
          .filter(comment => comment.userId !== userId)
          .map(comment => (comment.replyToUserId === userId || removedCommentIds.has(comment.parentCommentId)
            ? { ...comment, parentCommentId: null, replyToUserId: null }
            : comment))
      };
    });

  removeWhere('coinTransactions', item => item.userId === userId);
  removeWhere('blacklist', item => item.blockerId === userId || item.blockedId === userId);
  removeWhere('follows', item => item.followerId === userId || item.followeeId === userId);
  removeWhere('visits', item => item.visitorId === userId || item.targetId === userId);
  removeWhere('interactions', item => item.actorId === userId || item.targetUserId === userId);
  removeWhere('notifications', item => item.userId === userId || item.actorId === userId ||
    bottleIds.has(item.refId) || momentIds.has(item.refId) || sessionIds.has(item.refId));
  removeWhere('siteMailReceipts', item => item.userId === userId);
  removeWhere('popupAnnouncementReceipts', item => item.userId === userId);
  removeWhere('experienceEvents', item => item.userId === userId);
  removeWhere('contentDismissals', item => item.userId === userId || momentIds.has(item.momentId));
  removeWhere('feedExposures', item => item.userId === userId || momentIds.has(item.momentId));
  removeWhere('communityZoneProfiles', item => item.userId === userId);
  removeWhere('communityZonePasses', item => item.userId === userId);
  removeWhere('moodCheckins', item => item.userId === userId);
  removeWhere('storyRoomMessages', item => item.senderId === userId || hostedStoryRoomIds.has(item.roomId));
  const storyRooms = Array.isArray(database.storyRooms) ? database.storyRooms : [];
  summary.storyRooms = storyRooms.filter(room => room.hostId === userId).length;
  database.storyRooms = storyRooms
    .filter(room => room.hostId !== userId)
    .map(room => ({
      ...room,
      roles: Array.isArray(room.roles) ? room.roles.map(role => role.userId === userId ? { ...role, userId: null, joinedAt: null } : role) : []
    }));
  removeWhere('inviteCodes', item => item.userId === userId || item.ownerId === userId);
  removeWhere('botProfiles', item => item.userId === userId);
  removeWhere('smsCodes', item => user.phone && item.phone === user.phone);
  removeWhere('emailCodes', item => user.email && String(item.email || '').toLowerCase() === String(user.email).toLowerCase());

  // Safety and customer-service records are retained only in anonymized form.
  (database.reports || []).forEach(report => {
    if (report.reporterId === userId) {
      report.reporterId = deletionRef;
      report.description = '';
      report.accountDeleted = true;
    }
    if (report.targetId === userId || bottleIds.has(report.targetId) || messageIds.has(report.targetId)) {
      report.targetId = deletionRef;
      report.accountDeleted = true;
    }
  });
  (database.supportTickets || []).forEach(ticket => {
    if (ticket.userId !== userId) return;
    ticket.userId = deletionRef;
    ticket.subject = '已注销账户工单';
    ticket.description = '[内容已随账户注销删除]';
    ticket.contact = '';
    ticket.accountDeleted = true;
  });

  // Financial rows remain for reconciliation, but are detached from the new
  // account and stripped of payment proof, notes and redeem-code secrets.
  (database.rechargeOrders || []).forEach(order => {
    if (order.userId !== userId) return;
    order.userId = deletionRef;
    order.accountDeleted = true;
    order.deletedAt = deletedAt;
    order.payProof = null;
    order.paymentData = null;
    if (order.status === 'pending') order.status = 'expired';
    if (order.redeemCode) order.redeemCode = { codeId: order.redeemCode.codeId, accountDeleted: true };
  });
  (database.redeemCodes || []).forEach(code => {
    if (code.usedBy === userId) code.usedBy = deletionRef;
    const orderId = String(code.batch || '').startsWith('order-') ? String(code.batch).slice(6) : '';
    if (orderIds.has(orderId) && code.status === 'unused') {
      code.status = 'voided';
      code.note = '账户注销，兑换码已作废';
    }
  });

  (database.users || []).forEach(other => {
    if (other.id !== userId && other.invitedBy === userId) {
      other.invitedBy = null;
      other.inviteRewardEligible = false;
    }
  });
  removeWhere('users', item => item.id === userId);

  database.auditLogs = Array.isArray(database.auditLogs) ? database.auditLogs : [];
  database.auditLogs.push({
    id: `audit-${crypto.randomBytes(8).toString('hex')}`,
    adminId: null,
    action: 'account_deleted',
    target: deletionRef,
    description: reason,
    createdAt: deletedAt
  });
  save();
  return { success: true, deletionRef, summary };
}

module.exports = { hasUnresolvedRecharge, purgeUserAccount };
