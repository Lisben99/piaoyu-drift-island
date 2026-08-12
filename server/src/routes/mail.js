const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { listUserMail, getUnreadMailCount, readSiteMail, markAllSiteMailRead } = require('../services/siteMail');

router.get('/', auth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const result = listUserMail(req.user.id, { limit, offset });
  res.json({ success: true, mails: result.items, total: result.total, unreadCount: result.unreadCount });
});

router.get('/unread-count', auth, (req, res) => {
  res.json({ success: true, unreadCount: getUnreadMailCount(req.user.id) });
});

router.post('/read-all', auth, (req, res) => {
  const changed = markAllSiteMailRead(req.user.id);
  res.json({ success: true, changed, unreadCount: 0 });
});

router.get('/:id', auth, (req, res) => {
  const mail = readSiteMail(req.user.id, req.params.id);
  if (!mail) return res.status(404).json({ success: false, error: '站内信不存在或已失效' });
  res.json({ success: true, mail, unreadCount: getUnreadMailCount(req.user.id) });
});

module.exports = router;
