const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const bcrypt = require('bcryptjs');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });

// ============ PASSWORD GENERATION ============
function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 20; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ============ START COMMAND ============
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (String(chatId) !== String(adminChatId)) {
    return bot.sendMessage(chatId, '⛔ Unauthorized access!');
  }

  const welcomeMessage = `
🛡️ *OSINT Admin Panel*

📱 *Available Commands:*
/start - Main Menu
/stats - View Statistics
/clear - Clear Chat History

Select an option below:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📊 Dashboard', callback_data: 'admin_dashboard' },
        { text: '👥 All Users', callback_data: 'admin_users_all' }
      ],
      [
        { text: '⏳ Pending', callback_data: 'admin_users_pending' },
        { text: '✅ Active', callback_data: 'admin_users_active' }
      ],
      [
        { text: '⏰ Expired', callback_data: 'admin_users_expired' },
        { text: '🚫 Banned', callback_data: 'admin_users_banned' }
      ],
      [
        { text: '📋 Search Logs', callback_data: 'admin_logs_search' },
        { text: '🔐 Login History', callback_data: 'admin_logs_login' }
      ]
    ]
  };

  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
});

// ============ CLEAR COMMAND ============
bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (String(chatId) !== String(adminChatId)) {
    return bot.sendMessage(chatId, '⛔ Unauthorized!');
  }

  try {
    const messages = await bot.getUpdates({
      offset: -100,
      limit: 100
    });

    let deletedCount = 0;
    
    for (const update of messages) {
      if (update.message && update.message.chat.id === chatId) {
        try {
          await bot.deleteMessage(chatId, update.message.message_id);
          deletedCount++;
        } catch (err) {
          // Some messages can't be deleted
        }
      }
    }

    await bot.sendMessage(chatId, 
      `✅ *Cleared ${deletedCount} messages!*\n\n` +
      'Use /start for menu',
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await bot.sendMessage(chatId, 
      'ℹ️ *Note:*\n\n' +
      'Bots cannot delete user messages in private chat.\n\n' +
      'Use /start for menu',
      { parse_mode: 'Markdown' }
    );
  }
});

// ============ STATS COMMAND ============
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  
  if (String(chatId) !== String(adminChatId)) return;

  const pending = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
  const expired = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'expired'").get().count;
  const banned = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'banned'").get().count;
  const totalSearches = db.prepare('SELECT COUNT(*) as count FROM search_logs').get().count;
  const recentLogins = db.prepare("SELECT COUNT(*) as count FROM login_history WHERE created_at > datetime('now', '-1 day')").get().count;

  const statsMessage = `
📊 *System Statistics*

👥 *Users:*
  • Pending: ${pending}
  • Active: ${active}
  • Expired: ${expired}
  • Banned: ${banned}
  • Total: ${pending + active + expired + banned}

📈 *Activity:*
  • Total Searches: ${totalSearches}
  • Logins (24h): ${recentLogins}

🕐 *Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
  `.trim();

  bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// ============ NOTIFICATION TO ADMIN ============
async function notifyAdmin(user) {
  const message = `
🆕 *New Signup Request*

👤 *Name:* ${user.name}
📱 *Mobile:* ${user.mobile}
📧 *Email:* ${user.email}
🕐 *Time:* ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚡ Select action below:`.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve_${user.id}` },
        { text: '❌ Decline', callback_data: `decline_${user.id}` }
      ],
      [
        { text: '🚫 Ban User', callback_data: `ban_${user.id}` }
      ]
    ]
  };

  const sent = await bot.sendMessage(adminChatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });

  db.prepare('UPDATE users SET telegram_message_id = ? WHERE id = ?').run(sent.message_id, user.id);
}

