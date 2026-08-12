'use strict';

const assert = require('assert');
const { db, saveNow } = require('./src/db');
const rooms = require('./src/services/storyRooms');

const database = db();
const original = JSON.parse(JSON.stringify(database));
const host = { id: 'story-host', nickname: '房主', gender: 'male', status: 'active' };
const userA = { id: 'story-a', nickname: '岛友A', gender: 'female', status: 'active' };
const userB = { id: 'story-b', nickname: '岛友B', gender: 'male', status: 'active' };
const outsider = { id: 'story-out', nickname: '路人', gender: 'female', status: 'active' };

try {
  database.users = [host, userA, userB, outsider];
  database.storyRooms = [];
  database.storyRoomMessages = [];

  const created = rooms.createStoryRoom(host, {
    title: '海边旅店', summary: '三个陌生人在暴雨夜相遇', background: '每个人都藏着一个秘密。', category: '悬疑',
    roles: [{ name: '旅店老板', gender: 'male' }, { name: '旅行者', gender: 'female' }, { name: '记者', gender: 'male' }]
  }, 1000);
  assert.equal(created.success, true);
  const roomId = created.room.id;
  const [roleHost, roleA, roleB] = created.room.roles;

  assert.equal(rooms.startStoryRoom(host, roomId, 1100).success, false, 'not full cannot start');
  assert.equal(rooms.selectStoryRole(host, roomId, roleHost.id, 1200).success, true);
  assert.equal(rooms.selectStoryRole(userA, roomId, roleHost.id, 1300).status, 409, 'occupied role is atomic');
  assert.equal(rooms.selectStoryRole(userA, roomId, roleA.id, 1400).success, true);
  assert.equal(rooms.selectStoryRole(userB, roomId, roleB.id, 1500).success, true);
  assert.equal(rooms.startStoryRoom(userA, roomId, 1600).status, 403, 'only host starts');
  assert.equal(rooms.startStoryRoom(host, roomId, 1700).success, true);
  assert.equal(rooms.selectStoryRole(outsider, roomId, roleA.id, 1800).status, 409, 'started room is locked');
  assert.equal(rooms.getStoryRoom(outsider, roomId).status, 403, 'outsider cannot inspect locked room');
  assert.equal(rooms.sendStoryMessage(userA, roomId, '雨越来越大了。', 1900).success, true);
  assert.equal(rooms.listStoryMessages(userB, roomId).messages.length, 2, 'members receive system and role message');
  assert.equal(rooms.listStoryMessages(outsider, roomId).status, 403, 'outsider cannot read group chat');
  assert.equal(rooms.endStoryRoom(host, roomId, 2000).success, true);
  console.log('story rooms: core flow passed');
} finally {
  for (const key of Object.keys(database)) delete database[key];
  Object.assign(database, original);
  saveNow();
}
