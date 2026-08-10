/**
 * Notification routes: list, unread count, mark read
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, getUserNotifications, getUnreadNotificationCount, markNotificationsRead, findUserById } = require('../db');

// Notification type -> human label + navigation target
function decorate(n) {
  const actor = n.actorId ? findUserById(n.actorId) : null;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    content: n.content,
    refId: n.refId,
    refType: n.refType,
    actorId: n.actorId,
    actorNickname: actor ? (actor.nickname || '匿名用户') : '',
    read: n.read,
    createdAt: n.createdAt
  };
}

// List notifications (paginated)
router.get('/', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = getUserNotifications(req.user.id, { limit, offset });
  const unreadCount = getUnreadNotificationCount(req.user.id);
  res.json({
    success: true,
    notifications: items.map(decorate),
    total,
    unreadCount,
    hasMore: offset + items.length < total
  });
});

// Unread count only (lightweight, for badges / polling)
router.get('/unread-count', auth, (req, res) => {
  res.json({ success: true, unreadCount: getUnreadNotificationCount(req.user.id) });
});

// Mark all as read
router.post('/read', auth, (req, res) => {
  const changed = markNotificationsRead(req.user.id);
  res.json({ success: true, changed, unreadCount: getUnreadNotificationCount(req.user.id) });
});

// Mark a single notification as read
router.post('/read/:id', auth, (req, res) => {
  const changed = markNotificationsRead(req.user.id, [req.params.id]);
  res.json({ success: true, changed, unreadCount: getUnreadNotificationCount(req.user.id) });
});

module.exports = router;