// ============ DASHBOARD VIEW ============
async function showDashboard(chatId) {
  const pending = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
  const expired = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'expired'").get().count;
  const banned = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'banned'").get().count;

  const message = `
📊 *Admin Dashboard*

👥 Users Overview:
  • Pending: ${pending}
  • Active: ${active}
  • Expired: ${expired}
  • Banned: ${banned}

Select an option:`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '👥 View All Users', callback_data: 'admin_users_all' },
        { text: '⏳ Pending Users', callback_data: 'admin_users_pending' }
      ],
      [
        { text: '✅ Active Users', callback_data: 'admin_users_active' },
        { text: '⏰ Expired Users', callback_data: 'admin_users_expired' }
      ],
      [
        { text: '🚫 Banned Users', callback_data: 'admin_users_banned' }
      ],
      [
        { text: '🔙 Back to Menu', callback_data: 'menu_back' }
      ]
    ]
  };

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ============ USERS LIST VIEW (FIXED - Ye missing tha!) ============
async function showUsersList(chatId, status) {
  let users;
  let statusEmoji;
  let statusLabel;
  
  if (status === 'all') {
    users = db.prepare('SELECT id, name, mobile, email, status, search_limit, searches_used, expiry_date FROM users ORDER BY created_at DESC LIMIT 20').all();
    statusEmoji = '👥';
    statusLabel = 'All Users';
  } else {
    users = db.prepare(`SELECT id, name, mobile, email, status, search_limit, searches_used, expiry_date FROM users WHERE status = '${status}' ORDER BY created_at DESC LIMIT 20`).all();
    statusEmoji = status === 'pending' ? '⏳' : status === 'active' ? '✅' : status === 'expired' ? '⏰' : '🚫';
    statusLabel = status.charAt(0).toUpperCase() + status.slice(1) + ' Users';
  }

  if (users.length === 0) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔙 Back to Dashboard', callback_data: 'admin_dashboard' }]
      ]
    };
    return bot.sendMessage(chatId, `${statusEmoji} No ${statusLabel.toLowerCase()} found.`, { reply_markup: keyboard });
  }

  const userList = users.map((u, index) => {
    const expiry = u.expiry_date === 'permanent' ? '∞' : new Date(u.expiry_date).toLocaleDateString('en-IN');
    const searches = u.search_limit === -1 ? '∞' : `${u.searches_used}/${u.search_limit}`;
    return `${index + 1}. *${u.name}* (#${u.id})
   📱 ${u.mobile} | ${u.status.toUpperCase()}
   🔍 Searches: ${searches} | ⏰ Expires: ${expiry}`;
  }).join('\n\n');

  const message = `${statusEmoji} *${statusLabel}*\n\n${userList}\n\n*Total:* ${users.length} users\n\n_Select a user to view details:_`;

  // Har user ke liye button
  const userButtons = users.map(u => [
    { text: `👤 ${u.name} (#${u.id})`, callback_data: `userdetail_${u.id}` }
  ]);

  const keyboard = {
    inline_keyboard: [
      ...userButtons,
      [{ text: '🔙 Back to Dashboard', callback_data: 'admin_dashboard' }]
    ]
  };

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ============ USER DETAIL VIEW (Single - Password ke saath) ============
async function showUserDetail(chatId, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  if (!user) {
    return bot.sendMessage(chatId, '❌ User not found.');
  }

  const expiry = user.expiry_date === 'permanent' ? 'Permanent' : new Date(user.expiry_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const searches = user.search_limit === -1 ? 'Unlimited' : `${user.searches_used}/${user.search_limit}`;

  const message = `
👤 *User Details #${user.id}*

*Name:* ${user.name}
*Mobile:* ${user.mobile}
*Email:* ${user.email}
*Status:* ${user.status.toUpperCase()}
${user.temp_password ? `*Password:* \`${user.temp_password}\`` : '*Password:* Not set'}

📊 *Usage:*
  • Searches: ${searches}
  • Created: ${new Date(user.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
  • Expires: ${expiry}

*Actions:*`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Renew Access', callback_data: `renew_${user.id}` },
        { text: '⏰ Extend Time', callback_data: `extend_${user.id}` }
      ],
      [
        { text: user.status === 'banned' ? '✅ Unban' : '🚫 Ban', callback_data: `toggleban_${user.id}` },
        { text: '🔑 Reset Password', callback_data: `resetpwd_${user.id}` }
      ],
      [
        { text: '🔙 Back to Users', callback_data: 'admin_users_all' }
      ]
    ]
  };

  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ============ APPROVE FLOW ============
async function askDurationType(userId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '⏰ Time-based', callback_data: `durtype_time_${userId}` },
        { text: '📅 Day-based', callback_data: `durtype_day_${userId}` }
      ],
      [
        { text: '🗓️ Month-based', callback_data: `durtype_month_${userId}` },
        { text: '♾️ Permanent', callback_data: `durtype_permanent_${userId}` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, `⏰ *User #${userId}* — Select Duration Type:`, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

async function askTimeOptions(userId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '5 Minutes', callback_data: `durval_time_5min_${userId}` },
        { text: '10 Minutes', callback_data: `durval_time_10min_${userId}` }
      ],
      [
        { text: '30 Minutes', callback_data: `durval_time_30min_${userId}` },
        { text: '1 Hour', callback_data: `durval_time_1hour_${userId}` }
      ],
      [
        { text: '🔢 Custom Minutes', callback_data: `durval_time_custom_${userId}` }
      ],
      [
        { text: '🔙 Back', callback_data: `approve_${userId}` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, `⏰ Time-based Duration for User #${userId}:`, {
    reply_markup: keyboard
  });
}

async function askDayOptions(userId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '1 Day', callback_data: `durval_day_1day_${userId}` },
        { text: '3 Days', callback_data: `durval_day_3days_${userId}` }
      ],
      [
        { text: '7 Days', callback_data: `durval_day_7days_${userId}` },
        { text: '10 Days', callback_data: `durval_day_10days_${userId}` }
      ],
      [
        { text: '30 Days', callback_data: `durval_day_30days_${userId}` },
        { text: '📅 Specific Date', callback_data: `durval_day_specific_${userId}` }
      ],
      [
        { text: '🔢 Custom Days', callback_data: `durval_day_custom_${userId}` }
      ],
      [
        { text: '🔙 Back', callback_data: `approve_${userId}` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, `📅 Day-based Duration for User #${userId}:`, {
    reply_markup: keyboard
  });
}

async function askMonthOptions(userId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '1 Month', callback_data: `durval_month_1month_${userId}` },
        { text: '2 Months', callback_data: `durval_month_2months_${userId}` }
      ],
      [
        { text: '3 Months', callback_data: `durval_month_3months_${userId}` },
        { text: '6 Months', callback_data: `durval_month_6months_${userId}` }
      ],
      [
        { text: '🔢 Custom Months', callback_data: `durval_month_custom_${userId}` }
      ],
      [
        { text: '🔙 Back', callback_data: `approve_${userId}` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, `🗓️ Month-based Duration for User #${userId}:`, {
    reply_markup: keyboard
  });
}

