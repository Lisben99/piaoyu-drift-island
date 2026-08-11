/**
 * Profile routes: view public profile, edit own profile
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { verifyToken } = require('../utils/jwt');
const { db, save, findUserById, computeUserLevel, getFollowCounts, isFollowing } = require('../db');

// View public profile. Auth is OPTIONAL here: anonymous viewers still get the
// profile, but a logged-in viewer additionally learns whether they follow this user.
router.get('/:id', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) {
    return res.json({ success: false, error: '用户不存在' });
  }
  if (user.status === 'banned') {
    return res.json({ success: false, error: '该用户已被封禁' });
  }
  const lvl = computeUserLevel(user);
  const counts = getFollowCounts(user.id);
  // Resolve an optional logged-in viewer from the bearer token (no reject if absent).
  let viewerId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const decoded = verifyToken(authHeader.substring(7));
    if (decoded && decoded.type === 'user') {
      const vu = findUserById(decoded.id);
      if (vu && vu.status !== 'deleted' && vu.status !== 'banned') viewerId = vu.id;
    }
  }
  res.json({
    success: true,
    profile: {
      id: user.id,
      nickname: user.nickname || '未设置',
      avatar: user.avatar,
      bio: user.bio || '',
      gender: user.gender || '',
      role: user.role || '',
      createdAt: user.createdAt,
      verified: !!user.verified,
      verifiedType: user.verifiedType || '',
      level: lvl.level,
      levelTitle: lvl.title,
      exp: lvl.exp,
      nextExp: lvl.nextExp,
      progress: lvl.progress,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
      following: viewerId ? isFollowing(viewerId, user.id) : false
    }
  });
});

// Edit my profile
router.post('/edit', auth, (req, res) => {
  const { nickname, bio, avatar } = req.body;
  
  if (nickname !== undefined) {
    if (nickname.length > 20) {
      return res.json({ success: false, error: '昵称不能超过20字' });
    }
    req.user.nickname = nickname;
  }
  if (bio !== undefined) {
    if (bio.length > 100) {
      return res.json({ success: false, error: '签名不能超过100字' });
    }
    req.user.bio = bio;
  }
  if (avatar !== undefined) {
    req.user.avatar = avatar;
  }
  
  save();
  
  res.json({
    success: true,
    profile: {
      nickname: req.user.nickname,
      bio: req.user.bio,
      avatar: req.user.avatar,
      gender: req.user.gender,
      role: req.user.role
    }
  });
});

// Delete account
router.post('/delete', auth, (req, res) => {
  // Remove user's data
  const userId = req.user.id;
  
  // Mark user as deleted (soft delete for data integrity)
  req.user.status = 'deleted';
  req.user.deletedAt = Date.now();
  
  // Delete bottles
  db().bottles.forEach(b => {
    if (b.authorId === userId) { b.deleted = true; b.status = 'deleted'; }
  });
  
  // Remove from blacklist
  db().blacklist = db().blacklist.filter(b => b.blockerId !== userId && b.blockedId !== userId);
  
  save();
  
  res.json({ success: true });
});

module.exports = router;
