/**
 * Moments (动态) routes
 *
 * Personal feed + community feed + nearby people + likes/comments + location.
 * All endpoints require a valid user token (router.use(auth)).
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  db,
  findUserById,
  createMoment,
  getMomentById,
  listMoments,
  deleteMoment,
  toggleMomentLike,
  addMomentComment,
  updateUserLocation,
  getNearbyUsers
} = require('../db');

router.use(auth);

// Enrich a raw moment record with author info + like/comment meta for the client.
// Comments are returned inline (moment threads are small); nicknames/avatars are
// resolved from the user table so deleted users degrade gracefully to "用户".
function enrich(m, currentUserId) {
  const author = findUserById(m.userId) || {};
  return {
    id: m.id,
    content: m.content,
    images: m.images || [],
    createdAt: m.createdAt,
    likeCount: (m.likes || []).length,
    likedByMe: currentUserId ? (m.likes || []).includes(currentUserId) : false,
    commentCount: (m.comments || []).length,
    comments: (m.comments || []).map(c => {
      const cu = findUserById(c.userId) || {};
      return {
        id: c.id,
        userId: c.userId,
        nickname: cu.nickname || '用户',
        avatar: cu.avatar || '',
        content: c.content,
        createdAt: c.createdAt
      };
    }),
    author: {
      id: m.userId,
      nickname: author.nickname || '用户',
      avatar: author.avatar || '',
      gender: author.gender || ''
    }
  };
}

// Create a moment (text and/or up to 9 images).
router.post('/', (req, res) => {
  const { content, images } = req.body || {};
  const text = (content || '').trim();
  const imgs = Array.isArray(images) ? images : [];
  if (!text && imgs.length === 0) {
    return res.status(400).json({ success: false, error: '动态内容不能为空' });
  }
  const moment = createMoment(req.user.id, { content: text, images: imgs });
  res.json({ success: true, moment: enrich(moment, req.user.id) });
});

// Community feed (all users' moments).
router.get('/community', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = listMoments({ community: true, limit, offset });
  res.json({
    success: true,
    moments: items.map(m => enrich(m, req.user.id)),
    total,
    hasMore: offset + limit < total
  });
});

// A single user's moments (personal feed) + public profile.
router.get('/user/:userId', (req, res) => {
  const u = findUserById(req.params.userId);
  if (!u || u.status === 'deleted') {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = listMoments({ userId: u.id, limit, offset });
  res.json({
    success: true,
    user: {
      id: u.id,
      nickname: u.nickname || '用户',
      avatar: u.avatar || '',
      gender: u.gender || '',
      bio: u.bio || ''
    },
    moments: items.map(m => enrich(m, req.user.id)),
    total
  });
});

// Toggle like on a moment.
router.post('/:id/like', (req, res) => {
  const r = toggleMomentLike(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ success: false, error: '动态不存在' });
  res.json({ success: true, ...r });
});

// Add a comment to a moment.
router.post('/:id/comment', (req, res) => {
  const { content } = req.body || {};
  const text = (content || '').trim();
  if (!text) return res.status(400).json({ success: false, error: '评论内容不能为空' });
  const c = addMomentComment(req.params.id, req.user.id, text);
  if (!c) return res.status(404).json({ success: false, error: '动态不存在' });
  const cu = req.user;
  res.json({
    success: true,
    comment: {
      id: c.id,
      userId: cu.id,
      nickname: cu.nickname || '用户',
      avatar: cu.avatar || '',
      content: c.content,
      createdAt: c.createdAt
    }
  });
});

// Delete own moment.
router.delete('/:id', (req, res) => {
  const ok = deleteMoment(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ success: false, error: '动态不存在或无权限' });
  res.json({ success: true });
});

// Update & enable the current user's location.
router.post('/location', (req, res) => {
  const lat = parseFloat(req.body && req.body.latitude);
  const lng = parseFloat(req.body && req.body.longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, error: '经纬度无效' });
  }
  updateUserLocation(req.user.id, lat, lng);
  res.json({ success: true });
});

// Nearby people. Requires the requester to have enabled location themselves.
router.get('/nearby', (req, res) => {
  const me = req.user;
  if (!me.locationEnabled) {
    return res.status(403).json({ success: false, error: '请先开启定位', needLocation: true });
  }
  let lat = parseFloat(req.query.latitude);
  let lng = parseFloat(req.query.longitude);
  if (isNaN(lat) || isNaN(lng)) { lat = me.latitude; lng = me.longitude; }
  const radius = Math.min(parseFloat(req.query.radius) || 50, 500);
  const list = getNearbyUsers(lat, lng, { radiusKm: radius, limit: 100, excludeUserId: me.id });
  const moments = db().moments.filter(m => !m.deleted);
  const result = list.map(({ user, distance }) => {
    const userMoments = moments
      .filter(m => m.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const latest = userMoments[0];
    return {
      id: user.id,
      nickname: user.nickname || '用户',
      avatar: user.avatar || '',
      gender: user.gender || '',
      bio: user.bio || '',
      distance: Math.round(distance * 10) / 10,
      lastActiveAt: user.lastLoginAt || user.createdAt,
      latestMoment: latest
        ? { id: latest.id, content: latest.content, images: latest.images || [], createdAt: latest.createdAt }
        : null
    };
  });
  res.json({ success: true, users: result });
});

module.exports = router;
