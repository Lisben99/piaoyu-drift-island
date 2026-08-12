'use strict';

const { db, save, genId, findUserById, computeUserLevel, addCoinTransaction, chinaDateKey } = require('../db');

const ZONES = Object.freeze({
  letter: Object.freeze({ id: 'letter', label: '字母圈', paid: true, minimumLevel: 2 }),
  mature: Object.freeze({ id: 'mature', label: '成熟专区', paid: true, minimumLevel: 2 }),
  story: Object.freeze({ id: 'story', label: '剧情岛', paid: false, minimumLevel: 1 })
});
const AGREEMENT_VERSION = '2026-08-12';
const DAY_MS = 86400000;

function zoneById(zoneId) { return ZONES[zoneId] || null; }
function profileFor(userId, zoneId) {
  return (db().communityZoneProfiles || []).find(item => item.userId === userId && item.zoneId === zoneId) || null;
}
function activePass(userId, zoneId, now = Date.now()) {
  return (db().communityZonePasses || [])
    .filter(item => item.userId === userId && item.zoneId === zoneId && Number(item.expiresAt) > now)
    .sort((a, b) => b.expiresAt - a.expiresAt)[0] || null;
}
function verifiedContact(user) { return !!(String(user.phone || '').trim() || String(user.email || '').trim()); }
function profileComplete(profile, zoneId) {
  if (!profile || !profile.adultConfirmed || profile.agreementVersion !== AGREEMENT_VERSION) return false;
  if (!String(profile.alias || '').trim()) return false;
  if (zoneId === 'letter') return Array.isArray(profile.tags) && profile.tags.length > 0 && !!profile.experience && !!profile.boundary;
  if (zoneId === 'mature') return !!profile.ageRange && !!profile.relationshipStatus && Array.isArray(profile.interests) && profile.interests.length > 0;
  return true;
}
function pricing() {
  return {
    day: Math.max(0, Number(db().config.community_zone_day_cost) || 20),
    week: Math.max(0, Number(db().config.community_zone_week_cost) || 50)
  };
}
function getZoneStatus(userOrId, zoneId, now = Date.now()) {
  const user = typeof userOrId === 'string' ? findUserById(userOrId) : userOrId;
  const zone = zoneById(zoneId);
  if (!user || !zone) return null;
  const level = computeUserLevel(user).level;
  const profile = profileFor(user.id, zoneId);
  const pass = zone.paid ? activePass(user.id, zoneId, now) : null;
  const complete = !zone.paid || profileComplete(profile, zoneId);
  const eligible = verifiedContact(user) && level >= zone.minimumLevel && complete;
  return {
    zone,
    level,
    verifiedContact: verifiedContact(user),
    profileComplete: complete,
    eligible,
    accessActive: zone.paid ? !!pass && eligible : true,
    accessExpiresAt: pass ? pass.expiresAt : null,
    profile,
    pricing: pricing()
  };
}
function sanitizeText(value, max) { return String(value || '').trim().slice(0, max); }
function uniqueAllowed(values, allowed, max = 6) {
  return [...new Set(Array.isArray(values) ? values : [])].filter(value => allowed.includes(value)).slice(0, max);
}
function saveZoneProfile(user, zoneId, input = {}) {
  const zone = zoneById(zoneId);
  if (!zone || !zone.paid) return { success: false, status: 404, error: '专区不存在' };
  if (!verifiedContact(user)) return { success: false, status: 403, error: '请先完成手机号或邮箱验证' };
  if (computeUserLevel(user).level < zone.minimumLevel) return { success: false, status: 403, error: `达到 Lv.${zone.minimumLevel} 后可开通` };
  if (input.adultConfirmed !== true || input.rulesAccepted !== true) {
    return { success: false, status: 400, error: '请确认已满18周岁并同意专区规则' };
  }
  const base = {
    id: '', userId: user.id, zoneId, alias: sanitizeText(input.alias, 16),
    avatar: sanitizeText(input.avatar, 200000), adultConfirmed: true, rulesAccepted: true,
    agreementVersion: AGREEMENT_VERSION, allowStrangerChat: input.allowStrangerChat !== false,
    updatedAt: Date.now()
  };
  if (!base.alias) return { success: false, status: 400, error: '请设置专区昵称' };
  let details;
  if (zoneId === 'letter') {
    details = {
      tags: uniqueAllowed(input.tags, ['S', 'M', 'Switch', '新手', '了解中'], 3),
      experience: uniqueAllowed([input.experience], ['new', 'beginner', 'familiar'], 1)[0] || '',
      purpose: sanitizeText(input.purpose, 60), boundary: sanitizeText(input.boundary, 120)
    };
    if (!details.tags.length || !details.experience || !details.boundary) return { success: false, status: 400, error: '请完善身份标签、经验程度和个人边界' };
  } else {
    details = {
      ageRange: uniqueAllowed([input.ageRange], ['18-24', '25-30', '31-40', '40+'], 1)[0] || '',
      relationshipStatus: uniqueAllowed([input.relationshipStatus], ['single', 'dating', 'married', 'private'], 1)[0] || '',
      purpose: sanitizeText(input.purpose, 60),
      interests: uniqueAllowed(input.interests, ['情感交流', '生活阅历', '婚恋关系', '职场成长', '旅行', '阅读'], 4)
    };
    if (!details.ageRange || !details.relationshipStatus || !details.interests.length) return { success: false, status: 400, error: '请完善年龄段、当前状态和兴趣话题' };
  }
  const database = db();
  database.communityZoneProfiles = Array.isArray(database.communityZoneProfiles) ? database.communityZoneProfiles : [];
  let profile = profileFor(user.id, zoneId);
  if (profile) Object.assign(profile, base, details);
  else {
    profile = { ...base, ...details, id: genId('zone-profile'), createdAt: Date.now() };
    database.communityZoneProfiles.push(profile);
  }
  save();
  return { success: true, profile };
}
function purchaseZoneAccess(user, zoneId, plan, now = Date.now()) {
  const status = getZoneStatus(user, zoneId, now);
  if (!status || !status.zone.paid) return { success: false, status: 404, error: '专区不存在' };
  if (!status.eligible) return { success: false, status: 403, error: status.profileComplete ? '暂不满足开通条件' : '请先完善专区资料' };
  if (!['day', 'week'].includes(plan)) return { success: false, status: 400, error: '开通周期无效' };
  const cost = status.pricing[plan];
  if (user.coins < cost) return { success: false, status: 402, error: '漂流币不足', required: cost, balance: user.coins };
  const existing = activePass(user.id, zoneId, now);
  const startsAt = existing ? existing.expiresAt : now;
  const duration = plan === 'week' ? 7 * DAY_MS : DAY_MS;
  const pass = {
    id: genId('zone-pass'), userId: user.id, zoneId, plan, cost,
    startsAt, expiresAt: startsAt + duration, createdAt: now
  };
  db().communityZonePasses.push(pass);
  addCoinTransaction(user.id, -cost, 'community_zone_access', `${status.zone.label}${plan === 'week' ? '周卡' : '日卡'}`, pass.id);
  save();
  return { success: true, pass, coins: user.coins };
}
function canAccessZone(user, zoneId, now = Date.now()) {
  const status = getZoneStatus(user, zoneId, now);
  return !!(status && status.accessActive);
}

