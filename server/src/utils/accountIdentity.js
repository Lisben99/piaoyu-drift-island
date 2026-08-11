const crypto = require('crypto');

function normalizeIdentity(type, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (type === 'phone') return normalized.replace(/\s+/g, '');
  return normalized;
}

function identityHash(type, value) {
  const normalized = normalizeIdentity(type, value);
  if (!normalized) return '';
  const secret = process.env.IDENTITY_HASH_SECRET || process.env.JWT_SECRET || 'drift-island-deleted-identity-v1';
  return crypto.createHmac('sha256', secret).update(`${type}:${normalized}`).digest('hex');
}

function hasDeletedIdentity(database, { phone = '', email = '' } = {}) {
  const records = Array.isArray(database && database.deletedIdentities) ? database.deletedIdentities : [];
  const hashes = [identityHash('phone', phone), identityHash('email', email)].filter(Boolean);
  return hashes.some(hash => records.some(record => record.hash === hash));
}

module.exports = { normalizeIdentity, identityHash, hasDeletedIdentity };
