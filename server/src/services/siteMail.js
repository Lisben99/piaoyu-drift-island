const { db, save, genId } = require('../db');

const MAIL_TYPES = new Set(['update', 'activity', 'system', 'safety']);

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function canReceiveMail(user) {
  return user && user.status !== 'deleted' && user.status !== 'banned' && user.status !== 'frozen' &&
    (user.account_type || 'HUMAN') !== 'BOT';
}

function splitIdentifiers(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,，;；]+/);
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))];
}

function resolveRecipients(targetType, targetIdentifiers) {
  const users = (db().users || []).filter(canReceiveMail);
  if (targetType === 'all') return { users, unresolved: [] };

  const identifiers = splitIdentifiers(targetIdentifiers);
  const matched = [];
  const unresolved = [];
  for (const identifier of identifiers) {
    const key = identifier.toLowerCase();
    const user = users.find(item =>
      String(item.id || '').toLowerCase() === key ||
      String(item.phone || '').toLowerCase() === key ||
      String(item.email || '').toLowerCase() === key
    );
    if (user) matched.push(user);
    else unresolved.push(identifier);
  }
  return { users: [...new Map(matched.map(user => [user.id, user])).values()], unresolved };
}

function sendSiteMail({ adminId, title, summary, content, type = 'system', version = '', targetType = 'all', targetIdentifiers = [] }) {
  const cleanTitle = text(title, 60);
  const cleanContent = text(content, 10000);
  const cleanSummary = text(summary, 160) || cleanContent.replace(/\s+/g, ' ').slice(0, 80);
  const cleanType = MAIL_TYPES.has(type) ? type : 'system';
  const cleanTargetType = targetType === 'specific' ? 'specific' : 'all';
  if (!cleanTitle) throw new Error('请填写站内信标题');
  if (!cleanContent) throw new Error('请填写站内信正文');

  const resolved = resolveRecipients(cleanTargetType, targetIdentifiers);
  if (!resolved.users.length) throw new Error('没有找到可接收站内信的用户');

  const now = Date.now();
  const mail = {
    id: genId('mail'),
    title: cleanTitle,
    summary: cleanSummary,
    content: cleanContent,
    type: cleanType,
    version: text(version, 30),
    targetType: cleanTargetType,
    recipientCount: resolved.users.length,
    sentBy: adminId,
    createdAt: now
  };
  db().siteMails.push(mail);
  const receipts = resolved.users.map(user => ({
    id: genId('mrc'),
    mailId: mail.id,
    userId: user.id,
    readAt: null,
    archivedAt: null,
    createdAt: now
  }));
  db().siteMailReceipts.push(...receipts);
  save();
  return { mail, recipients: resolved.users, unresolved: resolved.unresolved };
}

function listUserMail(userId, { limit = 50, offset = 0 } = {}) {
  const mailMap = new Map((db().siteMails || []).map(mail => [mail.id, mail]));
  const all = (db().siteMailReceipts || [])
    .filter(receipt => receipt.userId === userId && !receipt.archivedAt && mailMap.has(receipt.mailId))
    .sort((a, b) => b.createdAt - a.createdAt);
  const items = all.slice(offset, offset + limit).map(receipt => ({ ...mailMap.get(receipt.mailId), receiptId: receipt.id, readAt: receipt.readAt }));
  return { items, total: all.length, unreadCount: all.filter(item => !item.readAt).length };
}

function getUnreadMailCount(userId) {
  return (db().siteMailReceipts || []).filter(item => item.userId === userId && !item.readAt && !item.archivedAt).length;
}

function readSiteMail(userId, mailId) {
  const receipt = (db().siteMailReceipts || []).find(item => item.userId === userId && item.mailId === mailId && !item.archivedAt);
  const mail = (db().siteMails || []).find(item => item.id === mailId);
  if (!receipt || !mail) return null;
  if (!receipt.readAt) {
    receipt.readAt = Date.now();
    save();
  }
  return { ...mail, receiptId: receipt.id, readAt: receipt.readAt };
}

function markAllSiteMailRead(userId) {
  let changed = 0;
  const now = Date.now();
  for (const receipt of db().siteMailReceipts || []) {
    if (receipt.userId === userId && !receipt.readAt && !receipt.archivedAt) {
      receipt.readAt = now;
      changed += 1;
    }
  }
  if (changed) save();
  return changed;
}

function listAdminMail({ limit = 50, offset = 0 } = {}) {
  const receipts = db().siteMailReceipts || [];
  const all = [...(db().siteMails || [])].sort((a, b) => b.createdAt - a.createdAt);
  const items = all.slice(offset, offset + limit).map(mail => {
    const delivered = receipts.filter(item => item.mailId === mail.id);
    return { ...mail, recipientCount: delivered.length, readCount: delivered.filter(item => item.readAt).length };
  });
  return { items, total: all.length };
}

module.exports = {
  MAIL_TYPES,
  sendSiteMail,
  listUserMail,
  getUnreadMailCount,
  readSiteMail,
  markAllSiteMailRead,
  listAdminMail
};
