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
  recordFeedExposures,
  updateMoment,
  dismissMoment,
  haveChatted,
  deleteMoment,
  toggleMomentLike,
  addMomentComment,
  updateUserLocation,
  getNearbyUsers,
  computeUserLevel,
  getFollowCounts,
  isFollowing,
  awardExperience,
  createNotification
} = require('../db');
const { COMMUNITY_TOPICS, COMMUNITY_MOODS, isTopicId, isMoodId } = require('../communityCatalog');
const { awardGrowthActivity, awardInviteMilestone } = require('../services/growthEconomy');

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
    type: m.type || 'community',
    createdAt: m.createdAt,
    editedAt: m.editedAt || null,
    topicId: m.topicId || null,
    topic: COMMUNITY_TOPICS.find(item => item.id === m.topicId) || null,
    mood: COMMUNITY_MOODS.find(item => item.id === m.mood) || null,
    dailyPromptId: m.dailyPromptId || null,
    likeCount: (m.likes || []).length,
    likedByMe: currentUserId ? (m.likes || []).includes(currentUserId) : false,
    resonanceCount: (m.likes || []).length,
    resonatedByMe: currentUserId ? (m.likes || []).includes(currentUserId) : false,
    commentCount: (m.comments || []).length,
    comments: (m.comments || []).map(c => {
      const cu = findUserById(c.userId) || {};
      const replyUser = c.replyToUserId ? (findUserById(c.replyToUserId) || {}) : {};
      return {
        id: c.id,
        userId: c.userId,
        nickname: cu.nickname || '用户',
        avatar: cu.avatar || '',
        content: c.content,
        parentCommentId: c.parentCommentId || null,
        replyToUserId: c.replyToUserId || null,
        replyToNickname: c.replyToUserId ? (replyUser.nickname || '用户') : '',
        createdAt: c.createdAt
      };
    }),
    author: {
      id: m.userId,
      nickname: author.nickname || '用户',
      avatar: author.avatar || '',
      gender: author.gender || '',
      verified: !!author.verified,
      verifiedType: author.verifiedType || '',
      level: computeUserLevel(author).level,
      levelTitle: computeUserLevel(author).title,
      interestIds: Array.isArray(author.interestIds) ? author.interestIds.slice(0, 5) : [],
      strangerChatPolicy: author.strangerChatPolicy || 'all',
      canChat: !currentUserId || currentUserId === m.userId ||
        (author.strangerChatPolicy !== 'closed' &&
          (author.strangerChatPolicy !== 'followers' || isFollowing(currentUserId, m.userId))),
      following: currentUserId ? isFollowing(currentUserId, m.userId) : false
    }
  };
}

// Create a moment (text and/or up to 9 images).
// `type` defaults to 'community' (public). 'moment' = 朋友圈 (private, visible only
// to the author and people who have chatted with them).
router.post('/', (req, res) => {
  const { content, images, type, topicId, mood, dailyPromptId } = req.body || {};
  const text = (content || '').trim();
  const imgs = Array.isArray(images) ? images : [];
  if (!text && imgs.length === 0) {
    return res.status(400).json({ success: false, error: '动态内容不能为空' });
  }
  const momentType = type === 'moment' ? 'moment' : 'community';
  if (momentType === 'community' && topicId && !isTopicId(topicId)) return res.status(400).json({ success: false, error: '无效话题' });
  if (momentType === 'community' && mood && !isMoodId(mood)) return res.status(400).json({ success: false, error: '无效心情' });
  const moment = createMoment(req.user.id, { content: text, images: imgs, type: momentType, topicId, mood, dailyPromptId });
  const experienceAward = awardExperience(req.user.id, momentType === 'community' ? 'community_daily_post' : 'moment_created', {
    eventKey: `moment:${moment.id}`,
    sourceId: moment.id
  });
  const promptAward = momentType === 'community' && dailyPromptId
    ? awardExperience(req.user.id, 'daily_prompt_participation', { eventKey: `daily-prompt:${dailyPromptId}:${req.user.id}`, sourceId: moment.id })
    : null;
  const validGrowthContent = text.replace(/\s/g, '').length >= 8 || imgs.length > 0;
  const coinAwards = momentType === 'community' && validGrowthContent
    ? awardGrowthActivity(req.user.id, 'community_post', moment.id)
    : [];
  if (momentType === 'community' && dailyPromptId && validGrowthContent) {
    coinAwards.push(...awardGrowthActivity(req.user.id, 'daily_prompt', moment.id));
  }
  awardInviteMilestone(req.user, 'publish');
  res.json({ success: true, moment: enrich(moment, req.user.id), experienceAward, promptAward, coinAwards, coins: req.user.coins });
});

// Community feed (all users' moments).
router.get('/community', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const sort = ['recommend', 'latest', 'following'].includes(req.query.sort) ? req.query.sort : 'recommend';
  const followedByUserId = sort === 'following' ? req.user.id : null;
  const topicId = req.query.topicId || null;
  const feedSessionId = String(req.query.feedSession || '').slice(0, 80);
  if (topicId && !isTopicId(topicId)) return res.status(400).json({ success: false, error: '无效话题' });
  const { items, total } = listMoments({ community: true, viewerId: req.user.id, followedByUserId, topicId, sort, limit, offset, feedSessionId });
  if (sort === 'recommend') {
    recordFeedExposures(req.user.id, items.map(item => item.id), { feed: 'recommend', sessionId: feedSessionId });
  }
  res.json({
    success: true,
    moments: items.map(m => enrich(m, req.user.id)),
    total,
    hasMore: offset + limit < total
  });
});

