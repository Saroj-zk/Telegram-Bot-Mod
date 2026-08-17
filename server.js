require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const bot = require('./bot');

// ---------- Single-instance lock ----------
// Two copies of this app polling the same bot token causes Telegram 409
// conflicts (only one getUpdates poller is allowed). Refuse to start a second
// instance so a stray `npm run dev` can't silently break the running bot.
const LOCK_PATH = path.join(__dirname, 'db', '.octogod.lock');
function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
(function acquireInstanceLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10);
      if (isProcessAlive(oldPid) && oldPid !== process.pid) {
        console.error(`\n❌ OctoGod is already running (PID ${oldPid}).`);
        console.error(`   Running a second copy would break the bot with a Telegram 409 conflict.`);
        console.error(`   Stop the other one first, or delete ${LOCK_PATH} if it's stale.\n`);
        process.exit(1);
      }
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid));
    const release = () => { try { if (fs.existsSync(LOCK_PATH) && parseInt(fs.readFileSync(LOCK_PATH, 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK_PATH); } catch (e) {} };
    process.on('exit', release);
    process.on('SIGINT', () => { release(); process.exit(0); });
    process.on('SIGTERM', () => { release(); process.exit(0); });
  } catch (e) {
    // FS problems shouldn't block startup — just warn.
    console.error('Could not acquire instance lock:', e.message);
  }
})();

const app = express();
const server = http.createServer(app);

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1'; // bind to loopback by default
const COOKIE_NAME = 'octogod_session';
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds
const TRUSTED_PROXY = (process.env.TRUSTED_PROXY || '').toLowerCase() === 'true';

// ---------- Security middleware ----------
app.disable('x-powered-by');
if (TRUSTED_PROXY) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self' ws: wss:");
  next();
});

// CORS — only same-origin by default. Allow override via env.
const allowedOrigin = process.env.DASHBOARD_ORIGIN || false;
app.use(cors({ origin: allowedOrigin || false, credentials: true }));

app.use(express.json({ limit: '256kb' }));

// Disable browser caching for the dashboard assets so a code update is
// reflected on the next refresh — important during active development.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  cacheControl: false,
  setHeaders(res) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ---------- Initialize all configured bots ----------
// Old single-token deployments had TELEGRAM_BOT_TOKEN in .env; migrate that
// into db/bots.json the first time so we converge on one storage location.
if (config.migrateEnvTokenIfNeeded()) {
  config.logEvent('INFO', 'Migrated .env TELEGRAM_BOT_TOKEN into db/bots.json');
}
const _configuredBots = config.listBotRecords();
if (_configuredBots.length === 0) {
  config.logEvent('WARN', 'No bots configured. Add one via the dashboard.');
} else {
  for (const rec of _configuredBots) {
    bot.initBot(rec.token, { name: rec.name });
  }
}

// ---------- Auth helpers ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

function setSessionCookie(res, token) {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict'
  ];
  if (TRUSTED_PROXY) flags.push('Secure');
  res.set('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(res) {
  res.set('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
}

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const session = token ? config.validateSession(token) : null;
  if (!session) return res.status(401).json({ success: false, error: 'unauthorized' });
  req.user = session;
  req.sessionToken = token;
  next();
}

// Brute-force protection on /api/login
const loginAttempts = {}; // { ip: { count, lockedUntil } }
function loginRateLimit(req, res, next) {
  const ip = (req.ip || req.connection.remoteAddress || 'unknown').replace('::ffff:', '');
  const rec = loginAttempts[ip] || { count: 0, lockedUntil: 0 };
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const wait = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ success: false, error: `too_many_attempts`, retry_after: wait });
  }
  // Reset old records
  if (rec.count > 0 && Date.now() - (rec.lastAt || 0) > 10 * 60 * 1000) {
    rec.count = 0;
  }
  req._loginRec = rec;
  loginAttempts[ip] = rec;
  next();
}
function recordLoginFailure(req) {
  const rec = req._loginRec;
  rec.count++;
  rec.lastAt = Date.now();
  if (rec.count >= 6) {
    rec.lockedUntil = Date.now() + 15 * 60 * 1000;
    rec.count = 0;
    config.logEvent('WARN', `Dashboard login locked for IP ${req.ip} (15 min)`);
  }
}
function clearLoginFailures(req) {
  const rec = req._loginRec;
  if (rec) { rec.count = 0; rec.lockedUntil = 0; }
}

