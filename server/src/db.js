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
  new_user_bonus: 20,
  daily_login_bonus: 1,
  consecutive_day3_bonus: 1,
  consecutive_day7_bonus: 2,
  invite_bonus: 5,
  invited_bonus: 5,
  invite_monthly_limit: 10,
  bottle_publish_cost: 2,
  bottle_display_hours: 48,
  chat_session_cost: 1,
  chat_session_hours: 12,
  permanent_chat_cost: 2,
  recharge_rate: 10,
  min_recharge: 1,
  system_announcement: '',
  maintenance_mode: false,
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
    // Debounce PostgreSQL saves (async)
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveToPg().catch(e => console.error('[DB] PG save error:', e));
    }, 100);
  } else {
    // Debounce file saves
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveToFile(), 100);
  }
}

function saveNow() {
  if (!cache) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (USE_PG) {
    saveToPg().catch(e => console.error('[DB] PG saveNow error:', e));
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
  const passwordHash = password ? bcrypt.hashSync(password, 10) : '';
  const user = {
    id: genId('u'),
    phone: phone || '',
    email: email || '',
    passwordHash,
    nickname: '',
    avatar: '',
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
    checkin: { lastDate: null, consecutive: 0 },
    createdAt: Date.now(),
    lastLoginAt: Date.now()
  };
  cache.users.push(user);
  addCoinTransaction(user.id, config.new_user_bonus, 'new_user_bonus', '新用户注册赠送');
  save();
  return user;
}

// Reactivate a soft-deleted account for re-registration / account recovery.
// Resets the personal profile to defaults while preserving id, createdAt, inviteCode, phone, email.
function reactivateUser(user, { phone = null, email = null, password = null, role = '' } = {}) {
  if (phone !== null) user.phone = phone;
  if (email !== null) user.email = email;
  user.passwordHash = password ? bcrypt.hashSync(password, 10) : (user.passwordHash || '');
  user.nickname = '';
  user.avatar = '';
  user.bio = '';
  user.gender = role || '';
  user.role = role || '';
  user.status = 'active';
  user.deletedAt = null;
  user.coins = 0;
  user.totalRecharged = 0;
  user.totalInvited = 0;
  user.invitedBy = null;
  user.restrictions = { publish: false, chat: false };
  user.checkin = { lastDate: null, consecutive: 0 };
  user.lastLoginAt = Date.now();
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
  reactivateUser,
  setUserPassword,
  verifyPassword,
  addCoinTransaction,
  findBottleById,
  getActiveBottles,
  findChatSessionById,
  findChatSessionByUsers,
  getPendingReportsCount,
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
