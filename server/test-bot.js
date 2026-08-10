/**
 * Bot 私聊 AI 回复 — 集成测试（drift-island-web）
 *
 * 用 require 缓存注入内存版 db / websocket / moderation，避免依赖真实
 * PostgreSQL 与外部审核服务。mock fetch 拦截硅基请求，只验证「请求里
 * 拼了什么」+「回复是否落库 + 实时投递」。
 *
 * 覆盖本次加固点：
 *   - runChatReply 把「当前这条人类消息」从 history 排除，改由 message 参数传入
 *   - aiProvider chat 模式把 message 追加为最后一条 user（不重复、不遗漏）
 *   - 回复落库到 messages，并通过 sendToUser 实时投递 message_received
 */
const path = require('path');

process.env.AI_API_KEY = process.env.AI_API_KEY || 'sk-test-placeholder';

// ---- 内存数据 ----
const store = {
  config: {
    enable_bot: true,
    enable_bot_private_chat: true,
    enable_ai_reply: true,
    enable_content_moderation: false,
    bot_chat_reply_delay_min_seconds: 1,
    bot_chat_reply_delay_max_seconds: 1,
    bot_daily_max_replies: 200
  },
  chatSessions: [{ id: 'sess1', userA: 'human1', userB: 'bot1', status: 'active', lastMessageAt: 0 }],
  messages: [
    { id: 'm1', sessionId: 'sess1', senderId: 'human1', content: '在吗', createdAt: 1000 },
    { id: 'm2', sessionId: 'sess1', senderId: 'bot1', content: '在的，怎么了', createdAt: 2000 },
    { id: 'm3', sessionId: 'sess1', senderId: 'human1', content: '今天好累啊', createdAt: 3000 } // 当前消息
  ],
  users: [
    { id: 'human1', account_type: 'HUMAN' },
    { id: 'bot1', account_type: 'BOT' }
  ],
  botProfiles: [
    { botId: 'b1', userId: 'bot1', enabled: true, personaPrompt: '你是温柔树洞，安静倾听', dailyReplies: 0, dailyMaxReplies: 200, dailyPosts: 0 }
  ]
};

const fakeDb = {
  db: () => store,
  save: () => {},
  genId: (p) => (p || 'id') + Math.random().toString(36).slice(2, 8),
  findBottleById: () => null,
  findUserById: (id) => store.users.find(u => u.id === id) || null,
  getBotProfiles: () => store.botProfiles,
  getEnabledBots: () => store.botProfiles.filter(b => b.enabled),
  recordBotActivity: () => {},
  seedBotsIfNeeded: () => {}
};

let sent = [];
const fakeWs = { sendToUser: (userId, payload) => { sent.push({ userId, payload }); } };
const fakeMod = { moderate: async () => ({ pass: true }) };

// ---- 注入缓存（必须在 require botEngine 之前）----
function inject(absPath, exports) {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
}
inject(require.resolve('./src/db', { paths: [__dirname] }), fakeDb);
inject(require.resolve('./src/services/moderation', { paths: [__dirname] }), fakeMod);
inject(require.resolve('./src/services/websocket', { paths: [__dirname] }), fakeWs);

// ---- mock fetch 拦截硅基 ----
let lastReq = null;
const REAL_FETCH = global.fetch;
global.fetch = async (url, opts) => {
  lastReq = { url, opts };
  return { ok: true, json: async () => ({ choices: [{ message: { content: '“今天也辛苦啦。”' } }] }) };
};

const botEngine = require('./src/services/botEngine');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅', name, extra || ''); }
  else { fail++; console.log('  ❌', name, extra || ''); }
}

(async () => {
  console.log('\n=== Bot 私聊 AI 回复集成测试 ===');
  const beforeCount = store.messages.length;
  botEngine.scheduleChatReply('sess1', 'human1', '今天好累啊');

  // 等待 delay(1s) + 异步 runChatReply 完成
  const start = Date.now();
  while (sent.length === 0 && Date.now() - start < 4000) {
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n--- 落库 & 投递 ---');
  const botMsg = store.messages.find(m => m.senderId === 'bot1' && m.sessionId === 'sess1' && m.id !== 'm2');
  check('回复已落库（messages 增加一条 bot 消息）', store.messages.length === beforeCount + 1, 'len ' + beforeCount + '→' + store.messages.length);
  check('bot 回复内容非空（来自 AI 模拟）', !!botMsg && !!botMsg.content, '=> ' + (botMsg && botMsg.content));
  check('通过 sendToUser 实时投递 message_received', sent.length === 1 && sent[0].payload.type === 'message_received', 'sent=' + sent.length);
  check('投递 payload 含 sessionId + bot senderId', sent[0] && sent[0].payload.data.sessionId === 'sess1' && sent[0].payload.data.senderId === 'bot1');

  console.log('\n--- 发给硅基的请求（加固点验证）---');
  const body = lastReq && JSON.parse(lastReq.opts.body);
  const msgs = body && body.messages;
  const lastUser = msgs && msgs[msgs.length - 1];
  check('最后一条是 user=当前消息「今天好累啊」', lastUser && lastUser.role === 'user' && lastUser.content === '今天好累啊', '=> ' + (lastUser && lastUser.content));
  const currentCount = msgs ? msgs.filter(m => m.role === 'user' && m.content === '今天好累啊').length : 0;
  check('当前消息无重复（只出现 1 次）', currentCount === 1, 'count=' + currentCount);
  check('历史消息仍在（在吗 / 在的，怎么了）', msgs && msgs.some(m => m.role === 'user' && m.content === '在吗') && msgs.some(m => m.role === 'assistant' && m.content === '在的，怎么了'));
  check('persona（温柔树洞）进入系统提示', msgs && msgs[0].content.includes('温柔树洞'));

  console.log(`\n--- 结果：${pass} 通过 / ${fail} 失败 ---`);
  global.fetch = REAL_FETCH;
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); global.fetch = REAL_FETCH; process.exit(2); });