// ---------- Socket.io with auth ----------
const io = new Server(server, {
  cors: { origin: allowedOrigin || false, credentials: true },
  allowRequest(req, callback) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token || !config.validateSession(token)) return callback('unauthorized', false);
    callback(null, true);
  }
});

io.on('connection', (socket) => {
  config.logEvent('INFO', `Dashboard client connected: ${socket.id}`);
  socket.emit('init_logs', config.getLogs());
  socket.emit('stats_update', config.loadData().stats);
  socket.on('disconnect', () => {
    config.logEvent('INFO', `Dashboard client disconnected: ${socket.id}`);
  });
});

config.registerLogCallback((logEntry) => {
  io.emit('log', logEntry);
  io.emit('stats_update', config.loadData().stats);
});

// Push a `data_update` to every connected dashboard so the User Database tab
// (warnings + bans tables) refetches the moment something changes — no manual
// refresh needed.
config.registerDataCallback(() => {
  io.emit('data_update');
});

// Stream routine-scan progress to all connected dashboards as the scan runs.
bot.registerScanProgress((payload) => {
  io.emit('scan_progress', payload);
});

// ---------- Public auth endpoints ----------
app.get('/api/auth-status', (req, res) => {
  const token = getSessionToken(req);
  const session = token ? config.validateSession(token) : null;
  res.json({
    adminExists: config.adminExists(),
    loggedIn: !!session,
    username: session ? session.username : null
  });
});

app.post('/api/create-admin', (req, res) => {
  if (config.adminExists()) {
    return res.status(403).json({ success: false, error: 'admin_already_exists' });
  }
  const { username, password } = req.body || {};
  const r = config.createAdmin(username, password);
  if (!r.ok) return res.status(400).json({ success: false, error: r.error });
  const token = config.createSession(username.trim());
  setSessionCookie(res, token);
  res.json({ success: true });
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!config.adminExists()) {
    return res.status(400).json({ success: false, error: 'no_admin' });
  }
  if (!config.verifyAdmin(username, password)) {
    recordLoginFailure(req);
    return res.status(401).json({ success: false, error: 'invalid_credentials' });
  }
  clearLoginFailures(req);
  const token = config.createSession(username);
  setSessionCookie(res, token);
  config.logEvent('INFO', `Admin logged in: ${username}`);
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) config.destroySession(token);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const r = config.changeAdminPassword(currentPassword, newPassword);
  if (!r.ok) return res.status(400).json({ success: false, error: r.error });
  res.json({ success: true });
});

// ---------- Protected API ----------
app.get('/api/log-levels', requireAuth, (req, res) => {
  res.json(config.LOG_LEVELS);
});

app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    online: bot.getBotStatus(),
    hasToken: config.listBotRecords().length > 0,   // legacy flag — true if ANY bot exists
    botCount: bot.listBots().length,
    levels: config.LOG_LEVELS
  });
});

// -------- Multi-bot management --------
app.get('/api/bots', requireAuth, (req, res) => {
  const stored = config.publicBotRecords();
  const live = bot.listBots();
  const liveById = new Map(live.map(b => [String(b.id), b]));
  // Merge: every stored bot (token saved) plus any live runtime info.
  res.json(stored.map(s => {
    const l = liveById.get(s.id);
    return {
      id: s.id,
      name: s.name || (l && l.name) || null,
      username: l ? l.username : null,
      first_name: l ? l.first_name : null,
      addedAt: s.addedAt,
      canReadAllMessages: l ? l.canReadAllMessages : null,
      online: !!l
    };
  }));
});

