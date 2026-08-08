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
  invite_monthly_limit: 10,
  bottle_publish_cost: 2,
  bottle_display_hours: 48,
  chat_session_cost: 1,
  chat_session_hours: 12,
  permanent_chat_cost: 2,
  recharge_rate: 10,
  min_recharge: 1,
  system_announcement: '',
  maintenance_mode: false
};

const DEFAULT_ADMIN = {
  id: 'admin-001',
  username: 'admin',
  password: bcrypt.hashSync('admin123', 10),
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
    auditLogs: [],
    inviteCodes: [],
    smsCodes: [],
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

function createUser(phone) {
  const config = cache.config;
  const user = {
    id: genId('u'),
    phone,
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

module.exports = {
  db: () => cache,
  load,
  save,
  saveNow,
  initDb,
  genId,
  findUserById,
  findUserByPhone,
  createUser,
  addCoinTransaction,
  findBottleById,
  getActiveBottles,
  findChatSessionById,
  findChatSessionByUsers,
  getPendingReportsCount,
  findAdminByUsername,
  findAdminById,
  addAuditLog,
  DEFAULT_CONFIG,
  USE_PG
};
