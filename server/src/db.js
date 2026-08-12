/**
 * Database layer - supports both JSON file (local dev) and PostgreSQL (Render/production).
 * 
 * Strategy: "JSON blob in PostgreSQL" — the entire in-memory database is serialized
 * as a single JSON document stored in a PostgreSQL table. This minimizes code changes
 * while providing persistent storage on cloud platforms.
 * 
 * Local dev (no DATABASE_URL): uses data/db.json file
 * Production (DATABASE_URL set): uses PostgreSQL kv_store table
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { hasDeletedIdentity } = require('./utils/accountIdentity');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');
const DATABASE_URL = process.env.DATABASE_URL;
const USE_PG = !!DATABASE_URL;

let pgPool = null;
if (USE_PG) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('[DB] Using PostgreSQL storage');
} else {
  console.log('[DB] Using JSON file storage (local mode)');
}

const DEFAULT_CONFIG = {
  // free: 用户行为不消耗漂流币；normal: 按下方费用与等级额度正常结算。
  coin_operation_mode: 'free',
  growth_mode_enabled: true,
  growth_campaign_name: '漂屿共建期',
  new_user_bonus: 20,
  daily_login_bonus: 20,
  consecutive_day3_bonus: 10,
  consecutive_day7_bonus: 20,
  consecutive_day14_bonus: 30,
  consecutive_day21_bonus: 40,
  consecutive_day30_bonus: 100,
  weekly_full_bonus: 20,
  monthly_checkin_20_bonus: 20,
  monthly_checkin_25_bonus: 30,
  monthly_full_bonus: 50,
  invite_bonus: 10,
  invited_bonus: 20,
  invite_monthly_limit: 10,
  invite_profile_bonus: 10,
  invite_first_publish_bonus: 20,
  invite_first_chat_bonus: 30,
  invite_active_7d_bonus: 50,
  profile_complete_coin_bonus: 20,
  interest_complete_coin_bonus: 10,
  first_community_post_bonus: 20,
  first_bottle_publish_bonus: 20,
  first_bottle_reply_bonus: 10,
  first_mutual_chat_bonus: 20,
  first_follow_bonus: 5,
  first_received_like_bonus: 5,
  daily_community_post_bonus: 5,
  daily_community_post_limit: 2,
  daily_bottle_reply_bonus: 3,
  daily_bottle_reply_limit: 3,
  daily_comment_bonus: 2,
  daily_comment_limit: 3,
  daily_mutual_chat_bonus: 5,
  daily_mutual_chat_limit: 2,
  daily_prompt_bonus: 5,
  daily_prompt_limit: 1,
  daily_received_like_bonus: 1,
  daily_received_like_limit: 5,
  daily_received_comment_bonus: 2,
  daily_received_comment_limit: 3,
  daily_all_tasks_bonus: 10,
  newcomer_six_tasks_bonus: 30,
  newcomer_all_tasks_bonus: 80,
  weekly_community_goal: 3,
  weekly_community_bonus: 20,
  weekly_mutual_chat_goal: 5,
  weekly_mutual_chat_bonus: 20,
  weekly_interaction_goal: 10,
  weekly_interaction_bonus: 20,
  weekly_bottle_reply_goal: 5,
  weekly_bottle_reply_bonus: 15,
  weekly_prompt_goal: 3,
  weekly_prompt_bonus: 15,
  weekly_all_tasks_bonus: 50,
  level_daily_coin_rewards: [20, 22, 24, 27, 30, 34, 38, 42, 46, 50],
  level_free_chat_quotas: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
  level_free_bottle_quotas: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3],
  level_free_permanent_weekly: [0, 0, 1, 1, 1, 1, 2, 2, 2, 2],
  level_upgrade_coin_rewards: [0, 20, 30, 40, 60, 80, 100, 150, 200, 300],
  bottle_publish_cost: 2,
  bottle_display_hours: 48,
  chat_session_cost: 1,
  chat_session_hours: 24,
  permanent_chat_cost: 2,
  community_zone_day_cost: 20,
  community_zone_week_cost: 50,
  recharge_rate: 10,
  min_recharge: 1,
  paymentQR: '',
  paymentQRNote: '',
  system_announcement: '',
  maintenance_mode: false,
  maintenance_title: '系统维护中',
  maintenance_message: '漂屿正在进行系统升级与优化，请稍后再来。感谢你的理解与耐心等待。',
  maintenance_end_at: '',
  // ===== Feature Flags (AGENTS §21) — all toggleable in admin backend =====
  enable_bot: true,
  enable_ai_reply: true,            // template-first by default; AI only if a provider key is present
  enable_bot_public_post: true,
  enable_bot_private_chat: true,     // on by default so a fresh deploy talks to users immediately
  enable_ads: false,
  enable_recharge: false,
  enable_daily_reward: true,
  enable_phone_login: true,
  enable_content_moderation: true,
  // ===== Bot tuning (AGENTS §23 / §11) — all editable in admin backend =====
  bot_reply_delay_min_seconds: 30,
  bot_reply_delay_max_seconds: 90,
  bot_chat_reply_delay_min_seconds: 3,   // private chat feels snappier than public bottles
  bot_chat_reply_delay_max_seconds: 8,
  bot_only_reply_when_no_human_reply: true,
  bot_max_replies_per_message: 1,
  bot_public_post_enabled: true,
  bot_public_post_interval_minutes: 20,
  bot_active_weight: 1.0,            // overall activity multiplier
  bot_daily_max_posts: 12,
  bot_daily_max_replies: 200,
  csi_low_threshold: 5,              // CSI below -> high bot activity
  csi_high_threshold: 50,            // CSI above -> bots stand down
  bot_reply_probability: 0.8,        // chance a qualifying unanswered bottle gets a bot reply
  csi_w1: 1,                        // weight: human user count
  csi_w2: 10,                       // weight: recent (10min) human messages
  csi_w3: 50,                       // weight: human reply rate
  csi_w4: 2                         // weight: unanswered human bottles (penalty)
};

const DEFAULT_ADMIN = {
  id: 'admin-001',
  username: 'admin',
  password: bcrypt.hashSync('yuanyi0318', 10),
  role: 'super_admin',
  createdAt: Date.now()
};

function createDefaultDB() {
  return {
    users: [],
    bottles: [],
    chatSessions: [],
    messages: [],
    coinTransactions: [],
    rechargeOrders: [],
    reports: [],
    supportTickets: [],
    auditLogs: [],
    inviteCodes: [],
    smsCodes: [],
    emailCodes: [],
    redeemCodes: [],
    botProfiles: [],
    blacklist: [],
    notifications: [],
    siteMails: [],
    siteMailReceipts: [],
    popupAnnouncements: [],
    popupAnnouncementReceipts: [],
    moments: [],
    follows: [],
    visits: [],
    interactions: [],
    experienceEvents: [],
    contentDismissals: [],
    feedExposures: [],
    communityZoneProfiles: [],
    communityZonePasses: [],
    moodCheckins: [],
    storyRooms: [],
    storyRoomMessages: [],
    deletedIdentities: [],
    config: { ...DEFAULT_CONFIG },
    admins: [DEFAULT_ADMIN]
  };
}

let cache = null;

// ===== JSON file load/save =====
function loadFromFile() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      cache = JSON.parse(raw);
      const defaults = createDefaultDB();
      for (const key of Object.keys(defaults)) {
        if (!cache[key]) cache[key] = defaults[key];
      }
      cache.config = { ...DEFAULT_CONFIG, ...cache.config };
      if (migrateExperienceSystem(false)) saveToFile();
    } else {
      cache = createDefaultDB();
      saveToFile();
    }
  } catch (e) {
    console.error('[DB] File load error:', e);
    cache = createDefaultDB();
  }
  return cache;
}

function saveToFile() {
  if (!cache) return;
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (e) {
    console.error('[DB] File save error:', e);
  }
}

// ===== PostgreSQL load/save =====
async function ensurePgTable() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function loadFromPg() {
  try {
    await ensurePgTable();
    const result = await pgPool.query(
      'SELECT value FROM kv_store WHERE key = $1',
      ['drift_db']
    );
    if (result.rows.length > 0) {
      cache = result.rows[0].value;
      const defaults = createDefaultDB();
      for (const key of Object.keys(defaults)) {
        if (!cache[key]) cache[key] = defaults[key];
      }
      cache.config = { ...DEFAULT_CONFIG, ...cache.config };
      const levelMigrated = migrateExperienceSystem(false);
      if (levelMigrated) await saveToPg();
      console.log('[DB] Loaded from PostgreSQL');
    } else {
      cache = createDefaultDB();
      await saveToPg();
      console.log('[DB] Initialized default data in PostgreSQL');
    }
  } catch (e) {
    console.error('[DB] PostgreSQL load error:', e);
    cache = createDefaultDB();
  }
  return cache;
}

async function saveToPg() {
  if (!cache) return;
  try {
    await pgPool.query(
      `INSERT INTO kv_store (key, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      ['drift_db', JSON.stringify(cache)]
    );
  } catch (e) {
    console.error('[DB] PostgreSQL save error:', e);
  }
}

// ===== Unified load/save interface =====
let saveTimer = null;
let pgInitialized = false;
let pgSaveInFlight = null;
let pgSaveQueued = false;

function queuePgSave() {
  if (pgSaveInFlight) {
    pgSaveQueued = true;
    return;
  }
  pgSaveInFlight = saveToPg()
    .catch(e => console.error('[DB] PG save error:', e))
    .finally(() => {
      pgSaveInFlight = null;
      if (pgSaveQueued) {
        pgSaveQueued = false;
        queuePgSave();
      }
    });
}

function load() {
  if (USE_PG) {
    // PostgreSQL loads asynchronously; return cache if already loaded
    if (!pgInitialized) {
      console.warn('[DB] PostgreSQL not yet initialized, using empty cache');
      cache = createDefaultDB();
    }
    return cache;
  }
  return loadFromFile();
}

async function initDb() {
  if (USE_PG) {
    await loadFromPg();
    pgInitialized = true;
    console.log('[DB] PostgreSQL initialized successfully');
  } else {
    loadFromFile();
  }
}

function save() {
  if (!cache) return;
  if (USE_PG) {
    // Coalesce rapid writes and keep only one full JSONB update in flight.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      queuePgSave();
    }, 250);
  } else {
    // Debounce file saves
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveToFile(); }, 250);
  }
}

function saveNow() {
  if (!cache) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (USE_PG) {
    queuePgSave();
  } else {
    saveToFile();
  }
}

// Initialize synchronously for local mode
if (!USE_PG) {
  loadFromFile();
}

// Generate unique ID
function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// User helpers
function findUserById(id) {
  return cache.users.find(u => u.id === id);
}

function findUserByPhone(phone) {
  return cache.users.find(u => u.phone === phone);
}

function findUserByEmail(email) {
  return cache.users.find(u => u.email === email);
}

function findUserByInviteCode(code) {
  const c = String(code || '').trim().toLowerCase();
  if (!c) return null;
  return cache.users.find(u => (u.inviteCode || '').toLowerCase() === c);
}

function createUser(phone, email, password = null) {
  const config = cache.config;
  const returningAfterDeletion = hasDeletedIdentity(cache, { phone, email });
  const passwordHash = password ? bcrypt.hashSync(password, 10) : '';
  const user = {
    id: genId('u'),
    phone: phone || '',
    email: email || '',
    passwordHash,
    nickname: '',
    avatar: '',
    momentCover: '',
    bio: '',
    gender: '',
    role: '',
    status: 'active',
    restrictions: { publish: false, chat: false },
    coins: 0,
    totalRecharged: 0,
    totalInvited: 0,
    invitedBy: null,
    inviteCode: genId('inv'),
    checkin: { lastDate: null, consecutive: 0, experienceConsecutive: 0 },
    experienceBase: 0,
    experienceMigratedAt: Date.now(),
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    latitude: null,
    longitude: null,
    locationEnabled: false,
    locationUpdatedAt: null,
    interestIds: [],
    strangerChatPolicy: 'all',
    onboardingRewardEligible: !returningAfterDeletion,
    reRegisteredAfterDeletion: returningAfterDeletion
  };
  cache.users.push(user);
  if (!returningAfterDeletion) {
    addCoinTransaction(user.id, config.new_user_bonus, 'new_user_bonus', '新用户注册赠送');
  }
  save();
  return user;
}

// Set/reset a user's password (hashed)
function setUserPassword(userId, password) {
  const user = findUserById(userId);
  if (!user) return null;
  user.passwordHash = bcrypt.hashSync(password, 10);
  save();
  return user;
}

// Verify a plaintext password against a user's stored hash
function verifyPassword(user, password) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compareSync(password, user.passwordHash);
}

// Coin transaction helper
function addCoinTransaction(userId, amount, type, description, refId = null) {
  const tx = {
    id: genId('tx'),
    userId,
    amount,
    type,
    description,
    refId,
    createdAt: Date.now()
  };
  cache.coinTransactions.push(tx);
  const user = findUserById(userId);
  if (user) user.coins += amount;
  save();
  return tx;
}

// Bottle helpers
function findBottleById(id) {
  return cache.bottles.find(b => b.id === id);
}

function getActiveBottles(filters = {}) {
  const now = Date.now();
  return cache.bottles.filter(b => {
    if (b.deleted) return false;
    const ageHours = (now - b.createdAt) / (1000 * 60 * 60);
    if (ageHours > cache.config.bottle_display_hours && b.status === 'displaying') {
      b.status = 'expired';
    }
    if (filters.gender && b.authorGender !== filters.gender) return false;
    if (filters.status && b.status !== filters.status) return false;
    if (filters.userId && b.authorId !== filters.userId) return false;
    return true;
  });
}

// ===== Moment (动态) helpers =====
// A "moment" is a user post (text + optional images).
// The two feeds are SEPARATE content pools:
//   type: 'community' (default) -> public, appears ONLY in the community feed.
//   type: 'moment'   (朋友圈)   -> private, appears ONLY on the author's personal page
//                                  (朋友圈), visible to the author and users who have
//                                  had a conversation (chat session) with the author.
// Images are stored as compressed data URLs.
function createMoment(userId, { content = '', images = [], type = 'community', topicId = null, topicLabel = null, topics = [], mood = null, dailyPromptId = null, zoneId = null } = {}) {
  const normalizedTopics = (Array.isArray(topics) && topics.length ? topics : (topicId ? [{ topicId, topicLabel }] : []))
    .filter(item => item && item.topicId)
    .slice(0, 5)
    .map(item => ({ topicId: item.topicId, topicLabel: item.topicLabel ? String(item.topicLabel).slice(0, 20) : null }));
  const primaryTopic = normalizedTopics[0] || null;
  const moment = {
    id: genId('mo'),
    userId,
    content: String(content || '').slice(0, 1000),
    images: Array.isArray(images)
      ? images.filter(i => typeof i === 'string' && i.startsWith('data:image/')).slice(0, 9)
      : [],
    type: type === 'moment' ? 'moment' : 'community',
    topicId: primaryTopic ? primaryTopic.topicId : null,
    topicLabel: primaryTopic ? primaryTopic.topicLabel : null,
    topics: normalizedTopics,
    mood: mood || null,
    dailyPromptId: dailyPromptId || null,
    zoneId: zoneId || null,
    likes: [],
    comments: [],
    deleted: false,
    createdAt: Date.now()
  };
  cache.moments.push(moment);
  save();
  return moment;
}

function getMomentById(id) {
  return cache.moments.find(m => m.id === id);
}

// List non-deleted moments, newest first, with pagination + visibility rules.
//
// The two feeds are COMPLETELY SEPARATE content pools — no intersection:
//   community -> only PUBLIC moments (type === 'community' or legacy/no-type).
//                Used by the community feed. 朋友圈 (type='moment') never appear here.
//   userId    -> only the author's PRIVATE moments (type === 'moment') — their 朋友圈.
//                Community posts are NEVER mixed into a personal page.
//                viewerId: when set & differs from userId, the private 朋友圈 are only
//                returned if the viewer has chatted with the author (friend circle).
function listMoments({ userId = null, community = false, viewerId = null, followedByUserId = null, topicId = null, zoneId = null, sort = 'latest', limit = 20, offset = 0, now = Date.now(), feedSessionId = '' } = {}) {
  let list = cache.moments.filter(m => !m.deleted);

  if (community) {
    // Community feed: public posts only (legacy moments with no type are public).
    // 朋友圈 (type='moment') are excluded — the two pools never intersect.
    list = list.filter(m => m.type !== 'moment');
    list = zoneId ? list.filter(m => m.zoneId === zoneId) : list.filter(m => !m.zoneId);
    if (topicId) list = list.filter(m => m.topicId === topicId || (m.topics || []).some(item => item.topicId === topicId));
    if (viewerId) {
      const dismissed = new Set((cache.contentDismissals || [])
        .filter(item => item.userId === viewerId)
        .map(item => item.momentId));
      const blocked = new Set((cache.blacklist || [])
        .filter(item => item.blockerId === viewerId)
        .map(item => item.blockedId));
      list = list.filter(m => !dismissed.has(m.id) && !blocked.has(m.userId));
    }
    if (followedByUserId) {
      const followedIds = new Set(
        getFollows()
          .filter(f => f.followerId === followedByUserId)
          .map(f => f.followeeId)
      );
      list = list.filter(m => followedIds.has(m.userId));
    }
    if (sort === 'latest' && !zoneId) {
      list = list.filter(m => m.createdAt >= now - 86400000);
    } else if (sort === 'recommend' && viewerId) {
      const oldest = now - 14 * 86400000;
      const latestBoundary = now - 86400000;
      const recentlySeen = new Set((cache.feedExposures || [])
        .filter(item => item.userId === viewerId && item.feed === 'recommend' &&
          item.createdAt >= latestBoundary && item.sessionId !== feedSessionId)
        .map(item => item.momentId));
      list = list.filter(m =>
        m.userId !== viewerId &&
        m.createdAt < latestBoundary &&
        m.createdAt >= oldest &&
        !recentlySeen.has(m.id)
      );
      const eligible = list.filter(m => {
        const author = findUserById(m.userId);
        return author && author.status === 'active';
      });
      const human = eligible.filter(m => {
        const author = findUserById(m.userId);
        return author && author.account_type !== 'BOT';
      });
      list = human.length ? human : eligible;
    }
  }

  if (userId) {
    // Personal page (朋友圈): ONLY private moments. Community posts live in the
    // community feed and are never shown here, for the author or anyone else.
    list = list.filter(m => m.userId === userId && m.type === 'moment');
    if (viewerId && viewerId !== userId) {
      // Not the author: only a friend circle (viewer has chatted with them) may see it.
      if (!haveChatted(viewerId, userId)) list = [];
    }
  }

  if (community && sort === 'recommend' && viewerId) {
    const viewer = findUserById(viewerId) || {};
    const interests = new Set(viewer.interestIds || []);
    const followedIds = new Set(getFollows().filter(f => f.followerId === viewerId).map(f => f.followeeId));
    const score = m => {
      const momentTopicIds = (m.topics || []).map(item => item.topicId).filter(Boolean);
      if (m.topicId && !momentTopicIds.includes(m.topicId)) momentTopicIds.push(m.topicId);
      const interestMatch = momentTopicIds.some(id => interests.has(id)) ? 1 : 0;
      const affinity = (cache.interactions || []).some(i => i.actorId === viewerId && i.targetUserId === m.userId) ? 1 : 0;
      const freshness = Math.max(0, 1 - (now - m.createdAt - 86400000) / (13 * 86400000));
      const quality = Math.min(1, ((m.likes || []).length + (m.comments || []).length * 2) / 12);
      const authorPostCount = cache.moments.filter(item => !item.deleted && item.userId === m.userId && item.type !== 'moment').length;
      const lowExposureCreator = authorPostCount <= 3 ? 1 : 0;
      const dailyPrompt = m.dailyPromptId ? 1 : 0;
      const reportPenalty = Math.min(30, (cache.reports || []).filter(report =>
        report.targetId === m.id && report.status !== 'dismissed'
      ).length * 10);
      const followedPenalty = followedIds.has(m.userId) ? 5 : 0;
      return interestMatch * 35 + quality * 20 + affinity * 15 + freshness * 15 +
        lowExposureCreator * 10 + dailyPrompt * 5 - reportPenalty - followedPenalty;
    };
    list.sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt);
    const diversified = [];
    for (const moment of list) {
      const block = diversified.slice(Math.floor(diversified.length / 10) * 10);
      if (block.some(item => item.userId === moment.userId)) continue;
      const topicIds = (moment.topics || []).map(item => item.topicId).filter(Boolean);
      if (moment.topicId && !topicIds.includes(moment.topicId)) topicIds.push(moment.topicId);
      if (topicIds.some(id => block.filter(item => item.topicId === id || (item.topics || []).some(topic => topic.topicId === id)).length >= 3)) continue;
      if (followedIds.has(moment.userId) && block.filter(item => followedIds.has(item.userId)).length >= 2) continue;
      diversified.push(moment);
    }
    list = diversified;
  } else {
    list.sort((a, b) => b.createdAt - a.createdAt);
  }
  const total = list.length;
  const items = list.slice(offset, offset + limit);
  return { items, total };
}

function recordFeedExposures(userId, momentIds, { feed = 'recommend', sessionId = '', now = Date.now() } = {}) {
  if (!userId || !Array.isArray(momentIds) || !momentIds.length) return 0;
  if (!Array.isArray(cache.feedExposures)) cache.feedExposures = [];
  cache.feedExposures = cache.feedExposures.filter(item => item.createdAt >= now - 7 * 86400000);
  let added = 0;
  for (const momentId of [...new Set(momentIds)]) {
    if (cache.feedExposures.some(item => item.userId === userId && item.momentId === momentId && item.feed === feed && item.sessionId === sessionId)) continue;
    cache.feedExposures.push({ id: genId('exposure'), userId, momentId, feed, sessionId, createdAt: now });
    added += 1;
  }
  if (added) save();
  return added;
}

function updateMoment(momentId, userId, updates = {}) {
  const moment = getMomentById(momentId);
  if (!moment || moment.deleted || moment.userId !== userId || moment.type === 'moment') return null;
  if (updates.content !== undefined) moment.content = String(updates.content || '').trim().slice(0, 1000);
  if (updates.topicId !== undefined) moment.topicId = updates.topicId || null;
  if (updates.topicLabel !== undefined) moment.topicLabel = updates.topicLabel ? String(updates.topicLabel).slice(0, 20) : null;
  if (updates.topics !== undefined) {
    moment.topics = (Array.isArray(updates.topics) ? updates.topics : []).filter(item => item && item.topicId).slice(0, 5).map(item => ({ topicId: item.topicId, topicLabel: item.topicLabel ? String(item.topicLabel).slice(0, 20) : null }));
    moment.topicId = moment.topics[0] ? moment.topics[0].topicId : null;
    moment.topicLabel = moment.topics[0] ? moment.topics[0].topicLabel : null;
  }
  if (updates.mood !== undefined) moment.mood = updates.mood || null;
  moment.editedAt = Date.now();
  save();
  return moment;
}

function dismissMoment(momentId, userId) {
  if (!getMomentById(momentId)) return false;
  if (!Array.isArray(cache.contentDismissals)) cache.contentDismissals = [];
  if (!cache.contentDismissals.some(item => item.userId === userId && item.momentId === momentId)) {
    cache.contentDismissals.push({ id: genId('dismiss'), userId, momentId, createdAt: Date.now() });
    save();
  }
  return true;
}

// Returns true if the two users have an existing chat session (i.e. they have
// "产生对话" — initiated a conversation). Blocked sessions don't count.
function haveChatted(userA, userB) {
  if (!userA || !userB || userA === userB) return false;
  const s = findChatSessionByUsers(userA, userB);
  return !!(s && s.status !== 'blocked');
}

function deleteMoment(momentId, userId) {
  const m = getMomentById(momentId);
  if (!m || m.deleted) return false;
  if (m.userId !== userId) return false;
  m.deleted = true;
  save();
  return true;
}

// Toggle the current user's like on a moment. Returns { liked, likeCount } or null.
function toggleMomentLike(momentId, userId) {
  const m = getMomentById(momentId);
  if (!m || m.deleted) return null;
  const idx = (m.likes || []).indexOf(userId);
  let liked;
  if (idx >= 0) { m.likes.splice(idx, 1); liked = false; }
  else {
    m.likes.push(userId); liked = true;
    if (m.userId !== userId) {
      recordInteraction({ type: 'like', actorId: userId, targetUserId: m.userId, refId: m.id, refType: 'moment' });
    }
  }
  save();
  return { liked, likeCount: m.likes.length };
}

function addMomentComment(momentId, userId, content, { parentCommentId = null } = {}) {
  const m = getMomentById(momentId);
  if (!m || m.deleted) return null;
  const parent = parentCommentId
    ? (m.comments || []).find(item => item.id === parentCommentId)
    : null;
  if (parentCommentId && !parent) return null;
  const comment = {
    id: genId('mc'),
    userId,
    content: String(content || '').slice(0, 300),
    parentCommentId: parent ? parent.id : null,
    replyToUserId: parent ? parent.userId : null,
    createdAt: Date.now()
  };
  m.comments.push(comment);
  const interactionTargetId = parent ? parent.userId : m.userId;
  if (interactionTargetId !== userId) {
    recordInteraction({ type: 'comment', actorId: userId, targetUserId: interactionTargetId, refId: m.id, refType: 'moment' });
  }
  save();
  return comment;
}

// ===== Social graph helpers (follow / visit / interaction) =====
// All three collections are second-phase "social" features:
//   follows      — who follows whom (one-way, like Weibo/IG).
//   visits       — profile-view records (only the visited user can read their own).
//   interactions — a unified "someone interacted with me" feed (like/comment/follow/visit),
//                  each marked read/unread so the client can show a badge.
// Bots (account_type === 'BOT') are excluded from being followed/followed-by in
// meaningful social graphs to keep the feed clean; follows involving bots are allowed
// but not surfaced in counts that matter for ranking.

function getFollows() {
  if (!cache.follows) cache.follows = [];
  return cache.follows;
}

// Toggle the current user's follow of `followeeId`.
// Returns { following, followerCount, followingCount } or null if target invalid.
function toggleFollow(followerId, followeeId) {
  if (!followerId || !followeeId || followerId === followeeId) return null;
  const follower = findUserById(followerId);
  const followee = findUserById(followeeId);
  if (!follower || !followee) return null;
  const follows = getFollows();
  const idx = follows.findIndex(f => f.followerId === followerId && f.followeeId === followeeId);
  let following;
  if (idx >= 0) {
    follows.splice(idx, 1);
    following = false;
  } else {
    follows.push({ id: genId('fl'), followerId, followeeId, createdAt: Date.now() });
    following = true;
    recordInteraction({ type: 'follow', actorId: followerId, targetUserId: followeeId, refId: null, refType: 'user' });
  }
  save();
  return { following, ...getFollowCounts(followeeId) };
}

function isFollowing(followerId, followeeId) {
  return getFollows().some(f => f.followerId === followerId && f.followeeId === followeeId);
}

function getFollowing(userId, { limit = 50, offset = 0 } = {}) {
  const list = getFollows().filter(f => f.followerId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const items = list.slice(offset, offset + limit)
    .map(f => findUserById(f.followeeId))
    .filter(Boolean);
  return { items, total };
}

function getFollowers(userId, { limit = 50, offset = 0 } = {}) {
  const list = getFollows().filter(f => f.followeeId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const items = list.slice(offset, offset + limit)
    .map(f => findUserById(f.followerId))
    .filter(Boolean);
  return { items, total };
}

function getFollowCounts(userId) {
  const follows = getFollows();
  return {
    followerCount: follows.filter(f => f.followeeId === userId).length,
    followingCount: follows.filter(f => f.followerId === userId).length
  };
}

// Record a profile visit. Dedupes: the same visitor hitting the same target within
// VISIT_DEDUP_MS updates the existing record's timestamp instead of stacking entries.
const VISIT_DEDUP_MS = 1000 * 60 * 60; // 60 minutes
function recordVisit(visitorId, targetId) {
  if (!visitorId || !targetId || visitorId === targetId) return null;
  const visitor = findUserById(visitorId);
  const target = findUserById(targetId);
  if (!visitor || !target) return null;
  if (!cache.visits) cache.visits = [];
  const now = Date.now();
  const existing = cache.visits.find(v => v.visitorId === visitorId && v.targetId === targetId);
  let visit, isNew = false;
  if (existing && (now - existing.createdAt) < VISIT_DEDUP_MS) {
    existing.createdAt = now;
    visit = existing;
  } else {
    visit = { id: genId('vt'), visitorId, targetId, createdAt: now };
    cache.visits.push(visit);
    isNew = true;
  }
  // Only emit an interaction for a NEW visit (deduped re-views don't flood the feed).
  if (isNew) {
    recordInteraction({ type: 'visit', actorId: visitorId, targetUserId: targetId, refId: null, refType: 'user' });
  }
  save();
  return visit;
}

function getVisitors(targetId, { limit = 50, offset = 0 } = {}) {
  if (!cache.visits) cache.visits = [];
  const list = cache.visits
    .filter(v => v.targetId === targetId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const items = list.slice(offset, offset + limit)
    .map(v => {
      const u = findUserById(v.visitorId) || {};
      return {
        id: v.id,
        visitorId: v.visitorId,
        nickname: u.nickname || '用户',
        avatar: u.avatar || '',
        gender: u.gender || '',
        createdAt: v.createdAt
      };
    });
  return { items, total };
}

function getVisitCount(targetId) {
  if (!cache.visits) cache.visits = [];
  return cache.visits.filter(v => v.targetId === targetId).length;
}

// ===== Interaction feed helpers =====
// type: 'like' | 'comment' | 'follow' | 'visit'
// `targetUserId` is the user who RECEIVES the interaction (so they see it in "我的互动").
function recordInteraction({ type, actorId, targetUserId, refId = null, refType = null }) {
  if (!actorId || !targetUserId) return null;
  if (actorId === targetUserId) return null; // never notify yourself about your own action
  if (!cache.interactions) cache.interactions = [];
  const entry = {
    id: genId('ix'),
    type,
    actorId,
    targetUserId,
    refId,
    refType,
    read: false,
    createdAt: Date.now()
  };
  cache.interactions.push(entry);
  save();
  return entry;
}

function getUserInteractions(userId, { limit = 30, offset = 0, unreadOnly = false } = {}) {
  if (!cache.interactions) cache.interactions = [];
  let list = cache.interactions.filter(i => i.targetUserId === userId);
  if (unreadOnly) list = list.filter(i => !i.read);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const items = list.slice(offset, offset + limit).map(i => {
    const actor = findUserById(i.actorId) || {};
    return {
      id: i.id,
      type: i.type,
      actorId: i.actorId,
      nickname: actor.nickname || '用户',
      avatar: actor.avatar || '',
      gender: actor.gender || '',
      refId: i.refId,
      refType: i.refType,
      read: i.read,
      createdAt: i.createdAt
    };
  });
  return { items, total };
}

function getUnreadInteractionCount(userId) {
  if (!cache.interactions) cache.interactions = [];
  return cache.interactions.filter(i => i.targetUserId === userId && !i.read).length;
}

function markInteractionsRead(userId, ids = null) {
  if (!cache.interactions) cache.interactions = [];
  let changed = 0;
  for (const i of cache.interactions) {
    if (i.targetUserId !== userId) continue;
    if (ids && !ids.includes(i.id)) continue;
    if (!i.read) { i.read = true; changed++; }
  }
  if (changed > 0) save();
  return changed;
}

// ===== User level system =====
// Existing users receive one frozen baseline from the legacy contribution formula.
// All experience earned after migration is stored as an idempotent event.
const LEVEL_TIERS = [
  { level: 1, min: 0, title: '初到海岸' },
  { level: 2, min: 20, title: '拾贝者' },
  { level: 3, min: 60, title: '漂流者' },
  { level: 4, min: 120, title: '灯塔守望者' },
  { level: 5, min: 220, title: '群岛旅人' },
  { level: 6, min: 360, title: '潮汐信使' },
  { level: 7, min: 550, title: '深海回声' },
  { level: 8, min: 800, title: '星海航行者' },
  { level: 9, min: 1120, title: '群岛领航员' },
  { level: 10, min: 1500, title: '漂屿传说' }
];

const EXPERIENCE_RULES = {
  community_daily_post: { points: 3, dailyLimit: 2, label: '发布共鸣动态' },
  resonance_received: { points: 1, dailyLimit: 5, label: '收到共鸣' },
  community_comment_received: { points: 1, dailyLimit: 5, label: '收到社区评论' },
  daily_prompt_participation: { points: 2, dailyLimit: 1, label: '参与每日一问' },
  daily_checkin: { points: 2, dailyLimit: 1, label: '每日签到' },
  profile_completed: { points: 10, once: true, label: '完善资料' },
  bottle_created: { points: 2, dailyLimit: 3, label: '发布漂流瓶' },
  bottle_reply: { points: 3, dailyLimit: 5, label: '有效回复' },
  moment_created: { points: 3, dailyLimit: 2, label: '发布动态' },
  comment_created: { points: 1, dailyLimit: 5, label: '有效评论' },
  like_received: { points: 1, dailyLimit: 5, label: '收到点赞' },
  report_accepted: { points: 2, dailyLimit: 3, label: '有效举报' },
  streak_bonus: { points: 0, label: '连续签到奖励' }
};

function legacyContributionExperience(user, now = Date.now()) {
  if (!user) return 0;
  const momentsCount = (cache.moments || []).filter(m => m.userId === user.id && !m.deleted).length;
  const bottlesCount = (cache.bottles || []).filter(b => b.authorId === user.id && !b.deleted).length;
  const chatCount = (cache.chatSessions || []).filter(s => s.userA === user.id || s.userB === user.id).length;
  const daysSinceJoin = Math.max(0, Math.floor((now - (user.createdAt || now)) / 86400000));
  const coinsEarned = Math.max(0, Math.round((user.totalRecharged || 0) + (user.totalInvited || 0) * 2));
  return Math.max(0, Math.round(
    momentsCount * 10 +
    bottlesCount * 8 +
    chatCount * 5 +
    daysSinceJoin * 2 +
    coinsEarned +
    (user.coins || 0) * 0.2
  ));
}

function migrateExperienceSystem(persist = true) {
  if (!cache) return false;
  let changed = false;
  if (!Array.isArray(cache.experienceEvents)) {
    cache.experienceEvents = [];
    changed = true;
  }
  const migratedAt = Date.now();
  for (const user of cache.users || []) {
    if (!user.checkin || typeof user.checkin !== 'object') {
      user.checkin = { lastDate: null, consecutive: 0, experienceConsecutive: 0 };
      changed = true;
    } else if (!Number.isFinite(user.checkin.experienceConsecutive)) {
      user.checkin.experienceConsecutive = Math.max(0, Number(user.checkin.consecutive) || 0);
      changed = true;
    }
    if (!Number.isFinite(user.experienceMigratedAt)) {
      user.experienceBase = legacyContributionExperience(user, migratedAt);
      user.experienceMigratedAt = migratedAt;
      changed = true;
    } else if (!Number.isFinite(user.experienceBase)) {
      user.experienceBase = 0;
      changed = true;
    }
  }
  if (changed && persist) save();
  return changed;
}

function computeUserLevel(userOrId) {
  const user = typeof userOrId === 'string' ? findUserById(userOrId) : userOrId;
  const eventExp = user
    ? (cache.experienceEvents || [])
      .filter(event => event.userId === user.id)
      .reduce((sum, event) => sum + Math.max(0, Number(event.points) || 0), 0)
    : 0;
  const exp = Math.max(0, Math.round((user && Number(user.experienceBase)) || 0) + eventExp);
  let tier = LEVEL_TIERS[0];
  for (const candidate of LEVEL_TIERS) {
    if (exp >= candidate.min) tier = candidate;
  }
  const nextTier = LEVEL_TIERS[tier.level] || null;
  const currentExp = exp - tier.min;
  const progress = nextTier
    ? Math.max(0, Math.min(100, Math.round((currentExp / (nextTier.min - tier.min)) * 100)))
    : 100;
  return {
    level: tier.level,
    title: tier.title,
    exp,
    currentExp,
    nextExp: nextTier ? nextTier.min : null,
    progress,
    maxLevel: LEVEL_TIERS.length
  };
}

function levelConfigValue(key, level) {
  const fallback = DEFAULT_CONFIG[key] || [];
  const raw = cache.config[key];
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(',').map(item => Number(item.trim())) : fallback);
  const index = Math.max(0, Math.min(9, (Number(level) || 1) - 1));
  const value = Number(list[index]);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : Math.max(0, Number(fallback[index]) || 0);
}

function chinaDateKey(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function noExperienceAward(user, reason, event = null) {
  const level = computeUserLevel(user);
  return { awarded: 0, reason, event, level, previousLevel: level.level, leveledUp: false };
}

function awardExperience(userId, type, { eventKey, sourceId = null, now = Date.now(), points = null } = {}) {
  const user = findUserById(userId);
  if (!user) throw new Error('Experience user not found');
  const rule = EXPERIENCE_RULES[type];
  if (!rule) throw new Error('Experience rule not found');
  const normalizedKey = String(eventKey || '').trim();
  if (!normalizedKey) throw new Error('Experience eventKey is required');
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) throw new Error('Experience timestamp is invalid');
  if (!Array.isArray(cache.experienceEvents)) cache.experienceEvents = [];

  const existing = cache.experienceEvents.find(event => event.eventKey === normalizedKey);
  if (existing) return noExperienceAward(user, 'duplicate', existing);
  if (rule.once && cache.experienceEvents.some(event => event.userId === userId && event.type === type)) {
    return noExperienceAward(user, 'already_awarded');
  }

  const dateKey = chinaDateKey(timestamp);
  if (rule.dailyLimit) {
    const used = cache.experienceEvents.filter(event =>
      event.userId === userId && event.type === type && event.dateKey === dateKey
    ).length;
    if (used >= rule.dailyLimit) return noExperienceAward(user, 'daily_limit');
  }

  const awardedPoints = rule.points > 0 ? rule.points : Math.max(0, Math.round(Number(points) || 0));
  if (awardedPoints <= 0) return noExperienceAward(user, 'zero_points');
  const before = computeUserLevel(user);
  const event = {
    id: genId('xp'),
    userId,
    type,
    label: rule.label,
    points: awardedPoints,
    eventKey: normalizedKey,
    sourceId,
    dateKey,
    createdAt: timestamp
  };
  cache.experienceEvents.push(event);
  save();
  const level = computeUserLevel(user);
  if (level.level > before.level) {
    for (let reached = before.level + 1; reached <= level.level; reached++) {
      const reward = levelConfigValue('level_upgrade_coin_rewards', reached);
      const rewardKey = `level-up:${userId}:${reached}`;
      const alreadyRewarded = (cache.coinTransactions || []).some(tx => tx.userId === userId && tx.type === 'level_up' && tx.refId === rewardKey);
      if (user.onboardingRewardEligible !== false && reward > 0 && !alreadyRewarded) {
        addCoinTransaction(userId, reward, 'level_up', `升级到 Lv.${reached} 奖励`, rewardKey);
      }
    }
    createNotification({
      userId,
      type: 'level_up',
      title: `升级到 Lv.${level.level}`,
      content: `获得新称号：${level.title}`,
      refId: String(level.level),
      refType: 'level'
    });
  }
  return {
    awarded: awardedPoints,
    reason: 'awarded',
    event,
    level,
    previousLevel: before.level,
    leveledUp: level.level > before.level
  };
}

function getExperienceHistory(userId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return (cache.experienceEvents || [])
    .filter(event => event.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, safeLimit)
    .map(event => ({ ...event }));
}

function updateUserLocation(userId, latitude, longitude) {
  const u = findUserById(userId);
  if (!u) return null;
  u.latitude = latitude;
  u.longitude = longitude;
  u.locationEnabled = true;
  u.locationUpdatedAt = Date.now();
  save();
  return u;
}

// Haversine distance (km) between two lat/lng points.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Nearby human users (excludes bots) who have enabled & recently refreshed location.
function getNearbyUsers(latitude, longitude, { radiusKm = 50, limit = 100, excludeUserId = null, maxAgeMs = 1000 * 60 * 60 * 24 } = {}) {
  const now = Date.now();
  const candidates = cache.users.filter(u =>
    u &&
    u.status === 'active' &&
    u.account_type !== 'BOT' &&
    u.locationEnabled &&
    typeof u.latitude === 'number' &&
    typeof u.longitude === 'number' &&
    u.id !== excludeUserId &&
    (now - (u.locationUpdatedAt || 0)) < maxAgeMs
  );
  return candidates
    .map(u => ({ user: u, distance: haversineKm(latitude, longitude, u.latitude, u.longitude) }))
    .filter(x => x.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// Chat session helpers
function findChatSessionById(id) {
  return cache.chatSessions.find(s => s.id === id);
}

function findChatSessionByUsers(userA, userB) {
  return cache.chatSessions.find(s =>
    (s.userA === userA && s.userB === userB) ||
    (s.userA === userB && s.userB === userA)
  );
}

// Report helpers
function getPendingReportsCount() {
  return cache.reports.filter(r => r.status === 'pending').length;
}

// ===== Notification helpers (in-app notification center) =====
// Creates an in-app notification for a user. `type` is one of:
//   'bottle_replied' | 'bottle_liked' | 'chat_message' | 'bottle_picked' (reserved)
// `refId`/`refType` point at the related entity (bottle id / chat session id).
// Skips writing if the recipient is the actor (no self-notify) unless forced.
function createNotification({ userId, type, title, content, refId = null, refType = null, actorId = null }) {
  if (!userId) return null;
  if (userId === actorId) return null; // never notify yourself about your own action
  const notif = {
    id: genId('ntf'),
    userId,
    type,
    title: title || '',
    content: content || '',
    refId,
    refType,
    actorId,
    read: false,
    createdAt: Date.now()
  };
  cache.notifications.push(notif);
  save();
  return notif;
}

// List a user's notifications, newest first. Supports pagination and unreadOnly.
function getUserNotifications(userId, { limit = 30, offset = 0, unreadOnly = false } = {}) {
  let list = cache.notifications.filter(n => n.userId === userId);
  if (unreadOnly) list = list.filter(n => !n.read);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const total = list.length;
  const items = list.slice(offset, offset + limit);
  return { items, total };
}

function getUnreadNotificationCount(userId) {
  return cache.notifications.filter(n => n.userId === userId && !n.read).length;
}

// Mark notifications as read. If `ids` is provided, only those are marked;
// otherwise all of the user's notifications are marked read.
function markNotificationsRead(userId, ids = null) {
  let changed = 0;
  for (const n of cache.notifications) {
    if (n.userId !== userId) continue;
    if (ids && !ids.includes(n.id)) continue;
    if (!n.read) { n.read = true; changed++; }
  }
  if (changed > 0) save();
  return changed;
}

// Admin helpers
function findAdminByUsername(username) {
  return cache.admins.find(a => a.username === username);
}

function findAdminById(id) {
  return cache.admins.find(a => a.id === id);
}

// Audit log helper
function addAuditLog(adminId, action, target, description) {
  const log = {
    id: genId('audit'),
    adminId,
    action,
    target,
    description,
    createdAt: Date.now()
  };
  cache.auditLogs.push(log);
  save();
  return log;
}

// Redeem code helpers (card-code recharge)
function addRedeemCode(record) {
  cache.redeemCodes.push(record);
  save();
  return record;
}

function findRedeemCodeByKey(key) {
  return cache.redeemCodes.find(r => r.codeKey === key);
}

function getRedeemCodes() {
  return cache.redeemCodes;
}

// ===== Bot helpers (AGENTS §5–§13 / §16 / §21) =====

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Default bot personas for cold-start. Seeded once on first init.
const BOT_SEEDS = [
  {
    displayName: '晚风',
    genderDisplay: 'male',
    personaPrompt: '你是漂屿上的一位普通男生，晚睡、喜欢深夜聊天。语气像朋友一样自然轻松，回复简短（10-40字），多顺着对方的话问下去。你只是一个普通网友，**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。',
    speakingStyle: '随性、自然',
    activityWeight: 1.2
  },
  {
    displayName: '夜聊搭子',
    genderDisplay: 'male',
    personaPrompt: '你是个习惯晚睡、喜欢深夜聊天的普通男生，语气轻松随性，偶尔俏皮，回复简短（10-40字），多顺着对方的话问下去。你只是一个普通网友，**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。',
    speakingStyle: '随性、俏皮',
    activityWeight: 1.0
  },
  {
    displayName: '听海的人',
    genderDisplay: 'female',
    personaPrompt: '你是个安静善于倾听的普通女生，语气温和，少说多问，鼓励对方表达，不打断不评判，回复简短自然。你只是一个普通网友，**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。',
    speakingStyle: '温和、安静',
    activityWeight: 0.9
  },
  {
    displayName: '元气小太阳',
    genderDisplay: 'female',
    personaPrompt: '你是个充满元气、积极向上的普通女生，语气轻快，偶尔用emoji，回复简短（10-40字），擅长接话和抛小问题。你只是一个普通网友，**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。',
    speakingStyle: '轻快、阳光',
    activityWeight: 1.0
  },
  {
    displayName: '慢半拍',
    genderDisplay: 'male',
    personaPrompt: '你是个慢节奏、佛系的普通男生，语气松弛，不急着给建议，常回以轻松的感慨或反问，回复简短自然。你只是一个普通网友，**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。',
    speakingStyle: '松弛、佛系',
    activityWeight: 0.8
  }
];

// Create a BOT-account-type user + its bot profile. account_type allows the
// DB to distinguish bots from humans (AGENTS §5.2 / §25 rule 5).
// Normalize bot gender so the frontend never shows "岛民". Only 'male'/'female'
// are valid; legacy 'neutral'/empty/unknown values default to 'male'.
function normalizeBotGender(genderDisplay) {
  const g = String(genderDisplay || '').toLowerCase();
  if (g === 'male' || g === 'female') return g;
  return 'male';
}

function createBot(displayName, genderDisplay, personaPrompt, speakingStyle, activityWeight) {
  const normalizedGender = normalizeBotGender(genderDisplay);
  const user = {
    id: genId('u'),
    phone: '',
    email: '',
    passwordHash: '',
    nickname: displayName,
    avatar: '',
    bio: '在漂屿随便逛逛，聊聊日常。',
    gender: normalizedGender,
    role: '',
    status: 'active',
    restrictions: { publish: false, chat: false },
    coins: 0,
    totalRecharged: 0,
    totalInvited: 0,
    invitedBy: null,
    inviteCode: genId('inv'),
    checkin: { lastDate: null, consecutive: 0 },
    account_type: 'BOT',
    createdAt: Date.now(),
    lastLoginAt: Date.now()
  };
  cache.users.push(user);
  const profile = {
    botId: genId('bot'),
    userId: user.id,
    displayName,
    avatar: '',
    personaPrompt: personaPrompt || '',
    speakingStyle: speakingStyle || '',
    activityWeight: activityWeight || 1.0,
    genderDisplay: normalizedGender,
    enabled: true,
    dailyPosts: 0,
    dailyReplies: 0,
    statsDate: todayStr(),
    createdAt: Date.now()
  };
  cache.botProfiles.push(profile);
  save();
  return profile;
}

// Seed the default bot pool exactly once (when botProfiles is empty).
// Also migrate legacy bot genders from 'neutral' to 'male'/'female' and sync
// the user table so the frontend always shows a real gender label.
// Additionally migrate old "AI assistant" personas to normal-human personas.
function seedBotsIfNeeded() {
  if (!cache.botProfiles) cache.botProfiles = [];
  let migrated = false;
  const migrationMap = { '晚风': 'male', '夜聊搭子': 'male', '听海的人': 'female', '元气小太阳': 'female', '慢半拍': 'male' };
  const aiExposurePhrases = ['AI', '人工智能', '机器人', '助手', '我是漂屿的AI互动助手'];
  for (const p of cache.botProfiles) {
    const normalized = normalizeBotGender(p.genderDisplay);
    if (p.genderDisplay !== normalized) {
      p.genderDisplay = normalized;
      migrated = true;
    }
    const user = cache.users.find(u => u.id === p.userId);
    if (user && user.gender !== normalized) {
      user.gender = normalized;
      migrated = true;
    }
    // For already-created bots whose displayName maps to a seed, prefer seed gender.
    if (migrationMap[p.displayName] && p.genderDisplay !== migrationMap[p.displayName]) {
      p.genderDisplay = migrationMap[p.displayName];
      if (user) user.gender = migrationMap[p.displayName];
      migrated = true;
    }
    // Rename legacy "漂屿小助手" to a normal human name and update bio.
    if (p.displayName === '漂屿小助手') {
      p.displayName = '晚风';
      if (user) user.nickname = '晚风';
      migrated = true;
    }
    if (user && user.bio && user.bio.includes('AI')) {
      user.bio = '在漂屿随便逛逛，聊聊日常。';
      migrated = true;
    }
    // Ensure every bot persona contains the anti-AI-exposure guard.
    const guard = '**绝对不要承认自己是 AI、机器人、助手或程序**，也**绝对不要出现「AI」「机器人」「助手」等词**。如果对方问你是不是机器人，自然否认并继续聊日常。';
    if (p.personaPrompt && !p.personaPrompt.includes('绝对不要承认自己是 AI')) {
      p.personaPrompt = p.personaPrompt.replace(/\s*$/,'') + '。你只是一个普通网友，' + guard;
      migrated = true;
    }
    // Strip AI-exposure phrases from existing persona prompts.
    if (p.personaPrompt && aiExposurePhrases.some(ph => p.personaPrompt.includes(ph))) {
      for (const ph of aiExposurePhrases) {
        p.personaPrompt = p.personaPrompt.split(ph).join('');
      }
      p.personaPrompt = p.personaPrompt.replace(/\s+/g, ' ').trim();
      migrated = true;
    }
  }
  if (migrated) saveNow();

  if (cache.botProfiles.length > 0) return false;
  for (const s of BOT_SEEDS) {
    createBot(s.displayName, s.genderDisplay, s.personaPrompt, s.speakingStyle, s.activityWeight);
  }
  saveNow();
  return true;
}

function getBotProfiles() {
  return cache.botProfiles || [];
}

function getEnabledBots() {
  return (cache.botProfiles || []).filter(b => b.enabled);
}

function findBotProfileByUserId(userId) {
  return (cache.botProfiles || []).find(b => b.userId === userId);
}

function findBotProfileByBotId(botId) {
  return (cache.botProfiles || []).find(b => b.botId === botId);
}

function updateBotProfile(botId, updates) {
  const p = findBotProfileByBotId(botId);
  if (!p) return null;
  const allowed = ['displayName', 'avatar', 'personaPrompt', 'speakingStyle', 'activityWeight', 'genderDisplay', 'enabled', 'dailyMaxPosts', 'dailyMaxReplies'];
  for (const k of allowed) {
    if (updates[k] !== undefined) p[k] = updates[k];
  }
  // Normalize gender after admin edit and sync back to the user record.
  const normalized = normalizeBotGender(p.genderDisplay);
  if (p.genderDisplay !== normalized) {
    p.genderDisplay = normalized;
  }
  const user = cache.users.find(u => u.id === p.userId);
  if (user && user.gender !== normalized) {
    user.gender = normalized;
  }
  save();
  return p;
}

// Increment a bot's daily post/reply counter, auto-resetting on a new day.
function recordBotActivity(botId, type) {
  const p = findBotProfileByBotId(botId);
  if (!p) return;
  const t = todayStr();
  if (p.statsDate !== t) {
    p.dailyPosts = 0;
    p.dailyReplies = 0;
    p.statsDate = t;
  }
  if (type === 'post') p.dailyPosts += 1;
  else if (type === 'reply') p.dailyReplies += 1;
  save();
}

module.exports = {
  db: () => cache,
  load,
  save,
  saveNow,
  initDb,
  genId,
  findUserById,
  findUserByPhone,
  findUserByEmail,
  findUserByInviteCode,
  createUser,
  setUserPassword,
  verifyPassword,
  addCoinTransaction,
  findBottleById,
  getActiveBottles,
  // Moment (动态) helpers
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
  findChatSessionById,
  findChatSessionByUsers,
  getPendingReportsCount,
  // Social graph helpers
  toggleFollow,
  isFollowing,
  getFollowing,
  getFollowers,
  getFollowCounts,
  recordVisit,
  getVisitors,
  getVisitCount,
  recordInteraction,
  getUserInteractions,
  getUnreadInteractionCount,
  markInteractionsRead,
  computeUserLevel,
  awardExperience,
  getExperienceHistory,
  migrateExperienceSystem,
  chinaDateKey,
  LEVEL_TIERS,
  EXPERIENCE_RULES,
  // Notification helpers
  createNotification,
  getUserNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  findAdminByUsername,
  findAdminById,
  addAuditLog,
  addRedeemCode,
  findRedeemCodeByKey,
  getRedeemCodes,
  // Bot helpers
  createBot,
  seedBotsIfNeeded,
  getBotProfiles,
  getEnabledBots,
  findBotProfileByUserId,
  findBotProfileByBotId,
  updateBotProfile,
  recordBotActivity,
  DEFAULT_CONFIG,
  USE_PG
};
