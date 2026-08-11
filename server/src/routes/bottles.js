/**
 * Bottle routes: list, create, delete, detail
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findBottleById, getActiveBottles, addCoinTransaction, findUserById, createNotification, getUnreadNotificationCount, awardExperience } = require('../db');
const { moderate } = require('../services/moderation');
const botEngine = require('../services/botEngine');

// Shared helper: append a reply to a bottle. Used by both the HTTP endpoint
// (human replies) and the Bot engine (automated replies). Returns the reply.
function recordBottleReply(bottle, data) {
  bottle.replies = bottle.replies || [];
  const reply = {
    id: genId('reply'),
    senderId: data.senderId || '',
    senderNickname: data.senderNickname || '匿名用户',
    senderGender: data.senderGender || '',
    senderAccountType: data.senderAccountType || 'HUMAN',
    anonymous: !!data.anonymous,
    content: data.content,
    createdAt: Date.now()
  };
  bottle.replies.push(reply);
  save();

  // Notify the bottle author that someone replied (skip self / anonymous author).
  if (data.senderId && data.senderId !== bottle.authorId) {
    const actor = findUserById(data.senderId);
    const notif = createNotification({
      userId: bottle.authorId,
      type: 'bottle_replied',
      title: '收到新回复',
      content: (actor ? (actor.nickname || '匿名用户') : '有人') + ' 回复了你的漂流瓶',
      refId: bottle.id,
      refType: 'bottle',
      actorId: data.senderId
    });
    if (notif) {
      const { sendToUser } = require('../services/websocket');
      sendToUser(bottle.authorId, { type: 'notification', data: { id: notif.id, unreadCount: getUnreadNotificationCount(bottle.authorId) } });
    }
  }
  return reply;
}

// List bottles (lobby)
router.get('/', (req, res) => {
  const authHeader = req.headers.authorization;
  let userId = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { verifyToken } = require('../utils/jwt');
    const decoded = verifyToken(authHeader.substring(7));
    if (decoded) userId = decoded.id;
  }
  
  const { gender, status } = req.query;
  const filters = {};
  if (gender && gender !== 'all') filters.gender = gender;
  if (status) filters.status = status;
  
  let bottles = getActiveBottles(filters);
  
  // Sort by newest first
  bottles.sort((a, b) => b.createdAt - a.createdAt);
  
  // Map to public view
  const result = bottles.map(b => {
    const author = findUserById(b.authorId);
    if (b.anonymous) {
      return {
        id: b.id,
        content: b.content,
        authorId: '',
        authorNickname: '匿名',
        authorGender: '',
        authorAvatar: '',
        anonymous: true,
        status: b.status,
        createdAt: b.createdAt,
        replyCount: b.replies ? b.replies.length : 0,
        authorAccountType: 'HUMAN',
        expiresAt: b.createdAt + db().config.bottle_display_hours * 3600000,
        likeCount: b.likes ? b.likes.length : 0,
        likedByMe: !!(b.likes && userId && b.likes.includes(userId))
      };
    }
    return {
      id: b.id,
      content: b.content,
      authorId: b.authorId,
      authorNickname: author ? author.nickname : '匿名用户',
      authorGender: (author && author.gender) || b.authorGender || '',
      authorAvatar: author ? author.avatar : '',
      anonymous: false,
      authorAccountType: author ? (author.account_type || 'HUMAN') : 'HUMAN',
      status: b.status,
      createdAt: b.createdAt,
      replyCount: b.replies ? b.replies.length : 0,
      expiresAt: b.createdAt + db().config.bottle_display_hours * 3600000,
      likeCount: b.likes ? b.likes.length : 0,
      likedByMe: !!(b.likes && userId && b.likes.includes(userId))
    };
  });
  
  res.json({ success: true, bottles: result });
});

// Get bottle detail
router.get('/:id', (req, res) => {
  const bottle = findBottleById(req.params.id);
  if (!bottle || bottle.deleted) {
    return res.json({ success: false, error: '漂流瓶不存在' });
  }
  const author = findUserById(bottle.authorId);
  if (bottle.anonymous) {
    return res.json({
      success: true,
      bottle: {
        ...bottle,
        authorId: '',
        authorNickname: '匿名',
        authorGender: '',
        authorAvatar: '',
        authorAccountType: 'HUMAN'
      }
    });
  }
  res.json({
    success: true,
    bottle: {
      ...bottle,
      authorNickname: author ? author.nickname : '匿名用户',
      authorGender: (author && author.gender) || bottle.authorGender || '',
      authorAvatar: author ? author.avatar : '',
      authorAccountType: author ? (author.account_type || 'HUMAN') : 'HUMAN',
      replies: (bottle.replies || []).map(r => ({
        id: r.id,
        senderId: r.anonymous ? '' : r.senderId,
        senderNickname: r.anonymous ? '匿名' : (r.senderNickname || '匿名用户'),
        senderGender: r.senderGender || '',
        senderAccountType: r.senderAccountType || 'HUMAN',
        anonymous: !!r.anonymous,
        content: r.content,
        createdAt: r.createdAt
      })),
      replyCount: bottle.replies ? bottle.replies.length : 0
    }
  });
});

// Reply to a bottle (PUBLIC_REPLY) — human users
router.post('/:id/reply', auth, async (req, res) => {
  const { content } = req.body;
  const bottle = findBottleById(req.params.id);
  if (!bottle || bottle.deleted) {
    return res.json({ success: false, error: '漂流瓶不存在' });
  }
  if (!content || content.trim().length === 0) {
    return res.json({ success: false, error: '回复内容不能为空' });
  }
  if (content.length > 300) {
    return res.json({ success: false, error: '回复不能超过300字' });
  }
  // Content moderation (skip if disabled via feature flag)
  if (db().config.enable_content_moderation !== false) {
    const modResult = await moderate(content);
    if (!modResult.pass) {
      return res.json({ success: false, error: modResult.reason });
    }
  }
  const reply = recordBottleReply(bottle, {
    senderId: req.user.id,
    senderNickname: req.user.nickname || '匿名用户',
    senderGender: req.user.gender,
    senderAccountType: req.user.account_type || 'HUMAN',
    anonymous: false,
    content: content.trim()
  });
  const experienceAward = awardExperience(req.user.id, 'bottle_reply', {
    eventKey: `reply:${reply.id}`,
    sourceId: reply.id
  });
  res.json({ success: true, reply, replyCount: bottle.replies.length, experienceAward });
});

// Create bottle
router.post('/', auth, async (req, res) => {
  const { content, anonymous } = req.body;
  const config = db().config;
  
  // Validate
  if (!content || content.trim().length === 0) {
    return res.json({ success: false, error: '请写点什么吧' });
  }
  if (content.length > 300) {
    return res.json({ success: false, error: '内容不能超过300字' });
  }
  
  // Check user status
  if (req.user.restrictions.publish || req.user.status === 'restricted') {
    return res.json({ success: false, error: '你的账号已被限制发布' });
  }
  
  // Check coins
  if (req.user.coins < config.bottle_publish_cost) {
    return res.json({ success: false, error: '漂流币不足，请充值', needRecharge: true });
  }
  
  // Content moderation
  const modResult = await moderate(content);
  if (!modResult.pass) {
    return res.json({ success: false, error: modResult.reason });
  }
  
  // Deduct coins
  addCoinTransaction(req.user.id, -config.bottle_publish_cost, 'bottle_publish', '发布漂流瓶');
  
  // Create bottle
  const bottle = {
    id: genId('bottle'),
    content: content.trim(),
    authorId: req.user.id,
    authorGender: req.user.gender,
    anonymous: !!anonymous,
    status: 'displaying',
    deleted: false,
    replies: [],
    createdAt: Date.now()
  };
  db().bottles.push(bottle);
  save();
  const experienceAward = awardExperience(req.user.id, 'bottle_created', {
    eventKey: `bottle:${bottle.id}`,
    sourceId: bottle.id
  });

  // Schedule a (random 30–90s) bot reply if the author is a human and no one
  // replies first (AGENTS §7). Bot-authored bottles are skipped inside.
  if ((req.user.account_type || 'HUMAN') === 'HUMAN') {
    botEngine.scheduleBottleReply(bottle.id);
  }

  res.json({
    success: true,
    bottle: { ...bottle, authorNickname: req.user.nickname },
    coins: req.user.coins,
    experienceAward
  });
});

// Delete my bottle
router.delete('/:id', auth, (req, res) => {
  const bottle = findBottleById(req.params.id);
  if (!bottle) {
    return res.json({ success: false, error: '漂流瓶不存在' });
  }
  if (bottle.authorId !== req.user.id) {
    return res.json({ success: false, error: '无权操作' });
  }
  bottle.deleted = true;
  bottle.status = 'deleted';
  save();
  res.json({ success: true });
});

// My bottles
router.get('/my/list', auth, (req, res) => {
  const { status } = req.query;
  let bottles = db().bottles.filter(b => b.authorId === req.user.id);
  
  // Auto-expire
  const now = Date.now();
  bottles.forEach(b => {
    const ageHours = (now - b.createdAt) / (1000 * 60 * 60);
    if (ageHours > db().config.bottle_display_hours && b.status === 'displaying') {
      b.status = 'expired';
    }
  });
  save();
  
  if (status) {
    bottles = bottles.filter(b => b.status === status);
  }
  
  bottles.sort((a, b) => b.createdAt - a.createdAt);
  
  res.json({
    success: true,
    bottles: bottles.map(b => ({
      id: b.id,
      content: b.content,
      status: b.status,
      anonymous: b.anonymous,
      createdAt: b.createdAt,
      likeCount: b.likes ? b.likes.length : 0,
      replyCount: b.replies ? b.replies.length : 0
    }))
  });
});

// Like / unlike a bottle (toggle). Notifies the author on a new like.
router.post('/:id/like', auth, (req, res) => {
  const bottle = findBottleById(req.params.id);
  if (!bottle || bottle.deleted) {
    return res.json({ success: false, error: '漂流瓶不存在' });
  }
  bottle.likes = bottle.likes || [];
  const uid = req.user.id;
  const idx = bottle.likes.indexOf(uid);
  let liked;
  if (idx >= 0) {
    bottle.likes.splice(idx, 1);
    liked = false;
  } else {
    bottle.likes.push(uid);
    liked = true;
  }
  save();

  // Notify the author on a NEW like (skip self / anonymous author).
  if (liked && bottle.authorId) {
    const notif = createNotification({
      userId: bottle.authorId,
      type: 'bottle_liked',
      title: '收到点赞',
      content: (req.user.nickname || '匿名用户') + ' 赞了你的漂流瓶',
      refId: bottle.id,
      refType: 'bottle',
      actorId: uid
    });
    if (notif) {
      const { sendToUser } = require('../services/websocket');
      sendToUser(bottle.authorId, { type: 'notification', data: { id: notif.id, unreadCount: getUnreadNotificationCount(bottle.authorId) } });
    }
  }
  res.json({ success: true, liked, likeCount: bottle.likes.length });
});

module.exports = router;
module.exports.recordBottleReply = recordBottleReply;
