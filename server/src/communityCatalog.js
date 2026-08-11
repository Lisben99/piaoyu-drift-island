'use strict';

const COMMUNITY_INTERESTS = Object.freeze([
  ['music', '音乐'], ['movie', '电影'], ['reading', '阅读'], ['photography', '摄影'],
  ['travel', '旅行'], ['solitude', '独处'], ['emotion', '情感'], ['citywalk', 'City Walk'],
  ['pets', '宠物'], ['games', '游戏'], ['sports', '运动'], ['food', '美食']
].map(([id, label]) => Object.freeze({ id, label })));

const COMMUNITY_MOODS = Object.freeze([
  ['calm', '平静', '🌙'], ['happy', '开心', '✨'], ['healing', '治愈', '🌿'],
  ['lonely', '孤独', '☁️'], ['hopeful', '期待', '🌤️'], ['thinking', '思考', '💭']
].map(([id, label, emoji]) => Object.freeze({ id, label, emoji })));

const COMMUNITY_TOPICS = Object.freeze(COMMUNITY_INTERESTS.map((item, index) => Object.freeze({
  id: item.id,
  label: item.label,
  description: ['分享此刻，让相似的灵魂听见你', '在共同喜好里遇见新朋友', '记录让你产生共鸣的一瞬'][index % 3]
})));

const DAILY_PROMPTS = Object.freeze([
  ['prompt-1', '最近哪一刻让你感到被治愈？', 'emotion'],
  ['prompt-2', '你今天循环播放的是哪首歌？', 'music'],
  ['prompt-3', '如果给今天起一个名字，会是什么？', 'emotion'],
  ['prompt-4', '最近想独自去哪里走一走？', 'travel'],
  ['prompt-5', '分享一件让你重新期待生活的小事', 'solitude'],
  ['prompt-6', '哪部电影曾在某个时刻懂得你？', 'movie'],
  ['prompt-7', '此刻最想对陌生人说的一句话是什么？', 'solitude']
].map(([id, text, topicId]) => Object.freeze({ id, text, topicId })));

function chinaDateKey(now = Date.now()) {
  return new Date(Number(now) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getTodayPrompt(now = Date.now()) {
  const dateKey = chinaDateKey(now);
  const dayNumber = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86400000);
  return { ...DAILY_PROMPTS[Math.abs(dayNumber) % DAILY_PROMPTS.length], dateKey };
}

function listCommunityTopics() { return COMMUNITY_TOPICS.map(item => ({ ...item })); }
function isInterestId(id) { return COMMUNITY_INTERESTS.some(item => item.id === id); }
function isTopicId(id) { return COMMUNITY_TOPICS.some(item => item.id === id); }
function isMoodId(id) { return COMMUNITY_MOODS.some(item => item.id === id); }

module.exports = {
  COMMUNITY_INTERESTS, COMMUNITY_MOODS, COMMUNITY_TOPICS, DAILY_PROMPTS,
  listCommunityTopics, getTodayPrompt, isInterestId, isTopicId, isMoodId
};