app.post('/api/bots', requireAuth, (req, res) => {
  const { token, name } = req.body || {};
  if (typeof token !== 'string' || !config.BOT_TOKEN_RE.test(token.trim())) {
    return res.status(400).json({ success: false, error: 'invalid_token_format' });
  }
  const trimmed = token.trim();
  const r = config.addBotRecord(trimmed, name);
  if (!r.ok) return res.status(400).json({ success: false, error: r.error });
  bot.initBot(trimmed, { name: name || null });
  io.emit('status_change', { online: true });
  io.emit('data_update');
  // botInfo isn't ready synchronously; return what we have now.
  res.json({ success: true, id: trimmed.split(':')[0] });
});

app.delete('/api/bots/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '').replace(/[^0-9]/g, '');
  if (!id) return res.status(400).json({ success: false, error: 'invalid_id' });
  bot.stopBot(parseInt(id, 10));
  const removed = config.removeBotRecord(id);
  if (!removed) return res.status(404).json({ success: false, error: 'not_found' });
  io.emit('status_change', { online: bot.getBotStatus() });
  io.emit('data_update');
  res.json({ success: true });
});

app.post('/api/bots/:id/restart', requireAuth, (req, res) => {
  const id = String(req.params.id || '').replace(/[^0-9]/g, '');
  if (!id) return res.status(400).json({ success: false, error: 'invalid_id' });
  const rec = config.listBotRecords().find(b => b.token.startsWith(id + ':'));
  if (!rec) return res.status(404).json({ success: false, error: 'not_found' });
  bot.stopBot(parseInt(id, 10));
  bot.initBot(rec.token, { name: rec.name });
  io.emit('status_change', { online: true });
  res.json({ success: true });
});

app.post('/api/bots/:id/stop', requireAuth, (req, res) => {
  const id = String(req.params.id || '').replace(/[^0-9]/g, '');
  if (!id) return res.status(400).json({ success: false, error: 'invalid_id' });
  const ok = bot.stopBot(parseInt(id, 10));
  io.emit('status_change', { online: bot.getBotStatus() });
  res.json({ success: ok });
});

