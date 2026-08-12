'use strict';

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, findUserById, computeUserLevel, isFollowing } = require('../db');
const {
  COMMUNITY_INTERESTS, COMMUNITY_MOODS, listCommunityTopics, getTodayPrompt
} = require('../communityCatalog');
const {
  ZONES, getZoneStatus, saveZoneProfile, purchaseZoneAccess, listMatureMembers, moodDashboard, checkinMood
} = require('../services/communityZones');

router.use(auth);

router.get('/catalog', (req, res) => {
  res.json({ success: true, interests: COMMUNITY_INTERESTS, moods: COMMUNITY_MOODS });
});

router.get('/topics', (req, res) => res.json({ success: true, topics: listCommunityTopics() }));
router.get('/prompts/today', (req, res) => res.json({ success: true, prompt: getTodayPrompt() }));

router.get('/hubs', (req, res) => {
  const database = db();
  const counts = {};
  Object.keys(ZONES).forEach(zoneId => {
    counts[zoneId] = (database.moments || []).filter(moment => !moment.deleted && moment.zoneId === zoneId).length;
  });
  res.json({ success: true, counts, mood: moodDashboard(req.user.id) });
});

router.get('/mood', (req, res) => res.json({ success: true, ...moodDashboard(req.user.id) }));
router.post('/mood', (req, res) => {
  const result = checkinMood(req.user, req.body && req.body.mood, req.body && req.body.note);
  return res.status(result.status || 200).json(result);
});

router.get('/zones/:zoneId/status', (req, res) => {
  const status = getZoneStatus(req.user, req.params.zoneId);
  if (!status) return res.status(404).json({ success: false, error: '专区不存在' });
  return res.json({ success: true, ...status });
});

router.post('/zones/:zoneId/profile', (req, res) => {
  const result = saveZoneProfile(req.user, req.params.zoneId, req.body || {});
  return res.status(result.status || 200).json(result);
});

router.post('/zones/:zoneId/purchase', (req, res) => {
  const result = purchaseZoneAccess(req.user, req.params.zoneId, req.body && req.body.plan);
  return res.status(result.status || 200).json(result);
});

router.get('/zones/mature/members', (req, res) => {
  const result = listMatureMembers(req.user, {
    gender: req.query.gender,
    ageRange: req.query.ageRange,
    relationshipStatus: req.query.relationshipStatus
  });
  return res.status(result.status || 200).json(result);
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 40);
  if (!q) return res.json({ success: true, users: [], topics: [], moments: [] });
  const users = (db().users || [])
    .filter(u => u.status === 'active' && u.account_type !== 'BOT' && `${u.nickname || ''} ${u.bio || ''}`.toLowerCase().includes(q))
    .slice(0, 10)
    .map(u => {
      const level = computeUserLevel(u);
      return { id: u.id, nickname: u.nickname || '用户', avatar: u.avatar || '', gender: u.gender || '', bio: u.bio || '', level: level.level, interestIds: (u.interestIds || []).slice(0, 5), following: isFollowing(req.user.id, u.id) };
    });
  const topics = listCommunityTopics().filter(item => `${item.label} ${item.description}`.toLowerCase().includes(q)).slice(0, 10);
  const moments = (db().moments || [])
    .filter(m => !m.deleted && m.type !== 'moment' && !m.zoneId && `${m.content || ''} ${m.topicLabel || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20)
    .map(m => {
      const author = findUserById(m.userId) || {};
      return { id: m.id, content: m.content, images: m.images || [], topicId: m.topicId || null, topicLabel: m.topicLabel || null, mood: m.mood || null, createdAt: m.createdAt, author: { id: m.userId, nickname: author.nickname || '用户', avatar: author.avatar || '' } };
    });
  res.json({ success: true, users, topics, moments });
});

module.exports = router;
