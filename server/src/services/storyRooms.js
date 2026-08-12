'use strict';

const { db, save, genId, findUserById } = require('../db');

const CATEGORIES = ['日常', '治愈', '悬疑', '都市', '古风', '校园', '爱情', '奇幻'];
const ROLE_GENDERS = ['any', 'male', 'female'];

function fail(error, status = 400) { return { success: false, error, status }; }
function text(value, max) { return String(value || '').trim().slice(0, max); }
function activeUser(user) { return !!(user && user.status === 'active'); }
function roomById(roomId) { return (db().storyRooms || []).find(room => room.id === roomId) || null; }
function roleForUser(room, userId) { return (room.roles || []).find(role => role.userId === userId) || null; }
function occupiedCount(room) { return (room.roles || []).filter(role => role.userId).length; }

function publicRoom(room, viewerId, detailed = false) {
  const host = findUserById(room.hostId) || {};
  const myRole = roleForUser(room, viewerId);
  const roles = (room.roles || []).map(role => {
    const occupant = role.userId ? findUserById(role.userId) : null;
    return {
      id: role.id,
      name: role.name,
      gender: role.gender,
      description: role.description || '',
      occupied: !!role.userId,
      mine: role.userId === viewerId,
      occupant: detailed && occupant ? { id: occupant.id, nickname: occupant.nickname || '岛友', avatar: occupant.avatar || '' } : null
    };
  });
  return {
    id: room.id,
    title: room.title,
    summary: room.summary,
    background: detailed ? room.background : '',
    category: room.category,
    cover: room.cover || '',
    status: room.status,
    host: { id: room.hostId, nickname: host.nickname || '岛友', avatar: host.avatar || '' },
    isHost: room.hostId === viewerId,
    isMember: !!myRole,
    myRoleId: myRole ? myRole.id : null,
    capacity: roles.length,
    occupiedCount: occupiedCount(room),
    full: roles.length > 0 && occupiedCount(room) === roles.length,
    roles: detailed ? roles : [],
    createdAt: room.createdAt,
    startedAt: room.startedAt || null,
    endedAt: room.endedAt || null
  };
}

function normalizeRoles(input) {
  if (!Array.isArray(input) || input.length < 3 || input.length > 10) return null;
  const roles = input.map((item, index) => ({
    id: genId('story-role'),
    name: text(item && item.name, 12),
    gender: ROLE_GENDERS.includes(item && item.gender) ? item.gender : 'any',
    description: text(item && item.description, 50),
    order: index,
    userId: null,
    joinedAt: null
  }));
  if (roles.some(role => !role.name)) return null;
  if (new Set(roles.map(role => role.name)).size !== roles.length) return null;
  return roles;
}

function createStoryRoom(user, input = {}, now = Date.now()) {
  if (!activeUser(user)) return fail('账号当前不可创建房间', 403);
  const title = text(input.title, 30);
  const summary = text(input.summary, 120);
  const background = text(input.background, 1200);
  const roles = normalizeRoles(input.roles);
  if (!title || !summary || !background) return fail('请完整填写标题、简介和剧情设定');
  if (!roles) return fail('请设置 3—10 个名称不重复的角色');
  const database = db();
  database.storyRooms = Array.isArray(database.storyRooms) ? database.storyRooms : [];
  const room = {
    id: genId('story-room'),
    hostId: user.id,
    title,
    summary,
    background,
    category: CATEGORIES.includes(input.category) ? input.category : '日常',
    cover: text(input.cover, 350000),
    roles,
    status: 'recruiting',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    endedAt: null
  };
  database.storyRooms.push(room);
  save();
  return { success: true, room: publicRoom(room, user.id, true) };
}

function listStoryRooms(viewer, options = {}) {
  const filter = ['all', 'recruiting', 'active', 'mine'].includes(options.filter) ? options.filter : 'all';
  let rooms = (db().storyRooms || []).filter(room => room.status !== 'ended');
  if (filter === 'recruiting') rooms = rooms.filter(room => room.status === 'recruiting');
  if (filter === 'active') rooms = rooms.filter(room => room.status === 'active');
  if (filter === 'mine') rooms = rooms.filter(room => room.hostId === viewer.id || roleForUser(room, viewer.id));
  rooms.sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
  return { success: true, rooms: rooms.slice(0, 100).map(room => publicRoom(room, viewer.id, false)) };
}

function getStoryRoom(viewer, roomId) {
  const room = roomById(roomId);
  if (!room || room.status === 'ended') return fail('房间不存在或已结束', 404);
  if (room.status === 'active' && room.hostId !== viewer.id && !roleForUser(room, viewer.id)) {
    return fail('剧情已经开场，暂不允许新成员进入', 403);
  }
  return { success: true, room: publicRoom(room, viewer.id, true) };
}