// A single user's moments (personal 朋友圈 feed) + public profile.
// The 朋友圈 pool is separate from the community feed — only type==='moment' posts
// are returned, and only to the author or a user who has chatted with them.
router.get('/user/:userId', (req, res) => {
  const u = findUserById(req.params.userId);
  if (!u || u.status === 'deleted') {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const offset = parseInt(req.query.offset) || 0;
  const isSelf = req.user.id === u.id;
  const canViewCircle = isSelf || haveChatted(req.user.id, u.id);
  const lvl = computeUserLevel(u);
  const counts = getFollowCounts(u.id);
  const { items, total } = listMoments({ userId: u.id, viewerId: req.user.id, limit, offset });
  res.json({
    success: true,
    user: {
      id: u.id,
      nickname: u.nickname || '用户',
      avatar: u.avatar || '',
      momentCover: u.momentCover || '',
      gender: u.gender || '',
      bio: u.bio || '',
      verified: !!u.verified,
      verifiedType: u.verifiedType || '',
      level: lvl.level,
      levelTitle: lvl.title,
      exp: lvl.exp,
      nextExp: lvl.nextExp,
      progress: lvl.progress,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount,
      following: isFollowing(req.user.id, u.id)
      ,interestIds: Array.isArray(u.interestIds) ? u.interestIds.slice(0, 5) : []
      ,strangerChatPolicy: u.strangerChatPolicy || 'all'
    },
    isSelf,
    canViewCircle,
    moments: items.map(m => enrich(m, req.user.id)),
    total
  });
});

// Toggle like on a moment.
router.post('/:id/like', (req, res) => {
  const r = toggleMomentLike(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ success: false, error: '动态不存在' });
  if (r.liked) {
    const moment = getMomentById(req.params.id);
    if (moment && moment.userId !== req.user.id) {
      awardExperience(moment.userId, 'resonance_received', {
        eventKey: `like:${moment.id}:${req.user.id}`,
        sourceId: moment.id
      });
      awardGrowthActivity(moment.userId, 'received_like', `${moment.id}:${req.user.id}`);
    }
  }
  res.json({ success: true, ...r, resonated: r.liked, resonanceCount: r.likeCount });
});

router.put('/:id', (req, res) => {
  const { content, topicId, mood } = req.body || {};
  if (topicId && !isTopicId(topicId)) return res.status(400).json({ success: false, error: '无效话题' });
  if (mood && !isMoodId(mood)) return res.status(400).json({ success: false, error: '无效心情' });
  const moment = updateMoment(req.params.id, req.user.id, { content, topicId, mood });
  if (!moment) return res.status(404).json({ success: false, error: '动态不存在或无权限' });
  res.json({ success: true, moment: enrich(moment, req.user.id) });
});

router.post('/:id/dismiss', (req, res) => {
  if (!dismissMoment(req.params.id, req.user.id)) return res.status(404).json({ success: false, error: '动态不存在' });
  res.json({ success: true });
});

// Add a comment to a moment.
router.post('/:id/comment', (req, res) => {
  const { content, parentCommentId } = req.body || {};
  const text = (content || '').trim();
  if (!text) return res.status(400).json({ success: false, error: '评论内容不能为空' });
  const targetMoment = getMomentById(req.params.id);
  if (!targetMoment) return res.status(404).json({ success: false, error: '动态不存在' });
  if (parentCommentId && !(targetMoment.comments || []).some(item => item.id === parentCommentId)) {
    return res.status(400).json({ success: false, error: '回复的评论不存在' });
  }
  const c = addMomentComment(req.params.id, req.user.id, text, { parentCommentId: parentCommentId || null });
  const cu = req.user;
  const experienceAward = awardExperience(req.user.id, 'comment_created', {
    eventKey: `comment:${c.id}`,
    sourceId: c.id
  });
  const coinAwards = text.replace(/\s/g, '').length >= 8 ? awardGrowthActivity(req.user.id, 'comment', c.id) : [];
  if (targetMoment && targetMoment.userId !== req.user.id) {
    awardExperience(targetMoment.userId, 'community_comment_received', {
      eventKey: `comment-received:${c.id}`,
      sourceId: c.id
    });
    awardGrowthActivity(targetMoment.userId, 'received_comment', c.id);
  }
  const replyUser = c.replyToUserId ? findUserById(c.replyToUserId) : null;
  if (replyUser) {
    createNotification({
      userId: replyUser.id,
      type: 'comment_reply',
      title: '有人回复了你',
      content: `${cu.nickname || '用户'}：${c.content.slice(0, 80)}`,
      refId: targetMoment.id,
      refType: 'moment',
      actorId: req.user.id
    });
  }
  res.json({
    success: true,
    comment: {
      id: c.id,
      userId: cu.id,
      nickname: cu.nickname || '用户',
      avatar: cu.avatar || '',
      content: c.content,
      parentCommentId: c.parentCommentId || null,
      replyToUserId: c.replyToUserId || null,
      replyToNickname: replyUser ? (replyUser.nickname || '用户') : '',
      createdAt: c.createdAt
    },
    experienceAward,
    coinAwards,
    coins: req.user.coins
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
    const level = computeUserLevel(user);
    return {
      id: user.id,
      nickname: user.nickname || '用户',
      avatar: user.avatar || '',
      gender: user.gender || '',
      bio: user.bio || '',
      verified: !!user.verified,
      verifiedType: user.verifiedType || '',
      level: level.level,
      levelTitle: level.title,
      following: isFollowing(me.id, user.id),
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
