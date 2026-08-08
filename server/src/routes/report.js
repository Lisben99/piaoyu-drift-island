/**
 * Report routes: create report, list my reports
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findUserById } = require('../db');

const REPORT_REASONS = [
  '色情低俗', '政治敏感', '诈骗欺诈', '骚扰谩骂',
  '广告引流', '违法信息', '侵犯隐私', '人身攻击', '其他'
];

// Create report
router.post('/', auth, (req, res) => {
  const { targetType, targetId, reason, description } = req.body;
  
  if (!targetType || !targetId || !reason) {
    return res.json({ success: false, error: '请填写完整举报信息' });
  }
  if (!['user', 'bottle', 'message'].includes(targetType)) {
    return res.json({ success: false, error: '无效的举报类型' });
  }
  if (!REPORT_REASONS.includes(reason)) {
    return res.json({ success: false, error: '请选择有效的举报原因' });
  }
  
  const report = {
    id: genId('report'),
    reporterId: req.user.id,
    targetType,
    targetId,
    reason,
    description: description || '',
    status: 'pending',
    createdAt: Date.now(),
    handledAt: null,
    handleResult: null,
    handleNote: null
  };
  
  db().reports.push(report);
  save();
  
  res.json({ success: true, report });
});

// List my reports
router.get('/my', auth, (req, res) => {
  const reports = db().reports
    .filter(r => r.reporterId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, reports });
});

module.exports = router;
