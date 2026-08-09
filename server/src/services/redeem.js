/**
 * Card-code (兑换码) recharge service.
 *
 * Personal-account friendly alternative to WeChat Pay: the operator generates
 * batches of one-time redeem codes (each grants N 漂流币), distributes them via
 * any channel (e.g. sold as "卡密"), and users redeem them in-app to receive coins.
 *
 * No external payment provider / merchant account required.
 */

const crypto = require('crypto');
const db = require('../db');

// 32-char alphabet without ambiguous glyphs (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSegment(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// Normalize a user-entered code to its canonical key (uppercase, keep only A-Z0-9).
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Build a display code. Optional prefix (<=6 alphanumerics) + 4x4 body.
function buildCode(prefix) {
  const p = (prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const body = `${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
  return p ? `${p}-${body}` : body;
}

/**
 * Admin: generate a batch of redeem codes.
 * @param {object} opts
 * @param {number} opts.coins      coins granted per code (>=1)
 * @param {number} opts.count      number of codes to generate (>=1, <=500)
 * @param {string} [opts.prefix]   optional code prefix
 * @param {string} [opts.note]     operator note / batch remark
 * @param {string} opts.createdBy  admin id
 * @returns {{success:boolean, codes?:Array, error?:string}}
 */
function generateCodes({ coins, count, prefix, note, createdBy }) {
  const coinsNum = parseInt(coins, 10);
  const countNum = parseInt(count, 10);
  if (!coinsNum || coinsNum < 1) {
    return { success: false, error: '面额必须为正整数' };
  }
  if (!countNum || countNum < 1 || countNum > 500) {
    return { success: false, error: '生成数量需为 1-500 之间的整数' };
  }

  const batch = db.genId('rcb');
  const existing = new Set(db.getRedeemCodes().map(r => r.codeKey));
  const created = [];

  for (let i = 0; i < countNum; i++) {
    let code, key;
    let guard = 0;
    do {
      code = buildCode(prefix);
      key = normalizeCode(code);
      guard++;
    } while (existing.has(key) && guard < 20);

    // Survive an (extremely unlikely) collision by suffixing the key
    if (existing.has(key)) key = key + i;

    const record = {
      id: db.genId('rc'),
      batch,
      code,
      codeKey: key,
      coins: coinsNum,
      status: 'unused', // unused | used
      createdBy,
      note: note || '',
      createdAt: Date.now(),
      usedBy: null,
      usedAt: null
    };
    db.addRedeemCode(record);
    existing.add(key);
    created.push(record);
  }

  return { success: true, batch, count: created.length, codes: created };
}

/**
 * User: redeem a code.
 * @param {string} userId
 * @param {string} rawCode
 * @returns {{success:boolean, coins?:number, balance?:number, error?:string}}
 */
function redeemCode(userId, rawCode) {
  const key = normalizeCode(rawCode);
  if (key.length < 8) {
    return { success: false, error: '兑换码格式不正确' };
  }

  const record = db.findRedeemCodeByKey(key);
  if (!record) {
    return { success: false, error: '兑换码不存在或已失效' };
  }
  if (record.status === 'used') {
    return { success: false, error: '该兑换码已被使用' };
  }

  record.status = 'used';
  record.usedBy = userId;
  record.usedAt = Date.now();

  const tx = db.addCoinTransaction(userId, record.coins, 'redeem', `兑换码充值 +${record.coins} 枚`, record.id);
  const user = db.findUserById(userId);

  return {
    success: true,
    coins: record.coins,
    balance: user ? user.coins : tx.amount,
    code: record.code
  };
}

/**
 * Admin: list redeem codes (newest first), optional status filter.
 */
function listCodes({ status, page = 1, pageSize = 50 } = {}) {
  let codes = db.getRedeemCodes();
  if (status && status !== 'all') {
    codes = codes.filter(c => c.status === status);
  }
  codes = codes.slice().sort((a, b) => b.createdAt - a.createdAt);
  const total = codes.length;
  const start = (parseInt(page, 10) - 1) * parseInt(pageSize, 10);
  const paged = codes.slice(start, start + parseInt(pageSize, 10)).map(c => {
    let usedByPhone = '';
    if (c.usedBy) {
      const u = db.findUserById(c.usedBy);
      usedByPhone = u ? u.phone : '未知';
    }
    return { ...c, usedByPhone };
  });
  return { success: true, codes: paged, total };
}

module.exports = { normalizeCode, generateCodes, redeemCode, listCodes };
