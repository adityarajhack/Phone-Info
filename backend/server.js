require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const db = require('./database');
const { bot, notifyAdmin, logAudit } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://free-api-anuragsingh.vercel.app"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  }
}));
app.use(express.json());
app.use(cookieParser());

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

// Smart path detection - locally aur Railway dono me kaam karega
let publicPath = path.join(__dirname, 'public');
if (!fs.existsSync(publicPath)) {
  publicPath = path.join(__dirname, '..', 'public');
}
app.use(express.static(publicPath));

// Helper: Generate device fingerprint
function getFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.ip || req.connection.remoteAddress;
  return Buffer.from(`${ua}:${ip}`).toString('base64').substring(0, 32);
}

// Helper: Check failed login attempts
function checkFailedLogin(identifier) {
  const record = db.prepare('SELECT * FROM failed_logins WHERE identifier = ?').get(identifier);
  if (!record) return { allowed: true };
  
  if (record.locked_until && new Date(record.locked_until) > new Date()) {
    return { allowed: false, lockedUntil: record.locked_until };
  }
  
  if (record.attempts >= 5) {
    const lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('UPDATE failed_logins SET locked_until = ?, updated_at = datetime("now") WHERE identifier = ?')
      .run(lockUntil, identifier);
    return { allowed: false, lockedUntil: lockUntil };
  }
  
  return { allowed: true };
}

// Helper: Record failed login
function recordFailedLogin(identifier) {
  const existing = db.prepare('SELECT * FROM failed_logins WHERE identifier = ?').get(identifier);
  if (existing) {
    db.prepare('UPDATE failed_logins SET attempts = attempts + 1, updated_at = datetime("now") WHERE identifier = ?')
      .run(identifier);
  } else {
    db.prepare('INSERT INTO failed_logins (identifier, attempts) VALUES (?, 1)').run(identifier);
  }
}

// Helper: Clear failed login
function clearFailedLogin(identifier) {
  db.prepare('DELETE FROM failed_logins WHERE identifier = ?').run(identifier);
}

// Helper: Check if user access is expired
function checkExpiry(user) {
  if (user.status !== 'active') return false;
  if (user.expiry_date === 'permanent') return true;
  
  const expiry = new Date(user.expiry_date);
  if (expiry < new Date()) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('expired', user.id);
    return false;
  }
  return true;
}

// Auth middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'banned') return res.status(403).json({ error: 'Account banned' });
    if (!checkExpiry(user)) return res.status(403).json({ error: 'Access expired' });
    
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ API ROUTES ============

