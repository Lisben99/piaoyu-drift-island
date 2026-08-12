const { db, save, genId } = require('../db');
const { resolveRecipients } = require('./siteMail');

const POPUP_TYPES = new Set(['important', 'safety', 'rules', 'service']);

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sendPopupNotification({ adminId, title, content, type = 'important', buttonText = '我知道了', validHours = 168, targetType = 'all', targetIdentifiers = [] }) {
  const cleanTitle = clean(title, 60);
  const cleanContent = clean(content, 3000);
  if (!cleanTitle) throw new Error('请填写弹窗标题');
  if (!cleanContent) throw new Error('请填写弹窗正文');

  const cleanTargetType = targetType === 'specific' ? 'specific' : 'all';
  const resolved = resolveRecipients(cleanTargetType, targetIdentifiers);
  if (!resolved.users.length) throw new Error('没有找到可接收弹窗的用户');

  const now = Date.now();
  const hours = Math.min(Math.max(Number(validHours) || 168, 1), 720);
  const popup = {
    id: genId('pop'),
    title: cleanTitle,
    content: cleanContent,
    type: POPUP_TYPES.has(type) ? type : 'important',
    buttonText: clean(buttonText, 12) || '我知道了',
    targetType: cleanTargetType,
    recipientCount: resolved.users.length,
    sentBy: adminId,
    createdAt: now,
    expiresAt: now + hours * 60 * 60 * 1000
  };
  db().popupAnnouncements.push(popup);
  const receipts = resolved.users.map(user => ({
    id: genId('prc'),
    popupId: popup.id,
    userId: user.id,
    acknowledgedAt: null,
    createdAt: now
  }));
  db().popupAnnouncementReceipts.push(...receipts);
  save();
  return { popup, recipients: resolved.users, unresolved: resolved.unresolved };
}

function getPendingPopup(userId) {
  const now = Date.now();
  const popupMap = new Map((db().popupAnnouncements || []).map(item => [item.id, item]));
  const receipt = (db().popupAnnouncementReceipts || [])
    .filter(item => item.userId === userId && !item.acknowledgedAt)
    .filter(item => {
      const popup = popupMap.get(item.popupId);
      return popup && popup.expiresAt > now;
    })
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!receipt) return null;
  return { ...popupMap.get(receipt.popupId), receiptId: receipt.id };
}

function acknowledgePopup(userId, popupId) {
  const receipt = (db().popupAnnouncementReceipts || []).find(item => item.userId === userId && item.popupId === popupId);
  if (!receipt) return false;
  if (!receipt.acknowledgedAt) {
    receipt.acknowledgedAt = Date.now();
    save();
  }
  return true;
}

function listAdminPopups({ limit = 50, offset = 0 } = {}) {
  const receipts = db().popupAnnouncementReceipts || [];
  const all = [...(db().popupAnnouncements || [])].sort((a, b) => b.createdAt - a.createdAt);
  const items = all.slice(offset, offset + limit).map(popup => {
    const delivered = receipts.filter(item => item.popupId === popup.id);
    return { ...popup, recipientCount: delivered.length, acknowledgedCount: delivered.filter(item => item.acknowledgedAt).length };
  });
  return { items, total: all.length };
}

module.exports = { sendPopupNotification, getPendingPopup, acknowledgePopup, listAdminPopups };
