/**
 * Drift Island API Server
 * 
 * Entry point - configures Express, WebSocket, and all routes
 */
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
// Original photos are compressed in the browser; leave enough room for HD covers
// and multi-image moments after compression.
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve static files (frontend)
const webRoot = path.join(__dirname, '..', '..');
app.use(express.static(webRoot, {
  setHeaders: (res, path) => {
    // No cache for HTML files
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Initialize WebSocket
const wsService = require('./services/websocket');
wsService.init(server);

// Bot engine (cold-start bot pool) — seeded + scheduled on startup
const botEngine = require('./services/botEngine');

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bottles', require('./routes/bottles'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/coins', require('./routes/coins'));
app.use('/api/recharge', require('./routes/recharge'));
app.use('/api/invite', require('./routes/invite'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/reports', require('./routes/report'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/moments', require('./routes/moments'));
app.use('/api/community', require('./routes/community'));
app.use('/api/follow', require('./routes/follow'));
app.use('/api/visits', require('./routes/visits'));
app.use('/api/interactions', require('./routes/interactions'));
app.use('/api/blacklist', require('./routes/blacklist'));
app.use('/api/support', require('./routes/support').user);
app.use('/api/admin', require('./routes/admin'));
const redeemRoutes = require('./routes/redeem');
app.use('/api/admin', redeemRoutes.admin);
app.use('/api/admin', require('./routes/support').admin);
app.use('/api/redeem', redeemRoutes.user);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    sms_provider: process.env.SMS_PROVIDER || 'dev',
    email_provider: process.env.EMAIL_PROVIDER || 'dev',
    payment_provider: process.env.PAYMENT_PROVIDER || 'dev',
    redeem_provider: 'cardcode',
    moderation_provider: process.env.MODERATION_PROVIDER || 'local',
    database: process.env.DATABASE_URL ? 'postgresql' : 'json_file',
    // Render 每次部署自动注入的提交信息，用于确认线上跑的是哪次代码
    deployCommit: process.env.RENDER_GIT_COMMIT || null,
    deployBranch: process.env.RENDER_GIT_BRANCH || null
  });
});

// Default route to index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API not found' });
  }
  if (req.path === '/admin' || req.path === '/admin.html') {
    return res.sendFile(path.join(webRoot, 'admin.html'));
  }
  res.sendFile(path.join(webRoot, 'index.html'));
});

const PORT = process.env.PORT || 3000;

// Initialize database (async for PostgreSQL) then start server
const { initDb, USE_PG } = require('./db');

async function start() {
  if (USE_PG) {
    console.log('[Server] Initializing PostgreSQL database...');
    await initDb();
    console.log('[Server] Database ready.');
  }

  // Seed bots + start proactive-post scheduler (db must be loaded first).
  botEngine.init();

  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Drift Island Server running on port ${PORT}`);
    console.log(`  User app:  http://localhost:${PORT}/`);
    console.log(`  Admin:     http://localhost:${PORT}/admin.html`);
    console.log(`  Health:    http://localhost:${PORT}/api/health`);
    console.log(`========================================\n`);
    console.log(`  Database:          ${USE_PG ? 'PostgreSQL' : 'JSON file'}`);
    const smsMode = process.env.SMS_PROVIDER || 'dev';
    const smsCreds = !!(process.env.ALIYUN_SMS_KEY && process.env.ALIYUN_SMS_SECRET);
    const smsSign = process.env.ALIYUN_SMS_SIGN || '恒创联众(系统赠送)';
    const smsTpl = process.env.ALIYUN_SMS_TEMPLATE || '100001(系统赠送)';
    console.log(`  SMS Provider:      ${smsMode}${smsMode === 'aliyun' ? (smsCreds ? ' ✓ 密钥已配置' : ' ✗ 缺少 ALIYUN_SMS_KEY/SECRET（将回退 dev）') : ' (本地验证码)'}`);
    if (smsMode === 'aliyun') console.log(`  SMS Sign/Template: ${smsSign} / ${smsTpl}`);
    const emailMode = process.env.EMAIL_PROVIDER || 'dev';
    const resendCreds = !!process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM || '漂屿 <onboarding@resend.dev>';
    console.log(`  Email Provider:    ${emailMode}${emailMode === 'resend' ? (resendCreds ? ' ✓ RESEND_API_KEY 已配置' : ' ✗ 缺少 RESEND_API_KEY（将回退 dev）') : ''}`);
    if (emailMode === 'resend') console.log(`  Email From:        ${emailFrom}`);
    console.log(`  Payment Provider:  ${process.env.PAYMENT_PROVIDER || 'dev (simulated)'}`);
    console.log(`  Moderation:        ${process.env.MODERATION_PROVIDER || 'local (keyword filter)'}`);
    console.log(`\n  Production env vars:`);
    console.log(`  SMS_PROVIDER=aliyun EMAIL_PROVIDER=resend RESEND_API_KEY=... EMAIL_FROM=... DATABASE_URL=...`);
    console.log(`\n`);
  });
}

start().catch(e => {
  console.error('[Server] Failed to start:', e);
  process.exit(1);
});