// Signup
app.post('/api/signup', async (req, res) => {
  const { name, mobile, email } = req.body;
  
  if (!name || !mobile || !email) {
    return res.status(400).json({ error: 'All fields required' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.status === 'pending') return res.status(400).json({ error: 'Already pending approval' });
    if (existing.status === 'active') return res.status(400).json({ error: 'Account already active' });
    if (existing.status === 'banned') return res.status(403).json({ error: 'Account banned' });
  }

  try {
    let userId;
    if (existing) {
      db.prepare(`
        UPDATE users SET name = ?, mobile = ?, status = 'pending', updated_at = datetime('now')
        WHERE email = ?
      `).run(name, mobile, email);
      userId = existing.id;
    } else {
      const result = db.prepare('INSERT INTO users (name, mobile, email) VALUES (?, ?, ?)').run(name, mobile, email);
      userId = result.lastInsertRowid;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    await notifyAdmin(user);
    await logAudit('SIGNUP', userId, `Name: ${name}, Mobile: ${mobile}`, req.ip);

    res.json({ success: true, message: 'Request sent to admin. Wait for approval.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/api/login', authLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const ip = req.ip;
  const fingerprint = getFingerprint(req);

  // Check if IP is locked
  const ipCheck = checkFailedLogin(ip);
  if (!ipCheck.allowed) {
    return res.status(429).json({ error: `Too many failed attempts. Locked until ${ipCheck.lockedUntil}` });
  }

  // Find user by password
  const users = db.prepare("SELECT * FROM users WHERE status IN ('active', 'expired') AND password_hash IS NOT NULL").all();
  let matchedUser = null;

  for (const user of users) {
    if (bcrypt.compareSync(password, user.password_hash)) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) {
    recordFailedLogin(ip);
    recordFailedLogin('password:' + password.substring(0, 8));
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Check if account is active
  if (matchedUser.status === 'banned') {
    return res.status(403).json({ error: 'Account banned' });
  }

  if (!checkExpiry(matchedUser)) {
    return res.status(403).json({ error: 'Access expired. Contact admin for renewal.' });
  }

  // Clear failed attempts
  clearFailedLogin(ip);

  // Log successful login
  db.prepare(`
    INSERT INTO login_history (user_id, ip_address, user_agent, device_fingerprint, success)
    VALUES (?, ?, ?, ?, 1)
  `).run(matchedUser.id, ip, req.headers['user-agent'], fingerprint);

  // Generate token (8 hours)
  const token = jwt.sign({ userId: matchedUser.id }, process.env.JWT_SECRET, { expiresIn: '8h' });

  res.json({ success: true, token });
});

// Dashboard stats
app.get('/api/dashboard', authenticate, (req, res) => {
  const user = req.user;
  const searchesLeft = user.search_limit === -1 ? -1 : Math.max(0, user.search_limit - user.searches_used);
  
  let expiryDisplay;
  if (user.expiry_date === 'permanent') {
    expiryDisplay = 'Permanent';
  } else {
    const expiry = new Date(user.expiry_date);
    const now = new Date();
    const diff = expiry - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) expiryDisplay = `${days} days ${hours} hours`;
    else if (hours > 0) expiryDisplay = `${hours} hours`;
    else expiryDisplay = 'Less than 1 hour';
  }

  res.json({
    searchesLeft,
    expiry: expiryDisplay,
    status: user.status,
    searchesUsed: user.searches_used
  });
});

// Phone search
app.get('/api/search', authenticate, async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const user = req.user;

  // Check search limit
  if (user.search_limit !== -1 && user.searches_used >= user.search_limit) {
    return res.status(403).json({ error: '❌ Search limit exceeded. Contact admin for upgrade.' });
  }

  try {
    const apiUrl = `https://free-api-anuragsingh.vercel.app/api/number?num=${encodeURIComponent(phone)}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    const results = data.results || [];
    const resultsCount = results.length;

    // Only increment if results found
    if (resultsCount > 0) {
      db.prepare('UPDATE users SET searches_used = searches_used + 1 WHERE id = ?').run(user.id);
    }

    // Log search
    db.prepare(`
      INSERT INTO search_logs (user_id, phone, results_count, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, phone, resultsCount, req.ip, req.headers['user-agent']);

    const newSearchesUsed = user.searches_used + (resultsCount > 0 ? 1 : 0);
    const searchesRemaining = user.search_limit === -1 ? -1 : Math.max(0, user.search_limit - newSearchesUsed);

    res.json({
      success: true,
      total: data.total || resultsCount,
      results: results,
      email: data.email,
      truecaller_name: data.truecaller_name,
      cached: data.cached || false,
      searchesRemaining: searchesRemaining,
      counted: resultsCount > 0
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed. Try again later.' });
  }
});

// Admin API
app.get('/api/admin/stats', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  const stats = {
    pending: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get().count,
    active: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count,
    expired: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'expired'").get().count,
    banned: db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'banned'").get().count,
    totalSearches: db.prepare('SELECT COUNT(*) as count FROM search_logs').get().count,
    recentLogins: db.prepare("SELECT COUNT(*) as count FROM login_history WHERE created_at > datetime('now', '-1 day')").get().count
  };

  res.json(stats);
});

app.get('/api/admin/users', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  const status = req.query.status || 'all';
  let query = 'SELECT id, name, mobile, email, status, search_limit, searches_used, expiry_date, created_at FROM users';
  if (status !== 'all') query += ` WHERE status = '${status}'`;
  query += ' ORDER BY created_at DESC';

  const users = db.prepare(query).all();
  res.json(users);
});

app.get('/api/admin/logs', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  const type = req.query.type || 'search';
  
  let logs;
  if (type === 'search') {
    logs = db.prepare(`
      SELECT sl.*, u.name, u.email 
      FROM search_logs sl 
      LEFT JOIN users u ON sl.user_id = u.id 
      ORDER BY sl.created_at DESC LIMIT 100
    `).all();
  } else if (type === 'login') {
    logs = db.prepare(`
      SELECT lh.*, u.name, u.email 
      FROM login_history lh 
      LEFT JOIN users u ON lh.user_id = u.id 
      ORDER BY lh.created_at DESC LIMIT 100
    `).all();
  } else {
    logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
  }

  res.json(logs);
});

// Renew user access
app.post('/api/admin/renew', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, duration, searchLimit, newPassword } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let expiryDate;
  if (duration === 'permanent') {
    expiryDate = 'permanent';
  } else {
    const now = new Date();
    const match = duration.match(/(\d+)(min|hour|day|days|month|months)/);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2];
      switch (unit) {
        case 'min': now.setMinutes(now.getMinutes() + val); break;
        case 'hour': now.setHours(now.getHours() + val); break;
        case 'day': case 'days': now.setDate(now.getDate() + val); break;
        case 'month': case 'months': now.setMonth(now.getMonth() + val); break;
      }
      expiryDate = now.toISOString();
    }
  }

  const updates = {
    status: 'active',
    expiry_date: expiryDate,
    search_limit: searchLimit,
    searches_used: 0,
    updated_at: new Date().toISOString()
  };

  if (newPassword) {
    updates.password_hash = bcrypt.hashSync(newPassword, 10);
  }

  db.prepare(`
    UPDATE users SET 
      status = @status, expiry_date = @expiry_date, search_limit = @search_limit,
      searches_used = @searches_used, password_hash = COALESCE(@password_hash, password_hash),
      updated_at = datetime('now')
    WHERE id = @userId
  `).run({
    ...updates,
    password_hash: updates.password_hash || null,
    userId
  });

  res.json({ success: true, message: 'User renewed successfully' });
});

// Admin panel page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin.html'));
});

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Signup: http://localhost:${PORT}/signup.html`);
  console.log(`🔑 Login: http://localhost:${PORT}/login.html`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`🛡️ Admin: http://localhost:${PORT}/admin`);
  console.log(`\n✅ Telegram bot active and listening...\n`);
});

module.exports = app;
