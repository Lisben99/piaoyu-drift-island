/**
 * Follow (关注) routes
 *
 * One-way social graph: a user follows another. The follow action also writes an
 * interaction (so the followee sees "X 关注了你" in their 互动 feed).
 *
 * All endpoints require a valid user token (router.use(auth)).
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
  toggleFollow,
  isFollowing,
  getFollowing,
  getFollowers,
  getFollowCounts,
  findUserById,
  computeUserLevel
} = require('../db');

router.use(auth);

// Public user summary used in follow lists (no leakage of private fields).
function publicSummary(u) {
  if (!u) return null;
  const lvl = computeUserLevel(u);
  return {
    id: u.id,
    nickname: u.nickname || '用户',
    avatar: u.avatar || '',
    gender: u.gender || '',
    bio: u.bio || '',
    verified: !!u.verified,
    verifiedType: u.verifiedType || '',
    level: lvl.level,
    levelTitle: lvl.title
  };
}

// Toggle follow of :userId. Returns { following, followerCount, followingCount }.
router.post('/:userId', (req, res) => {
  const target = findUserById(req.params.userId);
  if (!target || target.status === 'deleted') {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }
  if (target.account_type === 'BOT') {
    return res.status(400).json({ success: false, error: '暂不支持关注 Bot' });
  }
  const r = toggleFollow(req.user.id, target.id);
  if (!r) return res.status(400).json({ success: false, error: '操作无效' });
  res.json({ success: true, ...r });
});

// List who a user is following. Defaults to the current user when ?userId omitted.
router.get('/following', (req, res) => {
  const userId = req.query.userId || req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = getFollowing(userId, { limit, offset });
  const counts = getFollowCounts(userId);
  res.json({
    success: true,
    users: items.map(publicSummary).filter(Boolean),
    total,
    hasMore: offset + limit < total,
    counts
  });
});

// List a user's followers.
router.get('/followers', (req, res) => {
  const userId = req.query.userId || req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const { items, total } = getFollowers(userId, { limit, offset });
  const counts = getFollowCounts(userId);
  res.json({
    success: true,
    users: items.map(publicSummary).filter(Boolean),
    total,
    hasMore: offset + limit < total,
    counts
  });
});

// Quick check: does the current user follow :userId?
router.get('/status/:userId', (req, res) => {
  const target = findUserById(req.params.userId);
  if (!target) return res.status(404).json({ success: false, error: '用户不存在' });
  res.json({
    success: true,
    following: isFollowing(req.user.id, target.id),
    ...getFollowCounts(target.id)
  });
});

module.exports = router;
