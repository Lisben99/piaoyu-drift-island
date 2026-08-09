/**
 * Bottle routes: list, create, delete, detail
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { db, save, genId, findBottleById, getActiveBottles, addCoinTransaction, findUserById } = require('../db');
const { moderate } = require('../services/moderation');

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
        expiresAt: b.createdAt + db().config.bottle_display_hours * 3600000
      };
    }
    return {
      id: b.id,
      content: b.content,
      authorId: b.authorId,
      authorNickname: author ? author.nickname : '匿名用户',
      authorGender: b.authorGender,
      authorAvatar: author ? author.avatar : '',
      anonymous: false,
      status: b.status,
      createdAt: b.createdAt,
      expiresAt: b.createdAt + db().config.bottle_display_hours * 3600000
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
        authorAvatar: ''
      }
    });
  }
  res.json({
    success: true,
    bottle: {
      ...bottle,
      authorNickname: author ? author.nickname : '匿名用户',
      authorAvatar: author ? author.avatar : ''
    }
  });
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
    authorGender: req.user.role,
    anonymous: !!anonymous,
    status: 'displaying',
    deleted: false,
    createdAt: Date.now()
  };
  db().bottles.push(bottle);
  save();
  
  res.json({
    success: true,
    bottle: { ...bottle, authorNickname: req.user.nickname },
    coins: req.user.coins
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
      createdAt: b.createdAt
    }))
  });
});

module.exports = router;
