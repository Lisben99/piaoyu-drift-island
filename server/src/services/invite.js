/**
 * Invite service: grant rewards when a new user registers with an invite code.
 * - Records the invite relationship (invitedBy) on the new user.
 * - Awards the invitee a one-time "invited" bonus.
 * - Awards the inviter an "invite" bonus, subject to the monthly invite limit.
 */
const { db, addCoinTransaction, findUserByInviteCode, save } = require('../db');

function monthStartTs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

/**
 * Apply invite reward for a freshly created user.
 * @param {object} newUser  the just-created user object
 * @param {string} inviteCodeRaw  invite code entered during registration
 * @returns {object|null} invite result info for the client, or null if no code
 */
function applyInvite(newUser, inviteCodeRaw) {
  if (!inviteCodeRaw) return null;
  const code = String(inviteCodeRaw).trim().toLowerCase();
  if (!code) return null;

  const inviter = findUserByInviteCode(code);
  if (!inviter) return { applied: false, reason: 'invalid' };
  if (inviter.id === newUser.id) return { applied: false, reason: 'self' };

  const config = db().config;

  // Count inviter's existing invites THIS month (exclude the new user, whose
  // invitedBy is still null at this point).
  const monthStart = monthStartTs();
  const monthInvites = db().users.filter(
    u => u.invitedBy === inviter.id && u.createdAt >= monthStart
  ).length;

  // Bind the relationship (new users always start with invitedBy = null).
  newUser.invitedBy = inviter.id;
  newUser.inviteRewardEligible = monthInvites < config.invite_monthly_limit;

  // Invitee reward — always granted on a valid invite.
  const inviteeBonus = Number(config.invited_bonus) || 0;
  if (inviteeBonus > 0) {
    addCoinTransaction(newUser.id, inviteeBonus, 'invited', '受邀注册奖励');
  }

  // Inviter reward — only if under the monthly limit.
  let inviterBonus = 0;
  let overLimit = false;
  if (monthInvites < config.invite_monthly_limit) {
    inviterBonus = Number(config.invite_bonus) || 0;
    if (inviterBonus > 0) {
      addCoinTransaction(inviter.id, inviterBonus, 'invite', '邀请好友奖励');
    }
    inviter.totalInvited = (inviter.totalInvited || 0) + 1;
  } else {
    overLimit = true;
  }

  save();

  return {
    applied: true,
    inviteeBonus,
    inviterBonus,
    overLimit,
    inviterNickname: inviter.nickname || inviter.phone || inviter.email || '好友'
  };
}

module.exports = { applyInvite };