function selectStoryRole(user, roomId, roleId, now = Date.now()) {
  const room = roomById(roomId);
  if (!room || room.status === 'ended') return fail('房间不存在或已结束', 404);
  if (room.status !== 'recruiting') return fail('剧情已经开场，不能再选择角色', 409);
  if (roleForUser(room, user.id)) return fail('你已经选择过角色', 409);
  const role = (room.roles || []).find(item => item.id === roleId);
  if (!role) return fail('角色不存在', 404);
  if (role.userId) return fail('这个角色刚刚被其他岛友选走了', 409);
  if (role.gender !== 'any' && role.gender !== user.gender) return fail('当前角色设定与你的角色资料不符', 403);
  role.userId = user.id;
  role.joinedAt = now;
  room.updatedAt = now;
  save();
  return { success: true, room: publicRoom(room, user.id, true) };
}

function leaveStoryRoom(user, roomId, now = Date.now()) {
  const room = roomById(roomId);
  if (!room || room.status === 'ended') return fail('房间不存在或已结束', 404);
  if (room.status !== 'recruiting') return fail('剧情开场后不能退出角色', 409);
  const role = roleForUser(room, user.id);
  if (!role) return fail('你还没有选择角色', 409);
  role.userId = null;
  role.joinedAt = null;
  room.updatedAt = now;
  save();
  return { success: true, room: publicRoom(room, user.id, true) };
}

function startStoryRoom(user, roomId, now = Date.now()) {
  const room = roomById(roomId);
  if (!room || room.status === 'ended') return fail('房间不存在或已结束', 404);
  if (room.hostId !== user.id) return fail('只有房主可以启动剧情', 403);
  if (room.status !== 'recruiting') return fail('剧情已经开场', 409);
  if (!room.roles.length || occupiedCount(room) !== room.roles.length) return fail('角色尚未满员，暂时不能开场', 409);
  room.status = 'active';
  room.startedAt = now;
  room.updatedAt = now;
  db().storyRoomMessages = Array.isArray(db().storyRoomMessages) ? db().storyRoomMessages : [];
  db().storyRoomMessages.push({
    id: genId('story-msg'), roomId: room.id, senderId: null, type: 'system',
    content: '所有角色已就绪，剧情正式开场。', createdAt: now
  });
  save();
  return { success: true, room: publicRoom(room, user.id, true) };
}

function endStoryRoom(user, roomId, now = Date.now()) {
  const room = roomById(roomId);
  if (!room) return fail('房间不存在', 404);
  if (room.hostId !== user.id) return fail('只有房主可以结束剧情', 403);
  if (room.status === 'ended') return fail('剧情已经结束', 409);
  room.status = 'ended';
  room.endedAt = now;
  room.updatedAt = now;
  save();
  return { success: true };
}

function requireActiveMember(user, roomId) {
  const room = roomById(roomId);
  if (!room || room.status === 'ended') return { error: fail('房间不存在或已结束', 404) };
  if (room.status !== 'active') return { error: fail('剧情尚未开场', 409) };
  const role = roleForUser(room, user.id) || (room.hostId === user.id ? { name: '房主/旁白' } : null);
  if (!role) return { error: fail('你不是本房间成员', 403) };
  return { room, role };
}

function listStoryMessages(user, roomId, after = 0) {
  const membership = requireActiveMember(user, roomId);
  if (membership.error) return membership.error;
  const messages = (db().storyRoomMessages || [])
    .filter(message => message.roomId === roomId && Number(message.createdAt) > Number(after || 0))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-300)
    .map(message => {
      const senderRole = message.senderId ? roleForUser(membership.room, message.senderId) : null;
      return {
        id: message.id,
        type: message.type || 'text',
        content: message.content,
        createdAt: message.createdAt,
        mine: message.senderId === user.id,
        sender: message.senderId ? { id: message.senderId, roleName: senderRole ? senderRole.name : '岛友' } : null
      };
    });
  return { success: true, room: publicRoom(membership.room, user.id, true), messages };
}

function sendStoryMessage(user, roomId, content, now = Date.now()) {
  const membership = requireActiveMember(user, roomId);
  if (membership.error) return membership.error;
  const clean = text(content, 500);
  if (!clean) return fail('消息不能为空');
  const message = { id: genId('story-msg'), roomId, senderId: user.id, type: 'text', content: clean, createdAt: now };
  db().storyRoomMessages = Array.isArray(db().storyRoomMessages) ? db().storyRoomMessages : [];
  db().storyRoomMessages.push(message);
  membership.room.updatedAt = now;
  save();
  return { success: true, message: { ...message, mine: true, sender: { id: user.id, roleName: membership.role.name } } };
}

module.exports = {
  CATEGORIES, roomById, createStoryRoom, listStoryRooms, getStoryRoom, selectStoryRole,
  leaveStoryRoom, startStoryRoom, endStoryRoom, listStoryMessages, sendStoryMessage
};
