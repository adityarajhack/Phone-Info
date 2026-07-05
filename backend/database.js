const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'osint.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    temp_password TEXT,
    status TEXT DEFAULT 'pending',
    search_limit INTEGER DEFAULT 0,
    searches_used INTEGER DEFAULT 0,
    expiry_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    telegram_message_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    results_count INTEGER DEFAULT 0,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS login_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    device_fingerprint TEXT,
    success INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS failed_logins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    attempts INTEGER DEFAULT 1,
    locked_until TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    user_id INTEGER,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;