async function askSearchLimit(userId) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '5', callback_data: `limit_5_${userId}` },
        { text: '10', callback_data: `limit_10_${userId}` },
        { text: '20', callback_data: `limit_20_${userId}` }
      ],
      [
        { text: '50', callback_data: `limit_50_${userId}` },
        { text: '100', callback_data: `limit_100_${userId}` }
      ],
      [
        { text: '🔢 Custom', callback_data: `limit_custom_${userId}` },
        { text: '∞ Unlimited', callback_data: `limit_unlimited_${userId}` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, `🔍 Search Limit for User #${userId}:`, {
    reply_markup: keyboard
  });
}

async function finalizeApproval(userId, expiryDate, searchLimit) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  const password = generatePassword();
  const hash = bcrypt.hashSync(password, 10);

  db.prepare(`
    UPDATE users 
    SET status = 'active', search_limit = ?, password_hash = ?, temp_password = ?,
        expiry_date = ?, searches_used = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(searchLimit, hash, password, expiryDate, userId);

  await logAudit('APPROVE_USER', userId, `Limit: ${searchLimit}, Expiry: ${expiryDate}`);

  const message = `
✅ *User #${userId} Approved!*

👤 *Name:* ${user.name}
📧 *Email:* ${user.email}
🔐 *Password:* \`${password}\`
🔍 *Limit:* ${searchLimit === -1 ? '∞' : searchLimit} searches
⏰ *Expires:* ${expiryDate === 'permanent' ? 'Never' : new Date(expiryDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

📦 *Delivery Options:*`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Copy Password', callback_data: `pwd_${userId}_copy` },
        { text: '📧 Email to User', callback_data: `pwd_${userId}_email` }
      ]
    ]
  };

  await bot.sendMessage(adminChatId, message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (String(chatId) !== String(adminChatId)) {
    return bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized' });
  }

  try {
    // Menu Navigation
    if (data === 'menu_back') {
      await bot.answerCallbackQuery(query.id);
      bot.emit('text', { chat: { id: chatId }, text: '/start' });
    }
    else if (data === 'admin_dashboard') {
      await bot.answerCallbackQuery(query.id);
      await showDashboard(chatId);
    }
    else if (data.startsWith('admin_users_')) {
      const status = data.replace('admin_users_', '');
      await bot.answerCallbackQuery(query.id);
      await showUsersList(chatId, status);
    }
    else if (data === 'admin_logs_search') {
      await bot.answerCallbackQuery(query.id);
      const logs = db.prepare(`
        SELECT sl.*, u.name, u.email 
        FROM search_logs sl 
        LEFT JOIN users u ON sl.user_id = u.id 
        ORDER BY sl.created_at DESC LIMIT 10
      `).all();
      
      if (logs.length === 0) {
        await bot.sendMessage(chatId, '📋 No search logs found.');
        return;
      }
      
      const logText = logs.map((l, i) => 
        `${i+1}. *${l.name || 'Unknown'}* searched *${l.phone}*\n   Results: ${l.results_count} | ${new Date(l.created_at).toLocaleString('en-IN')}`
      ).join('\n\n');
      
      await bot.sendMessage(chatId, `📋 *Recent Search Logs*\n\n${logText}`, { parse_mode: 'Markdown' });
    }
    else if (data === 'admin_logs_login') {
      await bot.answerCallbackQuery(query.id);
      const logs = db.prepare(`
        SELECT lh.*, u.name, u.email 
        FROM login_history lh 
        LEFT JOIN users u ON lh.user_id = u.id 
        ORDER BY lh.created_at DESC LIMIT 10
      `).all();
      
      if (logs.length === 0) {
        await bot.sendMessage(chatId, '🔐 No login history found.');
        return;
      }
      
      const logText = logs.map((l, i) => 
        `${i+1}. *${l.name || 'Unknown'}* - ${l.success ? '✅' : '❌'}\n   IP: ${l.ip_address} | ${new Date(l.created_at).toLocaleString('en-IN')}`
      ).join('\n\n');
      
      await bot.sendMessage(chatId, `🔐 *Recent Login History*\n\n${logText}`, { parse_mode: 'Markdown' });
    }
    // User Detail View
    else if (data.startsWith('userdetail_')) {
      const userId = parseInt(data.split('_')[1]);
      await bot.answerCallbackQuery(query.id);
      await showUserDetail(chatId, userId);
    }
    // Approval Flow
    else if (data.startsWith('approve_')) {
      const userId = parseInt(data.split('_')[1]);
      await bot.answerCallbackQuery(query.id, { text: '✅ Select duration type...' });
      await askDurationType(userId);
    }
    else if (data.startsWith('decline_')) {
      const userId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('declined', userId);
      await bot.editMessageText(`❌ User #${userId} declined.`, {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      await logAudit('DECLINE_USER', userId, 'Declined by admin');
    }
    else if (data.startsWith('ban_')) {
      const userId = parseInt(data.split('_')[1]);
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run('banned', userId);
      await bot.editMessageText(`🚫 User #${userId} banned.`, {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      await logAudit('BAN_USER', userId, 'Banned by admin');
    }
    // Duration Type
    else if (data.startsWith('durtype_')) {
      const parts = data.split('_');
      const type = parts[1];
      const userId = parseInt(parts[2]);

      await bot.answerCallbackQuery(query.id);

      if (type === 'time') await askTimeOptions(userId);
      else if (type === 'day') await askDayOptions(userId);
      else if (type === 'month') await askMonthOptions(userId);
      else if (type === 'permanent') {
        db.prepare('UPDATE users SET expiry_date = ? WHERE id = ?').run('permanent', userId);
        await askSearchLimit(userId);
      }
    }
    // Duration Value
    else if (data.startsWith('durval_')) {
      const parts = data.split('_');
      const type = parts[1];
      const value = parts[2];
      const userId = parseInt(parts[3]);

      await bot.answerCallbackQuery(query.id);

      let expiryDate;
      const now = new Date();

      if (value === 'permanent') {
        expiryDate = 'permanent';
      }
      else if (value === 'custom') {
        if (type === 'time') {
          await bot.sendMessage(chatId, `🔢 Reply with custom minutes for User #${userId}:`);
          db.prepare('UPDATE users SET status = ? WHERE id = ?').run('awaiting_custom_minutes', userId);
          return;
        } else if (type === 'day') {
          await bot.sendMessage(chatId, `🔢 Reply with custom days for User #${userId}:`);
          db.prepare('UPDATE users SET status = ? WHERE id = ?').run('awaiting_custom_days', userId);
          return;
        } else if (type === 'month') {
          await bot.sendMessage(chatId, `🔢 Reply with custom months for User #${userId}:`);
          db.prepare('UPDATE users SET status = ? WHERE id = ?').run('awaiting_custom_months', userId);
          return;
        }
      }
      else if (value === 'specific') {
        await bot.sendMessage(chatId, `📅 Reply with specific date (YYYY-MM-DD) for User #${userId}:`);
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('awaiting_specific_date', userId);
        return;
      }
      else {
        const match = value.match(/(\d+)(min|hour|day|days|month|months)/);
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

      if (expiryDate) {
        db.prepare('UPDATE users SET expiry_date = ? WHERE id = ?').run(expiryDate, userId);
        await askSearchLimit(userId);
      }
    }
    // Search Limit
    else if (data.startsWith('limit_')) {
      const parts = data.split('_');
      const value = parts[1];
      const userId = parseInt(parts[2]);

      await bot.answerCallbackQuery(query.id);

      let searchLimit;
      if (value === 'unlimited') {
        searchLimit = -1;
      } else if (value === 'custom') {
        await bot.sendMessage(chatId, `🔢 Reply with custom search limit for User #${userId}:`);
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('awaiting_custom_limit', userId);
        return;
      } else {
        searchLimit = parseInt(value);
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      const expiryDate = user.expiry_date;
      await finalizeApproval(userId, expiryDate, searchLimit);
    }
    // Password Delivery
    else if (data.startsWith('pwd_')) {
      const parts = data.split('_');
      const userId = parseInt(parts[1]);
      const action = parts[2];

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      
      if (action === 'copy') {
        await bot.answerCallbackQuery(query.id, { text: '📋 Password copied!' });
        await bot.sendMessage(chatId, `🔐 Password for User #${userId}:\n\n\`${user.temp_password}\``, {
          parse_mode: 'Markdown'
        });
      } else if (action === 'email') {
        await bot.answerCallbackQuery(query.id, { text: '📧 Sending email...' });
        try {
          await sendPasswordEmail(user.email, user.temp_password);
          await bot.sendMessage(chatId, `✅ Email sent to ${user.email}`);
        } catch (err) {
          await bot.sendMessage(chatId, `❌ Email failed: ${err.message}`);
        }
      }
    }
    // Renew/Extend/Ban Actions
    else if (data.startsWith('renew_')) {
      const userId = parseInt(data.split('_')[1]);
      await bot.answerCallbackQuery(query.id, { text: '🔄 Starting renewal...' });
      await askDurationType(userId);
    }
    else if (data.startsWith('extend_')) {
      const userId = parseInt(data.split('_')[1]);
      await bot.answerCallbackQuery(query.id, { text: '⏰ Extend time...' });
      await askDurationType(userId);
    }
    else if (data.startsWith('toggleban_')) {
      const userId = parseInt(data.split('_')[1]);
      const user = db.prepare('SELECT status FROM users WHERE id = ?').get(userId);
      const newStatus = user.status === 'banned' ? 'active' : 'banned';
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, userId);
      await bot.answerCallbackQuery(query.id, { text: `User ${newStatus === 'banned' ? 'banned' : 'unbanned'}` });
      await showUserDetail(chatId, userId);
    }
    else if (data.startsWith('resetpwd_')) {
      const userId = parseInt(data.split('_')[1]);
      const newPassword = generatePassword();
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare('UPDATE users SET password_hash = ?, temp_password = ? WHERE id = ?').run(hash, newPassword, userId);
      await bot.answerCallbackQuery(query.id, { text: '🔑 Password reset!' });
      await bot.sendMessage(chatId, `🔐 *New Password for User #${userId}:*\n\n\`${newPassword}\``, {
        parse_mode: 'Markdown'
      });
    }

  } catch (err) {
    console.error('Telegram callback error:', err);
    await bot.answerCallbackQuery(query.id, { text: '❌ Error: ' + err.message });
  }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== String(adminChatId)) return;
  if (!msg.text || msg.text.startsWith('/')) return;

  const text = msg.text.trim();

  // Custom minutes
  const awaitingMinutes = db.prepare("SELECT * FROM users WHERE status = 'awaiting_custom_minutes'").get();
  if (awaitingMinutes) {
    const minutes = parseInt(text);
    if (isNaN(minutes) || minutes <= 0) {
      await bot.sendMessage(adminChatId, '❌ Invalid number. Reply with positive minutes.');
      return;
    }
    const expiryDate = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET expiry_date = ?, status = ? WHERE id = ?')
      .run(expiryDate, 'awaiting_limit', awaitingMinutes.id);
    await bot.sendMessage(adminChatId, `✅ Set to ${minutes} minutes`);
    await askSearchLimit(awaitingMinutes.id);
    return;
  }

  // Custom days
  const awaitingDays = db.prepare("SELECT * FROM users WHERE status = 'awaiting_custom_days'").get();
  if (awaitingDays) {
    const days = parseInt(text);
    if (isNaN(days) || days <= 0) {
      await bot.sendMessage(adminChatId, '❌ Invalid number. Reply with positive days.');
      return;
    }
    const now = new Date();
    now.setDate(now.getDate() + days);
    const expiryDate = now.toISOString();
    db.prepare('UPDATE users SET expiry_date = ?, status = ? WHERE id = ?')
      .run(expiryDate, 'awaiting_limit', awaitingDays.id);
    await bot.sendMessage(adminChatId, `✅ Set to ${days} days`);
    await askSearchLimit(awaitingDays.id);
    return;
  }

  // Custom months
  const awaitingMonths = db.prepare("SELECT * FROM users WHERE status = 'awaiting_custom_months'").get();
  if (awaitingMonths) {
    const months = parseInt(text);
    if (isNaN(months) || months <= 0) {
      await bot.sendMessage(adminChatId, '❌ Invalid number. Reply with positive months.');
      return;
    }
    const now = new Date();
    now.setMonth(now.getMonth() + months);
    const expiryDate = now.toISOString();
    db.prepare('UPDATE users SET expiry_date = ?, status = ? WHERE id = ?')
      .run(expiryDate, 'awaiting_limit', awaitingMonths.id);
    await bot.sendMessage(adminChatId, `✅ Set to ${months} months`);
    await askSearchLimit(awaitingMonths.id);
    return;
  }

  // Specific date
  const awaitingDate = db.prepare("SELECT * FROM users WHERE status = 'awaiting_specific_date'").get();
  if (awaitingDate) {
    const date = new Date(text);
    if (isNaN(date.getTime())) {
      await bot.sendMessage(adminChatId, '❌ Invalid date format. Use YYYY-MM-DD');
      return;
    }
    const expiryDate = date.toISOString();
    db.prepare('UPDATE users SET expiry_date = ?, status = ? WHERE id = ?')
      .run(expiryDate, 'awaiting_limit', awaitingDate.id);
    await bot.sendMessage(adminChatId, `✅ Set to ${date.toLocaleDateString('en-IN')}`);
    await askSearchLimit(awaitingDate.id);
    return;
  }

  // Custom search limit
  const awaitingLimit = db.prepare("SELECT * FROM users WHERE status = 'awaiting_custom_limit'").get();
  if (awaitingLimit) {
    const limit = parseInt(text);
    if (isNaN(limit) || limit < 0) {
      await bot.sendMessage(adminChatId, '❌ Invalid number. Enter positive integer or 0 for unlimited.');
      return;
    }
    const searchLimit = limit === 0 ? -1 : limit;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(awaitingLimit.id);
    await finalizeApproval(awaitingLimit.id, user.expiry_date, searchLimit);
    return;
  }
});

// ============ EMAIL DELIVERY ============
async function sendPasswordEmail(email, password) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP not configured in .env');
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: email,
    subject: '🔐 Your OSINT Tool Access Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #00d4ff;">Welcome to OSINT Tool</h2>
        <p>Your access has been approved by the admin.</p>
        <div style="background: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #00d4ff;">
          <p style="margin: 0 0 10px 0; color: #666;">Your Access Password:</p>
          <code style="font-size: 20px; color: #333; font-weight: bold;">${password}</code>
        </div>
        <p><a href="http://localhost:3000/login.html" style="background: #00d4ff; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Login Now</a></p>
        <p style="color: #888; font-size: 12px; margin-top: 30px;">This is an automated message. Do not reply.</p>
      </div>
    `
  });
}

// ============ AUDIT LOGGING ============
async function logAudit(action, userId, details, ip) {
  db.prepare('INSERT INTO audit_logs (action, user_id, details, ip_address) VALUES (?, ?, ?, ?)')
    .run(action, userId, details, ip || 'telegram');
}

module.exports = {
  bot,
  notifyAdmin,
  sendPasswordEmail,
  logAudit
};