function moodDashboard(userId, now = Date.now()) {
  const database = db();
  const today = chinaDateKey(now);
  const start = now - 7 * DAY_MS;
  const rows = (database.moodCheckins || []).filter(item => item.createdAt >= start);
  const todayRows = rows.filter(item => item.dateKey === today);
  const counts = {};
  todayRows.forEach(item => { counts[item.mood] = (counts[item.mood] || 0) + 1; });
  return {
    today: todayRows.find(item => item.userId === userId) || null,
    todayTotal: todayRows.length,
    counts,
    trend: rows.filter(item => item.userId === userId).sort((a, b) => a.createdAt - b.createdAt).map(item => ({ dateKey: item.dateKey, mood: item.mood }))
  };
}
function checkinMood(user, mood, note = '', now = Date.now()) {
  const allowed = ['calm', 'happy', 'healing', 'lonely', 'hopeful', 'thinking'];
  if (!allowed.includes(mood)) return { success: false, status: 400, error: '请选择有效心情' };
  const database = db();
  database.moodCheckins = Array.isArray(database.moodCheckins) ? database.moodCheckins : [];
  const dateKey = chinaDateKey(now);
  let row = database.moodCheckins.find(item => item.userId === user.id && item.dateKey === dateKey);
  if (row) Object.assign(row, { mood, note: sanitizeText(note, 60), updatedAt: now });
  else {
    row = { id: genId('mood'), userId: user.id, dateKey, mood, note: sanitizeText(note, 60), createdAt: now, updatedAt: now };
    database.moodCheckins.push(row);
  }
  save();
  return { success: true, checkin: row, dashboard: moodDashboard(user.id, now) };
}

module.exports = {
  ZONES, AGREEMENT_VERSION, zoneById, profileFor, getZoneStatus, saveZoneProfile,
  purchaseZoneAccess, canAccessZone, moodDashboard, checkinMood
};
