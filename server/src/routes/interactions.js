/**
 * Interactions (互动记录) routes
 *
 * A unified feed of "who interacted with me": likes / comments / follows / visits.
 * Each entry carries a read flag so the client can show an unread badge.
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getUserInteractions, getUnreadInteractionCount, markInteractionsRead } = require('../db');

router.use(auth);

const TYPE_LABELS = {
  like: '赞了你的动态',
  comment: '评论了你的动态',
  follow: '关注了你',
  visit: ' visited your profile'
};

// List interactions received by the current user.
router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const offset = parseInt(req.query.offset) || 0;
  const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';
  const { items, total } = getUserInteractions(req.user.id, { limit, offset, unreadOnly });
  const enriched = items.map(i => ({
    ...i,
    actionText: (TYPE_LABELS[i.type] || '与你互动')
  }));
  res.json({
    success: true,
    interactions: enriched,
    total,
    hasMore: offset + limit < total,
    unreadCount: getUnreadInteractionCount(req.user.id)
  });
});

// Mark interactions as read. If `ids` is provided (body), only those are marked;
// otherwise all of the user's interactions are marked read.
router.post('/read', (req, res) => {
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids : null;
  const changed = markInteractionsRead(req.user.id, ids);
  res.json({ success: true, changed, unreadCount: getUnreadInteractionCount(req.user.id) });
});

module.exports = router;
