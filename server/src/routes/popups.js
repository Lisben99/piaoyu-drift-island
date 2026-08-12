const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getPendingPopup, acknowledgePopup } = require('../services/popupNotifications');

router.get('/pending', auth, (req, res) => {
  res.json({ success: true, popup: getPendingPopup(req.user.id) });
});

router.post('/:id/acknowledge', auth, (req, res) => {
  if (!acknowledgePopup(req.user.id, req.params.id)) {
    return res.status(404).json({ success: false, error: '弹窗通知不存在' });
  }
  res.json({ success: true });
});

module.exports = router;
