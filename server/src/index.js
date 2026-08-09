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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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
    database: process.env.DATABASE_URL ? 'postgresql' : 'json_file'
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
    console.log(`  SMS Provider:      ${process.env.SMS_PROVIDER || 'dev (console output)'}`);
    console.log(`  Payment Provider:  ${process.env.PAYMENT_PROVIDER || 'dev (simulated)'}`);
    console.log(`  Moderation:        ${process.env.MODERATION_PROVIDER || 'local (keyword filter)'}`);
    console.log(`\n  Production env vars:`);
    console.log(`  SMS_PROVIDER=aliyun PAYMENT_PROVIDER=wechat MODERATION_PROVIDER=tencent DATABASE_URL=...`);
    console.log(`\n`);
  });
}

start().catch(e => {
  console.error('[Server] Failed to start:', e);
  process.exit(1);
});