app.get('/api/settings', requireAuth, (req, res) => {
  res.json(config.loadSettings());
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const sanitized = config.sanitizeSettings(req.body);
    if (!sanitized) return res.status(400).json({ success: false, error: 'invalid_payload' });
    config.saveSettings(sanitized);
    res.json({ success: true, settings: config.loadSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/data', requireAuth, (req, res) => {
  const currentData = config.loadData();
  res.json({
    stats: currentData.stats,
    warnings: currentData.warnings,
    bans: currentData.bans,
    mutes: currentData.mutes
  });
});

const TOKEN_FORMAT_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;

// Legacy /api/setup — kept for the initial setup wizard. Adds the first bot.
app.post('/api/setup', requireAuth, (req, res) => {
  const { token, name } = req.body || {};
  if (typeof token !== 'string' || !config.BOT_TOKEN_RE.test(token.trim())) {
    return res.status(400).json({ success: false, error: 'invalid_token_format' });
  }
  const trimmed = token.trim();
  const r = config.addBotRecord(trimmed, name);
  if (!r.ok) return res.status(400).json({ success: false, error: r.error });
  bot.initBot(trimmed, { name: name || null });
  io.emit('status_change', { online: true });
  res.json({ success: true, message: 'Bot added and starting.' });
});

// Stop ALL bots
app.post('/api/action/stop', requireAuth, (req, res) => {
  bot.stopBot();
  io.emit('status_change', { online: false, hasToken: config.listBotRecords().length > 0 });
  res.json({ success: true, message: 'All bots stopped.' });
});

// Restart ALL bots — stop everything, re-launch from stored records.
app.post('/api/action/restart', requireAuth, (req, res) => {
  bot.stopBot();
  const recs = config.listBotRecords();
  if (recs.length === 0) {
    return res.status(400).json({ success: false, error: 'No bots configured.' });
  }
  for (const rec of recs) bot.initBot(rec.token, { name: rec.name });
  io.emit('status_change', { online: true });
  res.json({ success: true, message: `${recs.length} bot(s) restarting.` });
});

app.post('/api/action/routine-scan', requireAuth, async (req, res) => {
  const hours = req.body && req.body.hours !== undefined ? parseInt(req.body.hours, 10) : undefined;
  try {
    const result = await bot.runRoutineScan({ hours, trigger: 'dashboard' });
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    io.emit('data_update');
    res.json({ success: true, summary: result.summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------- Groups the bot is in (+ per-group rule overrides) --------
app.get('/api/chats', requireAuth, (req, res) => {
  const chats = config.getKnownChats();
  const list = Object.entries(chats).map(([id, c]) => ({
    id,
    title: c.title || null,
    type: c.type || null,
    memberCount: c.memberCount !== undefined ? c.memberCount : null,
    botIsAdmin: c.botIsAdmin === undefined ? null : !!c.botIsAdmin,
    canDelete: c.canDelete === undefined ? null : !!c.canDelete,
    canBan: c.canBan === undefined ? null : !!c.canBan,
    messagesSeen: c.messagesSeen || 0,
    actionsTaken: c.actionsTaken || 0,
    firstSeen: c.firstSeen || null,
    lastSeen: c.lastSeen || null,
    overrides: c.overrides || {},
    hasOverrides: !!(c.overrides && Object.keys(c.overrides).length)
  })).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  res.json({ count: list.length, chats: list });
});

// Pull fresh titles / member counts from Telegram, and prune dead groups.
app.post('/api/chats/refresh', requireAuth, async (req, res) => {
  try {
    const r = await bot.refreshChats();
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    io.emit('data_update');
    res.json({ success: true, results: r.results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chats/:id/overrides', requireAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ success: false, error: 'invalid_chat_id' });
  try {
    const saved = config.setChatOverrides(id, req.body && req.body.overrides);
    io.emit('data_update');
    res.json({ success: true, overrides: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/chats/:id/overrides', requireAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ success: false, error: 'invalid_chat_id' });
  const ok = config.clearChatOverrides(id);
  io.emit('data_update');
  res.json({ success: ok });
});

app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!/^-?\d+$/.test(id)) return res.status(400).json({ success: false, error: 'invalid_chat_id' });
  const ok = config.removeChat(id);
  io.emit('data_update');
  res.json({ success: ok });
});

app.get('/api/scans', requireAuth, (req, res) => {
  res.json(config.getScanHistory());
});

app.post('/api/action/unban', requireAuth, async (req, res) => {
  const userId = parseInt(req.body && req.body.userId, 10);
  const chatId = req.body && req.body.chatId ? parseInt(req.body.chatId, 10) : null;
  if (!userId || isNaN(userId)) return res.status(400).json({ success: false, error: 'invalid_user_id' });
  try {
    const r = await bot.unbanUser(userId, chatId);
    if (r.ok) {
      io.emit('data_update');
      return res.json({ success: true, message: r.message });
    }
    res.status(400).json({ success: false, error: r.error });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/action/clear-warns', requireAuth, (req, res) => {
  const userId = parseInt(req.body && req.body.userId, 10);
  if (!userId || isNaN(userId)) return res.status(400).json({ success: false, error: 'invalid_user_id' });
  const cleared = config.clearWarnings(userId);
  if (cleared) {
    io.emit('data_update');
    res.json({ success: true, message: 'Warnings cleared.' });
  } else {
    res.status(404).json({ success: false, error: 'User warnings not found.' });
  }
});

// Catch-all 404 for unknown /api/* routes
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'not_found' }));

// Process-level safety nets — never let one bad update crash the server.
process.on('uncaughtException', (err) => {
  config.logEvent('ERROR', `uncaughtException: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.message ? reason.message : String(reason);
  config.logEvent('ERROR', `unhandledRejection: ${msg}`);
});

server.listen(PORT, HOST, () => {
  config.logEvent('INFO', `Dashboard server listening on http://${HOST}:${PORT}`);
});
