/**
 * Profile routes: view public profile, edit own profile
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { verifyToken } = require('../utils/jwt');
const {
  db, save, findUserById, computeUserLevel, awardExperience,
  getExperienceHistory, LEVEL_TIERS, EXPERIENCE_RULES,
  getFollowCounts, isFollowing
} = require('../db');
const { COMMUNITY_INTERESTS, isInterestId } = require('../communityCatalog');
const { awardCoinOnce, awardInviteMilestone, getBenefits, levelValue, maybeAwardNewcomerProgress } = require('../services/growthEconomy');
const { hasUnresolvedRecharge, purgeUserAccount } = require('../services/accountDeletion');
const { disconnectUser } = require('../services/websocket');

router.get('/level/me', auth, (req, res) => {
  const rules = Object.entries(EXPERIENCE_RULES)
    .filter(([type]) => type !== 'streak_bonus')
    .map(([type, rule]) => ({
      type,
      label: rule.label,
      points: rule.points,
      dailyLimit: rule.dailyLimit || null,
      once: !!rule.once
    }));
  res.json({
    success: true,
    level: computeUserLevel(req.user),
    tiers: LEVEL_TIERS.map(tier => ({
      ...tier,
      dailyCoins: levelValue(db().config, 'level_daily_coin_rewards', tier.level),
      freeChats: levelValue(db().config, 'level_free_chat_quotas', tier.level),
      freeBottles: levelValue(db().config, 'level_free_bottle_quotas', tier.level),
      freePermanentWeekly: levelValue(db().config, 'level_free_permanent_weekly', tier.level),
      upgradeCoins: levelValue(db().config, 'level_upgrade_coin_rewards', tier.level)
    })),
    rules,
    history: getExperienceHistory(req.user.id, 30),
    benefits: getBenefits(req.user)
  });
});

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
      momentCover: user.momentCover || '',
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
      ,interestIds: Array.isArray(user.interestIds) ? user.interestIds.slice(0, 5) : []
      ,strangerChatPolicy: user.strangerChatPolicy || 'all'
      ,receivedResonance: (db().moments || []).filter(m => m.userId === user.id && !m.deleted)
        .reduce((sum, m) => sum + (m.likes || []).length, 0)
    }
  });
});

router.patch('/interests', auth, (req, res) => {
  const interestIds = Array.isArray(req.body && req.body.interestIds)
    ? [...new Set(req.body.interestIds)].slice(0, 5)
    : [];
  if (interestIds.some(id => !isInterestId(id))) {
    return res.status(400).json({ success: false, error: '包含无效兴趣' });
  }
  req.user.interestIds = interestIds;
  save();
  const coinAward = interestIds.length && req.user.onboardingRewardEligible !== false
    ? awardCoinOnce(req.user.id, db().config.interest_complete_coin_bonus, 'interest_completed', '完善兴趣标签', `interest-complete:${req.user.id}`)
    : null;
  if (coinAward) maybeAwardNewcomerProgress(req.user.id);
  res.json({ success: true, interestIds, interests: COMMUNITY_INTERESTS.filter(item => interestIds.includes(item.id)), coinAward, coins: req.user.coins });
});

router.patch('/chat-policy', auth, (req, res) => {
  const policy = req.body && req.body.strangerChatPolicy;
  if (!['all', 'followers', 'closed'].includes(policy)) {
    return res.status(400).json({ success: false, error: '无效私聊权限' });
  }
  req.user.strangerChatPolicy = policy;
  save();
  res.json({ success: true, strangerChatPolicy: policy });
});

// Edit my profile
router.post('/edit', auth, (req, res) => {
  const { nickname, bio, avatar, momentCover } = req.body;
  
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
  if (momentCover !== undefined) {
    const cover = String(momentCover || '');
    if (cover && !/^data:image\/(?:jpeg|png|webp);base64,/i.test(cover)) {
      return res.status(400).json({ success: false, error: '封面图片格式无效，请选择 JPG、PNG 或 WebP' });
    }
    if (cover.length > 2500000) {
      return res.status(413).json({ success: false, error: '封面压缩后仍然过大，请换一张图片' });
    }
    req.user.momentCover = cover;
  }
  
  save();
  const profileComplete = !!(
    String(req.user.nickname || '').trim() &&
    String(req.user.bio || '').trim() &&
    String(req.user.avatar || '').trim()
  );
  const experienceAward = profileComplete
    ? awardExperience(req.user.id, 'profile_completed', {
      eventKey: `profile-complete:${req.user.id}`,
      sourceId: req.user.id
    })
    : null;
  const coinAward = profileComplete && req.user.onboardingRewardEligible !== false
    ? awardCoinOnce(req.user.id, db().config.profile_complete_coin_bonus, 'profile_completed', '完善个人资料', `profile-complete:${req.user.id}`)
    : null;
  if (profileComplete) awardInviteMilestone(req.user, 'profile');
  if (coinAward) maybeAwardNewcomerProgress(req.user.id);
  
  res.json({
    success: true,
    profile: {
      nickname: req.user.nickname,
      bio: req.user.bio,
      avatar: req.user.avatar,
      momentCover: req.user.momentCover || '',
      gender: req.user.gender,
      role: req.user.role
    },
    experienceAward,
    coinAward,
    coins: req.user.coins
  });
});

// Delete account
router.post('/delete', auth, (req, res) => {
  const userId = req.user.id;
  if (hasUnresolvedRecharge(userId)) {
    return res.status(409).json({
      success: false,
      error: '存在待管理员确认的充值订单，请处理完成后再注销'
    });
  }

  const result = purgeUserAccount(userId, { reason: 'user_request' });
  if (!result.success) {
    return res.status(404).json(result);
  }

  // Any token already issued is rejected because the user row is gone. Close
  // active sockets as well so an open chat cannot continue after deletion.
  disconnectUser(userId);
  return res.json({ success: true, deleted: true });
});

module.exports = router;
