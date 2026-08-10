/* 验证 /api/admin/bots 路由不会因 botEngine.isAIConfigured 未定义而崩溃 */
const path = require('path');

// 内存数据 + 最小可运行依赖
const baseDir = path.resolve(__dirname);
const dbModulePath = path.join(baseDir, 'src', 'db.js');
const fakeDb = {
  db: () => ({
    config: { bot_daily_max_posts: 10, bot_daily_max_replies: 20 },
    botProfiles: [
      {
        botId: 'bot-1',
        userId: 'u-bot-1',
        displayName: '小漂',
        genderDisplay: '中性',
        personaPrompt: '',
        speakingStyle: '',
        activityWeight: 1,
        enabled: true,
        dailyPosts: 0,
        dailyReplies: 0
      }
    ],
    users: [{ id: 'u-bot-1', nickname: '小漂Bot' }],
    messages: [],
    bottles: [],
    auditLogs: [],
    coinTransactions: []
  }),
  save: () => {},
  genId: () => Math.random().toString(36).slice(2),
  findUserById: id => fakeDb.db().users.find(u => u.id === id),
  findBottleById: () => null,
  addCoinTransaction: () => {},
  addAuditLog: () => {},
  findAdminById: id => ({ id, username: 'admin' }),
  createBot: () => ({}),
  getBotProfiles: () => fakeDb.db().botProfiles,
  findBotProfileByBotId: () => null,
  updateBotProfile: () => null
};
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: fakeDb };

// 注入 botEngine（因为真实 botEngine 会在 require 时 startProactivePosts/seedBots）
const botEnginePath = path.join(baseDir, 'src', 'services', 'botEngine.js');
const fakeBotEngine = {
  getBotStats: () => ({ total: 1, enabled: 1, postsToday: 0, repliesToday: 0, csi: 0 })
};
require.cache[botEnginePath] = { id: botEnginePath, filename: botEnginePath, loaded: true, exports: fakeBotEngine };

// 注入 auth 中间件：直接放行
const authPath = path.join(baseDir, 'src', 'middleware', 'auth.js');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { adminAuth: (req, res, next) => next() }
};

// 注入 utils/jwt / crypto
const jwtPath = path.join(baseDir, 'src', 'utils', 'jwt.js');
require.cache[jwtPath] = { id: jwtPath, filename: jwtPath, loaded: true, exports: { signAdminToken: () => 'tok' } };
const cryptoPath = path.join(baseDir, 'src', 'utils', 'crypto.js');
require.cache[cryptoPath] = {
  id: cryptoPath, filename: cryptoPath, loaded: true,
  exports: { comparePassword: () => true, hashPassword: p => p }
};
const paymentPath = path.join(baseDir, 'src', 'services', 'payment.js');
require.cache[paymentPath] = {
  id: paymentPath, filename: paymentPath, loaded: true,
  exports: { PACKAGES: {}, refundOrder: () => {}, confirmPayment: () => {}, rejectOrder: () => {} }
};

const aiProviderPath = path.join(baseDir, 'src', 'services', 'aiProvider.js');
const realAiProvider = require(aiProviderPath);

const express = require('express');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('./src/routes/admin'));
  return app;
}

function request(app, method, url) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const http = require('http');
      const req = http.request({ method, host: '127.0.0.1', port, path: url, headers: { 'Content-Type': 'application/json' } }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, body }); }
        });
      });
      req.on('error', err => { server.close(); reject(err); });
      req.end();
    });
  });
}

async function runCase(label, env) {
  console.log(`\n=== ${label} ===`);
  const oldEnv = { ...process.env };
  Object.assign(process.env, env);
  // 清掉 require 缓存，让 aiProvider 重新读取环境变量
  delete require.cache[aiProviderPath];
  const app = makeApp();
  const r = await request(app, 'GET', '/api/admin/bots');
  Object.assign(process.env, oldEnv);
  for (const k of Object.keys(env)) delete process.env[k];
  console.log('status:', r.status);
  console.log('body:', JSON.stringify(r.body, null, 2));
  if (r.status !== 200 || !r.body.success) {
    throw new Error('route did not return success');
  }
  if (typeof r.body.aiConfigured !== 'boolean') {
    throw new Error('aiConfigured missing/not boolean');
  }
  if (!Array.isArray(r.body.bots) || r.body.bots.length !== 1) {
    throw new Error('bots array unexpected');
  }
  return r.body;
}

(async () => {
  try {
    // 未配置 Key：应返回 aiConfigured=false，aiProvider 可为 null（前端有 fallback）
    const noKey = await runCase('未配置 AI_API_KEY', {});
    if (noKey.aiConfigured !== false) throw new Error('expected aiConfigured=false without key');

    // 配置 Key：应返回 aiConfigured=true，且显示硅基默认模型
    const withKey = await runCase('已配置 AI_API_KEY', { AI_API_KEY: 'sk-test-xxx' });
    if (withKey.aiConfigured !== true) throw new Error('expected aiConfigured=true with key');
    if (!withKey.aiProvider || !withKey.aiProvider.includes('硅基流动')) {
      throw new Error('expected aiProvider to contain 硅基流动, got ' + withKey.aiProvider);
    }

    console.log('\nPASS');
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL:', e.message);
    process.exit(1);
  }
})();
