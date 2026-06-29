const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const config = require('./config');

// Multiple Telegraf instances can run side-by-side. Each entry:
// `{ instance, info, addedAt, name }` keyed by the bot's numeric Telegram id.
const bots = new Map();
function anyBot() {
  const first = bots.values().next().value;
  return first ? first.instance : null;
}
function getBotIds() { return [...bots.keys()]; }
function listBotsRuntime() {
  return [...bots.entries()].map(([id, r]) => ({
    id,
    username: r.info && r.info.username,
    first_name: r.info && r.info.first_name,
    name: r.name || null,
    addedAt: r.addedAt,
    online: true
  }));
}

// Back-compat shim: most legacy code reads `bot.botInfo.id` / `bot.telegram.X`.
// Expose the "primary" bot (first in insertion order) under this name.
let bot = null;
function refreshLegacyBotRef() {
  const first = bots.values().next().value;
  bot = first ? first.instance : null;
}

let usernameToId = {}; // Cache for resolving username to ID: { '@username': userId }
let recentJoins = []; // Timestamp array to detect joins
let raidModeActive = false;
let messageTimestamps = {}; // { userId: [timestamp1, timestamp2] }
let messageHashes = {};     // { userId: [{ ts, hash }] } for duplicate detection
let adminCache = {};        // { `${chatId}:${userId}`: { isAdmin, ts } }
const ADMIN_CACHE_MS = 60 * 1000;

// Once we ban/kick/mute someone in a chat, remember it briefly. A spammer who
// posts a burst (e.g. a porn album = 6 photos + button rows, all in the same
// second) would otherwise be banned + logged once PER message. With this guard,
// the first message removes them and the rest of the burst is silently deleted.
let recentlyRemoved = {};   // { `${chatId}:${userId}`: ts }
const RECENT_REMOVE_MS = 10 * 60 * 1000;

// Boot scan should run once per process, not once per watchdog relaunch.
let bootScanDone = false;
function markRemoved(chatId, userId) {
  recentlyRemoved[`${chatId}:${userId}`] = Date.now();
}
function wasRecentlyRemoved(chatId, userId) {
  const ts = recentlyRemoved[`${chatId}:${userId}`];
  if (!ts) return false;
  if (Date.now() - ts > RECENT_REMOVE_MS) {
    delete recentlyRemoved[`${chatId}:${userId}`];
    return false;
  }
  return true;
}

// Regex helpers
const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<]+|t\.me\/[^\s<]+|telegram\.me\/[^\s<]+|telegram\.dog\/[^\s<]+)/gi;
const TME_REGEX = /(?:^|[^a-z0-9])(?:t\.me|telegram\.me|telegram\.dog)\/(?:joinchat\/|\+)?([a-z0-9_+]{3,})/gi;
const MENTION_REGEX = /(?:^|[^a-z0-9_])@([a-z0-9_]{4,})/gi;

function nowMs() { return Date.now(); }

function hashMessage(text) {
  return crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex');
}

// Pulls plain text out of a message regardless of message type.
// Includes inline-keyboard button labels so rules apply to them too.
function extractText(message) {
  if (!message) return '';
  const base = message.text || message.caption || '';
  const buttons = extractButtonText(message);
  return buttons ? `${base} ${buttons}`.trim() : base;
}

// Returns forward source info or null. Handles both legacy and forward_origin fields.
function getForwardSource(message) {
  if (!message) return null;
  if (message.forward_origin) {
    const o = message.forward_origin;
    if (o.type === 'channel') {
      return {
        kind: 'channel',
        title: (o.chat && o.chat.title) || 'a channel',
        username: o.chat && o.chat.username ? `@${o.chat.username}` : null
      };
    }
    if (o.type === 'chat') {
      return { kind: 'chat', title: (o.sender_chat && o.sender_chat.title) || 'a group' };
    }
    if (o.type === 'user') {
      const u = o.sender_user || {};
      return { kind: 'user', title: u.username ? `@${u.username}` : (u.first_name || 'a user') };
    }
    if (o.type === 'hidden_user') {
      return { kind: 'hidden', title: o.sender_user_name || 'a hidden user' };
    }
  }
  if (message.forward_from_chat) {
    const c = message.forward_from_chat;
    return {
      kind: c.type === 'channel' ? 'channel' : 'chat',
      title: c.title || 'a chat',
      username: c.username ? `@${c.username}` : null
    };
  }
  if (message.forward_from) {
    const u = message.forward_from;
    return { kind: 'user', title: u.username ? `@${u.username}` : (u.first_name || 'a user') };
  }
  if (message.forward_sender_name) {
    return { kind: 'hidden', title: message.forward_sender_name };
  }
  return null;
}

// Find mentions and t.me references in entities + raw text.
function extractMentions(message) {
  const out = [];
  const text = extractText(message);
  const entities = message.entities || message.caption_entities || [];

  for (const e of entities) {
    if (e.type === 'mention') {
      out.push(text.substring(e.offset, e.offset + e.length).toLowerCase()); // @something
    } else if (e.type === 'text_mention' && e.user) {
      out.push(`@${(e.user.username || '').toLowerCase()}`);
    } else if (e.type === 'url' || e.type === 'text_link') {
      const url = (e.type === 'text_link') ? e.url : text.substring(e.offset, e.offset + e.length);
      if (url && /(?:^|\/)(?:t\.me|telegram\.me|telegram\.dog)\//i.test(url)) {
        out.push(url.toLowerCase());
      }
    }
  }

  // Regex fallback for clients that don't include entities (forwarded captions, etc.)
  const tmeMatches = text.matchAll(TME_REGEX);
  for (const m of tmeMatches) out.push(`t.me/${m[1].toLowerCase()}`);

  const atMatches = text.matchAll(MENTION_REGEX);
  for (const m of atMatches) out.push(`@${m[1].toLowerCase()}`);

  return [...new Set(out)];
}

// Unicode confusables — Cyrillic/Greek/Armenian glyphs that render identically
// to Latin letters. "pоrn" with a Cyrillic о sails past a plain substring match.
const CONFUSABLES = {
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'и': 'u', 'й': 'u', 'к': 'k',
  'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x',
  'ь': 'b', 'ѕ': 's', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'ѵ': 'v',
  // Greek
  'α': 'a', 'β': 'b', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w', 'σ': 'o', 'ς': 's',
  // Misc lookalikes
  'ℓ': 'l', 'ı': 'i', 'ɩ': 'i', 'ʟ': 'l', 'ᴏ': 'o', 'ᴘ': 'p', 'ᴎ': 'n', 'ɴ': 'n'
};
const CONFUSABLES_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

// Leetspeak + confusables-aware normalization: P0RN → porn, pоrn (Cyrillic о) → porn,
// ｐｏｒｎ (fullwidth) → porn, $3X → sex. We keep the original lower-case for emoji-only
// blacklist entries (🔞, 💦) and run the normalized version as a second pass.
function normalizeForMatch(s) {
  if (!s) return '';
  let out = s;
  try { out = out.normalize('NFKC'); } catch (e) {} // fullwidth/circled/styled → plain
  return out.toLowerCase()
    .replace(CONFUSABLES_RE, ch => CONFUSABLES[ch] || ch)
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3€]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5\$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[8]/g, 'b')
    .replace(/[ø]/g, 'o')
    .replace(/[^a-z0-9\s]/g, ' ')   // strip stylistic separators
    .replace(/\s+/g, ' ');
}

// Returns the offending blacklist word if `text` (or its leetspeak-normalized form)
// contains a blacklisted token. Tries both passes so emoji-only entries still match.
function findBlacklistHit(text, blacklist) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const normalized = normalizeForMatch(text);
  for (const word of blacklist) {
    if (!word) continue;
    const wl = word.toLowerCase();
    if (lower.includes(wl)) return word;
    const wNorm = normalizeForMatch(word);
    if (wNorm.length >= 3 && normalized.includes(wNorm)) return word;
  }
  return null;
}

// Pulls all text rendered in inline-keyboard buttons (label + url).
// Many spam bots hide profanity here instead of in the message body.
function extractButtonText(message) {
  if (!message || !message.reply_markup) return '';
  const kb = message.reply_markup.inline_keyboard;
  if (!Array.isArray(kb)) return '';
  const parts = [];
  for (const row of kb) {
    if (!Array.isArray(row)) continue;
    for (const btn of row) {
      if (!btn) continue;
      if (btn.text) parts.push(String(btn.text));
      if (btn.url) parts.push(String(btn.url));
      if (btn.callback_data) parts.push(String(btn.callback_data));
      if (btn.web_app && btn.web_app.url) parts.push(String(btn.web_app.url));
      if (btn.login_url && btn.login_url.url) parts.push(String(btn.login_url.url));
      if (btn.copy_text && btn.copy_text.text) parts.push(String(btn.copy_text.text));
      if (btn.switch_inline_query) parts.push(String(btn.switch_inline_query));
    }
  }
  return parts.join(' ');
}

async function isAdminCached(ctx, userId) {
  const key = `${ctx.chat.id}:${userId}`;
  const cached = adminCache[key];
  if (cached && nowMs() - cached.ts < ADMIN_CACHE_MS) return cached.isAdmin;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    const isAdmin = ['creator', 'administrator'].includes(member.status);
    adminCache[key] = { isAdmin, ts: nowMs() };
    return isAdmin;
  } catch (err) {
    return false;
  }
}

function displayName(from) {
  if (!from) return 'user';
  return from.username ? `@${from.username}` : (from.first_name || `User_${from.id}`);
}

// Ban a member and (by default) wipe ALL of their messages in the group in one
// shot via Telegram's revoke_messages flag. Falls back to a plain ban if the
// chat type doesn't support revocation, so genuine permission errors still throw.
async function banMember(telegram, chatId, userId) {
  const s = config.loadSettings();
  const revoke = !(s.enforcement && s.enforcement.revokeMessagesOnBan === false); // default true
  if (!revoke) return telegram.banChatMember(chatId, userId);
  try {
    return await telegram.banChatMember(chatId, userId, undefined, { revoke_messages: true });
  } catch (e) {
    // revoke_messages unsupported here → retry plain (a real permission error re-throws).
    return telegram.banChatMember(chatId, userId);
  }
}

// ---------- silentMode gates ----------
// All return `true` if the bot should KEEP QUIET about this kind of event.
function silentForModeration(settings) {
  return !!(settings && settings.silentMode && settings.silentMode.enabled && settings.silentMode.suppressActionNotices !== false);
}
function silentForWelcome(settings) {
  return !!(settings && settings.silentMode && settings.silentMode.enabled && settings.silentMode.suppressWelcome !== false);
}
function silentForCaptcha(settings) {
  return !!(settings && settings.silentMode && settings.silentMode.enabled && settings.silentMode.suppressCaptcha === true);
}
function silentForAnnouncement(settings) {
  return !!(settings && settings.silentMode && settings.silentMode.enabled && settings.silentMode.suppressAnnouncements !== false);
}

// Reply that auto-suppresses + auto-deletes when silentMode.suppressActionNotices is on.
// Used by admin action commands so their confirmations don't appear to other group members.
async function actionReply(ctx, text, opts = {}) {
  const settings = config.loadSettings();
  if (silentForModeration(settings)) return null;
  try {
    const sent = await ctx.reply(text, opts);
    // Auto-clean any admin command reply after 6s so the group stays quiet
    if (sent && opts.autoDelete !== false) {
      setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {}), 6000);
    }
    return sent;
  } catch (e) { return null; }
}

// Map a stat key → log level so each violation type has its own filterable channel.
const STAT_TO_LEVEL = {
  spamBlocked: 'FLOOD',
  linksDeleted: 'LINK',
  forwardsBlocked: 'FORWARD',
  mentionsBlocked: 'MENTION',
  nsfwMediaBlocked: 'MEDIA',
  buttonsBlocked: 'BUTTON',
  previewsBlocked: 'PREVIEW',
  profanityDeleted: 'PROFANITY',
  namesBlocked: 'NAME',
  senderChatBlocked: 'SENDERCHAT',
  zalgoBlocked: 'ZALGO',
  adultEmojiBlocked: 'MEDIA',
  premiumEmojiBlocked: 'PREMIUM',
  newUserBlocked: 'NEWUSER',
  contentBlocked: 'CONTENT',
  casHits: 'CAS'
};

// Plain-English name for each violation category (keyed by log level).
const HUMAN_CATEGORY = {
  FLOOD: 'flooding', LINK: 'a link', FORWARD: 'a forwarded message',
  MENTION: 'an external channel/group mention', MEDIA: 'NSFW media',
  BUTTON: 'button / CTA spam', PREVIEW: 'a link preview',
  PROFANITY: 'a banned word', ZALGO: 'obfuscated (zalgo) text',
  SENDERCHAT: 'a post made as a channel', PREMIUM: 'a premium emoji/sticker',
  NEWUSER: 'restricted content from a new member', CONTENT: 'a blocked content type',
  DELETE: 'a flagged message'
};

// Central enforcement: delete the message and optionally warn/mute/ban.
async function applyAction(ctx, opts) {
  const { action, reason, statKey, warnReason } = opts;
  const userId = ctx.from.id;
  const username = ctx.from.username || null;
  const display = displayName(ctx.from);
  const chatTitle = (ctx.chat && ctx.chat.title) || 'the group';
  const level = STAT_TO_LEVEL[statKey] || 'DELETE';
  const cat = HUMAN_CATEGORY[level] || 'a flagged message';
  const settings = config.loadSettings();
  const silent = silentForModeration(settings);

  if (statKey) config.incrementStat(statKey);

  try { await ctx.deleteMessage(); } catch (e) {}

  if (action === 'delete') {
    config.logEvent(level, `🗑️ Removed ${cat} from ${display} in “${chatTitle}”.`);
    return;
  }

  if (action === 'delete_and_warn' || action === 'warn') {
    config.logEvent(level, `🗑️ Removed ${cat} from ${display} in “${chatTitle}”.`);
    const count = config.addWarning(userId, username, warnReason || reason);
    if (!silent) {
      try {
        const sent = await ctx.reply(`⚠️ ${display}, ${warnReason || reason}. Warning ${count}/3.`);
        setTimeout(() => ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {}), 8000);
      } catch (e) {}
    }
    if (count >= 3) {
      try {
        await banMember(ctx.telegram, ctx.chat.id, userId);
        config.addBan(userId, username, `Reached 3 warnings (${warnReason || reason})`, ctx.chat.id);
        config.clearWarnings(userId);
        markRemoved(ctx.chat.id, userId);
        // Ban happens silently — dashboard logs it under the BAN level.
      } catch (e) {
        config.logEvent('ERROR', `Ban FAILED for ${display} (check the bot has "Ban Users" admin rights): ${e.message}`);
      }
    }
    return;
  }

  if (action === 'mute') {
    try {
      config.logEvent(level, `🗑️ Removed ${cat} from ${display} in “${chatTitle}”.`);
      await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
        permissions: zeroPermissions(),
        until_date: Math.floor(Date.now() / 1000) + 30 * 60
      });
      config.addMute(userId, username, 30, warnReason || reason);
      markRemoved(ctx.chat.id, userId);
      if (!silent) ctx.reply(`🔇 Muted ${display} for 30 minutes (${warnReason || reason}).`).catch(() => {});
    } catch (e) {
      config.logEvent('ERROR', `Mute FAILED for ${display} (check the bot has "Restrict Members" admin rights): ${e.message}`);
    }
    return;
  }

  if (action === 'ban') {
    try {
      config.logEvent(level, `🗑️ Removed ${cat} from ${display} in “${chatTitle}”.`);
      await banMember(ctx.telegram, ctx.chat.id, userId);
      config.addBan(userId, username, warnReason || reason, ctx.chat.id);
      markRemoved(ctx.chat.id, userId);
      // Ban happens silently — dashboard logs it under the BAN level.
    } catch (e) {
      config.logEvent('ERROR', `Ban FAILED for ${display} (check the bot has "Ban Users" admin rights): ${e.message}`);
    }
    return;
  }
}

function zeroPermissions() {
  return {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false
  };
}

function fullPermissions() {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true
  };
}

// -------- Individual checks. Each returns true if it handled the message. --------

async function checkAntiFlood(ctx, settings) {
  if (!settings.antiSpam.enabled) return false;
  const userId = ctx.from.id;
  const now = nowMs();
  const text = extractText(ctx.message);

  // Rate window
  if (!messageTimestamps[userId]) messageTimestamps[userId] = [];
  messageTimestamps[userId].push(now);
  messageTimestamps[userId] = messageTimestamps[userId].filter(t => now - t < settings.antiSpam.intervalMs);

  // Duplicate detection
  if (!messageHashes[userId]) messageHashes[userId] = [];
  if (text) {
    const h = hashMessage(text);
    messageHashes[userId].push({ ts: now, hash: h });
    messageHashes[userId] = messageHashes[userId].filter(e => now - e.ts < settings.antiSpam.intervalMs * 4);
    const sameCount = messageHashes[userId].filter(e => e.hash === h).length;
    if (sameCount >= (settings.antiSpam.duplicateLimit || 3)) {
      await applyAction(ctx, {
        action: settings.antiSpam.action,
        reason: 'duplicate flood',
        warnReason: 'sending the same message repeatedly',
        statKey: 'spamBlocked'
      });
      return true;
    }
  }

  if (messageTimestamps[userId].length > settings.antiSpam.maxMessages) {
    await applyAction(ctx, {
      action: settings.antiSpam.action,
      reason: 'rate flood',
      warnReason: 'sending messages too quickly',
      statKey: 'spamBlocked'
    });
    return true;
  }
  return false;
}

async function checkAntiForward(ctx, settings) {
  if (!settings.antiForward.enabled) return false;
  const fwd = getForwardSource(ctx.message);
  if (!fwd) return false;
  if (fwd.kind === 'channel' && !settings.antiForward.blockChannels) return false;
  if (fwd.kind === 'user' && !settings.antiForward.blockUsers) return false;
  if (fwd.kind === 'chat' && !settings.antiForward.blockUsers) return false;
  if (fwd.kind === 'hidden' && !settings.antiForward.blockHidden) return false;

  await applyAction(ctx, {
    action: settings.antiForward.action,
    reason: `forward from ${fwd.kind} (${fwd.title})`,
    warnReason: 'forwarding content from other channels/users is not allowed',
    statKey: 'forwardsBlocked'
  });
  return true;
}

async function checkAntiMention(ctx, settings) {
  if (!settings.antiMention.enabled) return false;
  const mentions = extractMentions(ctx.message);
  if (!mentions.length) return false;

  const whitelist = (settings.antiMention.whitelistUsernames || []).map(s => s.toLowerCase());
  const myUsername = ctx.botInfo && ctx.botInfo.username
    ? `@${ctx.botInfo.username.toLowerCase()}`
    : (bot && bot.botInfo && bot.botInfo.username ? `@${bot.botInfo.username.toLowerCase()}` : null);

  for (const m of mentions) {
    const lower = m.toLowerCase();
    if (whitelist.includes(lower)) continue;
    if (myUsername && lower === myUsername) continue;

    const isTme = lower.startsWith('t.me/') || lower.includes('://t.me/') ||
                  lower.startsWith('telegram.me/') || lower.startsWith('telegram.dog/');
    const isAtChannel = lower.startsWith('@');

    if (isTme && settings.antiMention.blockChannelMentions) {
      await applyAction(ctx, {
        action: settings.antiMention.action,
        reason: `channel link ${m}`,
        warnReason: 'sharing other channels/groups is not allowed',
        statKey: 'mentionsBlocked'
      });
      return true;
    }
    if (isAtChannel && settings.antiMention.blockChannelMentions) {
      // We can't always distinguish @user from @channel server-side without lookup.
      // Treat any @handle not in the known-member cache as a channel reference.
      const cached = usernameToId[lower];
      if (!cached || !cached.id) {
        await applyAction(ctx, {
          action: settings.antiMention.action,
          reason: `unknown handle ${m}`,
          warnReason: 'mentioning external channels/groups is not allowed',
          statKey: 'mentionsBlocked'
        });
        return true;
      }
      if (settings.antiMention.blockUserMentions) {
        await applyAction(ctx, {
          action: settings.antiMention.action,
          reason: `user mention ${m}`,
          warnReason: 'tagging other users is not allowed here',
          statKey: 'mentionsBlocked'
        });
        return true;
      }
    }
  }
  return false;
}

// ---------- Strong link detection (used by checkAntiLink) ----------
// Telegram + clone-domain hosts always treated as links.
const TG_HOST_RE = /\b(?:t\.me|telegram\.(?:me|dog|org)|telegra\.ph|graph\.org|tx\.me|tlgrm\.ru|tlgg\.ru)\/[^\s<>]+/i;
// Any explicit scheme://...
const ANY_SCHEME_RE = /\b(?:[a-z][a-z0-9+\-.]{0,20}):\/\/[^\s<>]+/i;
// Schemes without "//" (mailto:, magnet:, tel:, tg:)
const COLON_SCHEME_RE = /\b(?:mailto|magnet|tel|tg|sms|bitcoin|ethereum):[^\s<>]+/i;
// www. or m. prefixed
const WWW_RE = /\b(?:www|m|mobile|web|app)\.[a-z0-9][a-z0-9-]{0,62}\.[a-z]{2,24}\b(?:\/[^\s<>]*)?/i;
// Famous URL shorteners
const SHORTLINK_RE = /\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|adf\.ly|bit\.do|shorturl\.at|cutt\.ly|rebrand\.ly|rb\.gy|s\.id|short\.io|tiny\.cc|trib\.al|tr\.im|x\.co|lnkd\.in|chilp\.it|yourls\.org|qr\.ae|v\.gd|po\.st|chart\.ly|youtu\.be|fb\.me|amzn\.to|wp\.me|ift\.tt|dlvr\.it|tinyarrows\.com|shorte\.st|tiny\.one|2no\.co|short\.cm|mcaf\.ee)\b/i;
// Raw IPv4 + optional port + path
const IPV4_RE = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?(?:\/[^\s<>]*)?/;
// Bare domains: name.tld with a known TLD. Wide TLD coverage so admins can't typo-bypass.
const COMMON_TLDS = (
  'com|net|org|io|me|xyz|app|dev|co|tv|cc|ru|info|biz|tk|ml|ga|cf|live|site|online|shop|club|fun|top|vip|xxx|porn|sex|adult|to|ws|us|uk|in|de|fr|jp|cn|au|ca|br|mx|es|it|nl|kr|ph|sg|hk|tw|th|vn|id|my|pk|bd|lk|np|ae|sa|qa|tr|eg|ng|ke|gh|ma|za|store|tech|world|today|news|press|pro|name|link|click|sh|ly|gg|ai|cloud|digital|host|website|fans|girl|girls|sexy|nude|nudes|leak|leaks|hot|cam|cams|wtf|fail|porn|adult|sex|kim|stream|video|movie|movies|red|blue|black|exposed|directory|video|videos|webcam|tube|com\\.tr|com\\.br|co\\.in|co\\.uk|co\\.jp|co\\.kr|co\\.za|com\\.au|com\\.cn|com\\.mx|com\\.pk|com\\.ar|com\\.sa|com\\.eg|com\\.ng|com\\.bd|com\\.np'
);
const BARE_DOMAIN_RE = new RegExp(`(?:^|[^a-z0-9@])([a-z0-9][a-z0-9-]{0,62}\\.(?:${COMMON_TLDS}))(?:\\/[^\\s<>]*)?\\b`, 'i');

function detectAnyLink(text, strict) {
  if (!text) return null;
  if (ANY_SCHEME_RE.test(text)) return 'scheme';
  if (COLON_SCHEME_RE.test(text)) return 'scheme';
  if (TG_HOST_RE.test(text)) return 'telegram';
  if (WWW_RE.test(text)) return 'www';
  if (SHORTLINK_RE.test(text)) return 'shortener';
  if (IPV4_RE.test(text)) return 'ip';
  if (strict && BARE_DOMAIN_RE.test(text)) return 'bare-domain';
  return null;
}

function extractAllUrls(text, entities) {
  const out = [];
  for (const e of (entities || [])) {
    if (e.type === 'text_link' && e.url) out.push(e.url);
    else if (e.type === 'url') out.push(text.substring(e.offset, e.offset + e.length));
  }
  const reList = [ANY_SCHEME_RE, COLON_SCHEME_RE, TG_HOST_RE, WWW_RE, SHORTLINK_RE, IPV4_RE, BARE_DOMAIN_RE];
  for (const re of reList) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = globalRe.exec(text)) !== null) {
      out.push(m[0].replace(/^[^a-z0-9]/i, ''));
      if (m[0].length === 0) break;
    }
  }
  return [...new Set(out)];
}

async function checkAntiLink(ctx, settings) {
  if (!settings.antiLink.enabled) return false;
  const text = extractText(ctx.message);
  const entities = ctx.message.entities || ctx.message.caption_entities || [];

  const linkEntityTypes = new Set(['url', 'text_link']);
  if (settings.antiLink.strictMode) {
    // Telegram already detects these as separate entity types
    linkEntityTypes.add('email');
    linkEntityTypes.add('phone_number');
  }
  const entityLinks = entities.filter(e => linkEntityTypes.has(e.type));
  const detected = detectAnyLink(text, settings.antiLink.strictMode);

  if (!entityLinks.length && !detected) return false;

  // Whitelist — only enforced when not strict, and only against hostname matches.
  const whitelist = (settings.antiLink.whitelistDomains || []).map(d => d.toLowerCase());
  if (whitelist.length && !settings.antiLink.strictMode) {
    const urls = extractAllUrls(text, entities);
    const allWhitelisted = urls.length > 0 && urls.every(u => {
      try {
        const host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase();
        return whitelist.some(w => host === w || host.endsWith(`.${w}`));
      } catch (e) { return false; }
    });
    if (allWhitelisted) return false;
  }

  const reason = detected ? `link (${detected})` : `link entity (${entityLinks[0].type})`;
  await applyAction(ctx, {
    action: settings.antiLink.action,
    reason,
    warnReason: 'sharing links is not allowed in this group',
    statKey: 'linksDeleted'
  });
  return true;
}

async function checkAntiMedia(ctx, settings) {
  if (!settings.antiMedia.enabled) return false;
  const m = ctx.message;

  // Blanket-blocked media types
  if (m.sticker && settings.antiMedia.blockStickers) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'sticker blocked',
      warnReason: 'stickers are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.animation && settings.antiMedia.blockAnimations) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'animation/gif blocked',
      warnReason: 'GIFs are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.video_note && settings.antiMedia.blockVideoNotes) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'video note blocked',
      warnReason: 'round video messages are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.photo && settings.antiMedia.blockPhotos) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'photo blocked',
      warnReason: 'photos are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.video && settings.antiMedia.blockVideos) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'video blocked',
      warnReason: 'videos are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.document && settings.antiMedia.blockDocuments) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'document blocked',
      warnReason: 'file uploads are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.voice && settings.antiMedia.blockVoice) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'voice note blocked',
      warnReason: 'voice messages are not allowed here',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }

  // Photos commonly arrive as bait thumbnails with empty/short captions
  if (m.photo && settings.antiMedia.requireCaptionForPhotos && !m.caption) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'photo without caption',
      warnReason: 'photos must include a caption explaining what they are',
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }
  if (m.photo && settings.antiMedia.minPhotoCaptionLen > 0 &&
      (!m.caption || m.caption.trim().length < settings.antiMedia.minPhotoCaptionLen)) {
    await applyAction(ctx, {
      action: settings.antiMedia.action,
      reason: 'photo caption too short',
      warnReason: `photo captions must be at least ${settings.antiMedia.minPhotoCaptionLen} characters`,
      statKey: 'nsfwMediaBlocked'
    });
    return true;
  }

  const blacklist = (config.loadSettings().profanity.blacklist) || [];

  // Sticker emoji scan (e.g. 🔞 packs)
  if (m.sticker && settings.antiMedia.scanStickerEmoji && m.sticker.emoji) {
    const hit = findBlacklistHit(m.sticker.emoji, blacklist);
    if (hit) {
      await applyAction(ctx, {
        action: settings.antiMedia.action,
        reason: `nsfw sticker emoji "${hit}"`,
        warnReason: 'NSFW sticker not allowed',
        statKey: 'nsfwMediaBlocked'
      });
      return true;
    }
    // Sticker set name scan
    if (m.sticker.set_name) {
      const setHit = findBlacklistHit(m.sticker.set_name.replace(/_/g, ' '), blacklist);
      if (setHit) {
        await applyAction(ctx, {
          action: settings.antiMedia.action,
          reason: `nsfw sticker set "${m.sticker.set_name}"`,
          warnReason: 'NSFW sticker pack not allowed',
          statKey: 'nsfwMediaBlocked'
        });
        return true;
      }
    }
  }

  // Document/file name scan (thumbnails are shared as photos+captions or documents)
  if (settings.antiMedia.scanFileNames) {
    const fileName = (m.document && m.document.file_name) ||
                     (m.audio && (m.audio.file_name || m.audio.title)) ||
                     (m.video && m.video.file_name) || '';
    if (fileName) {
      const hit = findBlacklistHit(fileName, blacklist);
      if (hit) {
        await applyAction(ctx, {
          action: settings.antiMedia.action,
          reason: `nsfw file name "${fileName}" (${hit})`,
          warnReason: 'NSFW file blocked',
          statKey: 'nsfwMediaBlocked'
        });
        return true;
      }
    }
  }

  // Caption scan for any media (photo, video, document, voice, etc.)
  if (settings.antiMedia.scanCaptions && m.caption) {
    const hit = findBlacklistHit(m.caption, blacklist);
    if (hit) {
      await applyAction(ctx, {
        action: settings.antiMedia.action,
        reason: `nsfw caption keyword "${hit}"`,
        warnReason: 'NSFW content blocked',
        statKey: 'nsfwMediaBlocked'
      });
      return true;
    }
  }

  return false;
}

// -------- Adult-emoji detection --------
// Single emojis explicit enough that one is enough to block.
const SOLO_ADULT_EMOJIS = new Set(['🔞']);
// Suggestive emojis — innocent alone, suspicious in combo / density.
const ADULT_EMOJIS = new Set([
  '🍆','🍑','💦','👅','🥵','🤤','😈','🫦','🍌','🥒',
  '🩲','🩳','💋','👙','🥥','🍒','🫧','🍯','🫳','🫴',
  '🩴','🦵','🦶','🫣','😏','👄'
]);

// Skin-tone modifiers + variation selectors to strip when normalizing.
const SKIN_TONES = new Set(['🏻','🏼','🏽','🏾','🏿']);
const VARIATION_SELECTOR_16 = '️';
const ZWJ = '‍';

// Iterate graphemes (best-effort). Falls back to code-point iteration when Intl.Segmenter is missing.
function* graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const s of seg.segment(text)) yield s.segment;
  } else {
    for (const ch of text) yield ch;
  }
}

// Reduce a grapheme to its "base" emoji — strip skin tone, FE0F, ZWJ sequences.
function baseEmoji(g) {
  if (!g) return '';
  let out = '';
  for (const ch of g) {
    if (SKIN_TONES.has(ch)) continue;
    if (ch === VARIATION_SELECTOR_16) continue;
    if (ch === ZWJ) break; // take the head of a ZWJ sequence
    out += ch;
  }
  return out;
}

function countAdultEmojis(text) {
  let solo = 0, suggestive = 0, totalGraphemes = 0, anyEmoji = 0;
  if (!text) return { solo, suggestive, totalGraphemes, anyEmoji, ratio: 0 };
  for (const g of graphemes(text)) {
    if (g.trim().length === 0) continue;
    totalGraphemes++;
    const base = baseEmoji(g);
    if (SOLO_ADULT_EMOJIS.has(base)) { solo++; anyEmoji++; continue; }
    if (ADULT_EMOJIS.has(base))      { suggestive++; anyEmoji++; continue; }
    // crude check whether this grapheme is any emoji at all
    if (/\p{Extended_Pictographic}/u.test(g)) anyEmoji++;
  }
  const ratio = totalGraphemes > 0 ? (solo + suggestive) / totalGraphemes : 0;
  return { solo, suggestive, totalGraphemes, anyEmoji, ratio };
}

async function checkAntiAdultEmoji(ctx, settings) {
  const s = settings.antiAdultEmoji;
  if (!s || !s.enabled) return false;
  const m = ctx.message;

  // Sticker emoji check
  if (s.blockOnSticker && m.sticker && m.sticker.emoji) {
    const base = baseEmoji(m.sticker.emoji);
    if (SOLO_ADULT_EMOJIS.has(base) || ADULT_EMOJIS.has(base)) {
      await applyAction(ctx, {
        action: s.action,
        reason: `adult emoji sticker (${m.sticker.emoji})`,
        warnReason: 'sending adult-themed stickers is not allowed',
        statKey: 'adultEmojiBlocked'
      });
      return true;
    }
  }

  let text = m.text || '';
  if (s.scanCaptions && m.caption) text += '\n' + m.caption;
  if (!text) return false;

  const stats = countAdultEmojis(text);

  // Any single explicit emoji (🔞) → block
  if (stats.solo > 0) {
    await applyAction(ctx, {
      action: s.action,
      reason: `explicit emoji (×${stats.solo})`,
      warnReason: 'using 18+ / adult emoji is not allowed',
      statKey: 'adultEmojiBlocked'
    });
    return true;
  }
  // Combo threshold
  if (stats.suggestive >= (s.threshold || 2)) {
    await applyAction(ctx, {
      action: s.action,
      reason: `${stats.suggestive} suggestive emojis`,
      warnReason: 'sending adult emoji combinations is not allowed',
      statKey: 'adultEmojiBlocked'
    });
    return true;
  }
  // High density of adult emojis on short messages (e.g. "🍆💦" alone)
  if ((stats.solo + stats.suggestive) >= 1 &&
      stats.ratio >= (s.densityRatio || 0.4) &&
      stats.totalGraphemes <= 12) {
    await applyAction(ctx, {
      action: s.action,
      reason: `dense adult emoji message (ratio ${(stats.ratio * 100).toFixed(0)}%)`,
      warnReason: 'sending adult emoji is not allowed',
      statKey: 'adultEmojiBlocked'
    });
    return true;
  }
  return false;
}

// -------- Anti premium custom emoji + premium sticker --------
async function checkAntiPremiumEmoji(ctx, settings) {
  const s = settings.antiPremiumEmoji;
  if (!s || !s.enabled) return false;
  const m = ctx.message;

  const customBlocklist = new Set((s.customEmojiBlocklist || []).map(String));
  const setBlocklist = new Set((s.stickerSetBlocklist || []).map(x => String(x).toLowerCase()));

  // Custom emoji entities embedded in text or caption
  const entities = m.entities || m.caption_entities || [];
  const customEmojis = entities.filter(e => e.type === 'custom_emoji' && e.custom_emoji_id);

  if (customEmojis.length > 0) {
    const blockedId = customEmojis.find(e => customBlocklist.has(String(e.custom_emoji_id)));
    if (blockedId) {
      await applyAction(ctx, {
        action: s.action,
        reason: `blocked custom_emoji_id ${blockedId.custom_emoji_id}`,
        warnReason: 'this custom emoji is blocked here',
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
    if (s.blockAllCustomEmoji) {
      await applyAction(ctx, {
        action: s.action,
        reason: `${customEmojis.length} premium custom emoji(s)`,
        warnReason: 'premium custom emojis are not allowed here',
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
  }

  // Sticker checks
  if (m.sticker) {
    const st = m.sticker;
    if (st.custom_emoji_id && customBlocklist.has(String(st.custom_emoji_id))) {
      await applyAction(ctx, {
        action: s.action,
        reason: `blocked custom-emoji sticker ${st.custom_emoji_id}`,
        warnReason: 'this sticker is blocked here',
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
    if (st.set_name && setBlocklist.has(st.set_name.toLowerCase())) {
      await applyAction(ctx, {
        action: s.action,
        reason: `blocked sticker pack "${st.set_name}"`,
        warnReason: `the sticker pack "${st.set_name}" is blocked here`,
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
    if (st.is_video && s.blockVideoStickers) {
      await applyAction(ctx, {
        action: s.action,
        reason: `video sticker (${st.set_name || 'no set'})`,
        warnReason: 'video stickers are not allowed here',
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
    if (st.is_animated && s.blockAnimatedStickers) {
      await applyAction(ctx, {
        action: s.action,
        reason: `animated sticker (${st.set_name || 'no set'})`,
        warnReason: 'animated stickers are not allowed here',
        statKey: 'premiumEmojiBlocked'
      });
      return true;
    }
  }

  return false;
}

async function checkProfanity(ctx, settings) {
  if (!settings.profanity.enabled) return false;
  const text = extractText(ctx.message);
  if (!text) return false;
  const hit = findBlacklistHit(text, settings.profanity.blacklist || []);
  if (!hit) return false;

  await applyAction(ctx, {
    action: settings.profanity.action,
    reason: `prohibited keyword "${hit}"`,
    warnReason: `using prohibited word/topic ("${hit}")`,
    statKey: 'profanityDeleted'
  });
  return true;
}

// Heuristic: messages styled to look like buttons / call-to-action promos.
function looksLikeButtonText(text) {
  if (!text) return false;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return false;

  // Common fake-button markers
  const buttonEmojis = /[►▶◄◀⬅➡⏩⏪🔘🔵🟢🟡🟠🔴⚪⚫⬜⬛◽◾🟥🟧🟨🟩🟦🟪🟫]/u;
  const arrowEmojis = /[👉👈👇👆☝]/u;
  const ctaWords = /\b(click here|click below|tap here|tap below|join now|subscribe|join channel|join group|free download|download now|register now|sign ?up|enter chat|join chat|claim now|claim free|earn now)\b/i;

  let buttonLines = 0;
  for (const l of lines) {
    if (buttonEmojis.test(l) || arrowEmojis.test(l)) buttonLines++;
    if (/^\s*[\[\(【].{1,40}[\]\)】]\s*$/.test(l)) buttonLines++; // bracketed CTA "[CLICK HERE]"
    if (ctaWords.test(l) && l.length < 60) buttonLines++;
  }

  // Strong CTA — single line that screams a button
  if (lines.length <= 3 && ctaWords.test(text) && /[►▶👉👈⬅➡🔘]/u.test(text)) return true;

  // Two or more lines that look like fake buttons
  if (buttonLines >= 2) return true;

  // Long string of bracketed segments separated by symbols, e.g. "[ LINK ] | [ SHOP ] | [ JOIN ]"
  const brackets = (text.match(/\[[^\]]{1,30}\]/g) || []).length;
  if (brackets >= 2) return true;

  return false;
}

async function checkAntiButton(ctx, settings) {
  if (!settings.antiButton || !settings.antiButton.enabled) return false;
  const m = ctx.message;

  if (settings.antiButton.blockInlineKeyboards && m.reply_markup &&
      Array.isArray(m.reply_markup.inline_keyboard) &&
      m.reply_markup.inline_keyboard.length > 0) {
    await applyAction(ctx, {
      action: settings.antiButton.action,
      reason: 'inline keyboard',
      warnReason: 'messages with inline buttons are not allowed',
      statKey: 'buttonsBlocked'
    });
    return true;
  }

  if (settings.antiButton.blockViaBot && m.via_bot && m.via_bot.id !== (ctx.botInfo && ctx.botInfo.id)) {
    await applyAction(ctx, {
      action: settings.antiButton.action,
      reason: `sent via @${m.via_bot.username || m.via_bot.id}`,
      warnReason: 'messages sent via inline bots are not allowed',
      statKey: 'buttonsBlocked'
    });
    return true;
  }

  if (settings.antiButton.blockButtonText) {
    const text = extractText(m);
    if (looksLikeButtonText(text)) {
      await applyAction(ctx, {
        action: settings.antiButton.action,
        reason: 'button-style promo text',
        warnReason: 'button/CTA-style promotional messages are not allowed',
        statKey: 'buttonsBlocked'
      });
      return true;
    }
  }
  return false;
}

async function checkAntiPreview(ctx, settings) {
  if (!settings.antiPreview || !settings.antiPreview.enabled) return false;
  if (!settings.antiPreview.blockWebPreviews) return false;
  const m = ctx.message;

  // A message resolved to a link preview thumbnail by Telegram has `link_preview_options`
  // disabled state false, plus url/text_link entities. Telegram sometimes also surfaces
  // m.link_preview_options or m.web_page (in older bot API versions / channel posts).
  const hasWebPage = !!(m.web_page || (m.link_preview_options && m.link_preview_options.url));
  const text = extractText(m);
  const entities = m.entities || m.caption_entities || [];
  const hasUrlEntity = entities.some(e => e.type === 'url' || e.type === 'text_link');
  const looksLikeLink = /https?:\/\/|www\.|t\.me\//i.test(text);

  if (hasWebPage || (hasUrlEntity && looksLikeLink && !m.photo && !m.video && !m.animation)) {
    await applyAction(ctx, {
      action: settings.antiPreview.action,
      reason: 'link preview / thumbnail',
      warnReason: 'sharing link previews / thumbnails is not allowed',
      statKey: 'previewsBlocked'
    });
    return true;
  }
  return false;
}

// -------- Lock chat: drop any non-admin message when locked ----------
async function checkLockChat(ctx, settings) {
  if (!settings.lockChat || !settings.lockChat.locked) return false;
  try { await ctx.deleteMessage(); } catch (e) {}
  config.logEvent('LOCK', `Dropped message from ${displayName(ctx.from)} (chat locked)`);
  return true;
}

// -------- Anti sender_chat: user posting as a channel ----------
async function checkAntiSenderChat(ctx, settings) {
  if (!settings.antiSenderChat || !settings.antiSenderChat.enabled) return false;
  const senderChat = ctx.message.sender_chat;
  if (!senderChat) return false;
  // Linked channel of the same group is allowed (it's automatic discussion replies)
  if (ctx.chat.linked_chat_id && senderChat.id === ctx.chat.linked_chat_id) return false;
  await applyAction(ctx, {
    action: settings.antiSenderChat.action,
    reason: `posted as channel "${senderChat.title || senderChat.username || senderChat.id}"`,
    warnReason: 'posting as a channel is not allowed here',
    statKey: 'senderChatBlocked'
  });
  return true;
}

// -------- Anti Zalgo / RTL override ----------
async function checkAntiZalgo(ctx, settings) {
  if (!settings.antiZalgo || !settings.antiZalgo.enabled) return false;
  const text = extractText(ctx.message);
  if (!text) return false;

  if (settings.antiZalgo.blockRtlOverride && RTL_OVERRIDE_RE.test(text)) {
    await applyAction(ctx, {
      action: settings.antiZalgo.action,
      reason: 'RTL override character',
      warnReason: 'RTL/bidi override characters are not allowed',
      statKey: 'zalgoBlocked'
    });
    return true;
  }
  const combining = countCombining(text);
  if (combining > (settings.antiZalgo.maxCombiningChars || 30)) {
    await applyAction(ctx, {
      action: settings.antiZalgo.action,
      reason: `zalgo / combining chars (${combining})`,
      warnReason: 'message contains too many combining/zalgo characters',
      statKey: 'zalgoBlocked'
    });
    return true;
  }
  return false;
}

// -------- New-user restrictions: joiners' first messages get stricter rules ----------
// Kills the "join → instantly spam links" pattern. Only applies to users whose
// join we actually witnessed, so long-time members are never false-positived.
async function checkNewUserRestrictions(ctx, settings) {
  const s = settings.newUserRestrictions;
  if (!s || !s.enabled) return false;
  const key = `${ctx.chat.id}:${ctx.from.id}`;
  const joinedAt = joinTimes[key];
  if (!joinedAt) return false; // unknown join time → treat as established member

  const msgCount = firstMessageCounts[key] || 0;
  const withinTime = (Date.now() - joinedAt) < (s.durationMinutes || 1440) * 60000;
  const withinCount = msgCount < (s.messageCount || 3);
  if (!withinTime && !withinCount) {
    delete joinTimes[key]; // graduated — stop tracking
    return false;
  }

  const m = ctx.message;
  if (s.blockForwards && getForwardSource(m)) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'forward from brand-new member',
      warnReason: 'new members cannot forward messages yet',
      statKey: 'newUserBlocked'
    });
    return true;
  }
  if (s.blockLinks && detectAnyLink(extractText(m), true)) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'link from brand-new member',
      warnReason: 'new members cannot post links yet',
      statKey: 'newUserBlocked'
    });
    return true;
  }
  if (s.blockMedia && (m.photo || m.video || m.document || m.animation ||
                       m.sticker || m.video_note || m.voice || m.audio)) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'media from brand-new member',
      warnReason: 'new members cannot post media yet',
      statKey: 'newUserBlocked'
    });
    return true;
  }
  return false;
}

// -------- Content-type filters: paid media, spoilers, polls, games, etc. ----------
async function checkContentTypes(ctx, settings) {
  const s = settings.contentTypes;
  if (!s || !s.enabled) return false;
  const m = ctx.message;

  // Paid media (Telegram Stars) — the current porn-sale vector. Bots/users post
  // blurred previews that unlock for stars. Nothing legitimate uses this in groups.
  if (m.paid_media && s.blockPaidMedia) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'paid media (Telegram Stars)',
      warnReason: 'paid media is not allowed here',
      statKey: 'contentBlocked'
    });
    return true;
  }

  // Spoiler-hidden photos/videos ("tap to reveal" NSFW)
  if (m.has_media_spoiler && s.blockSpoilerMedia) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'spoiler-hidden media',
      warnReason: 'spoiler-hidden media is not allowed here',
      statKey: 'contentBlocked'
    });
    return true;
  }

  // Polls — scan question + every option against the blacklist (or blanket-block)
  if (m.poll) {
    if (s.blockPolls) {
      await applyAction(ctx, {
        action: s.action,
        reason: 'poll blocked',
        warnReason: 'polls are not allowed here',
        statKey: 'contentBlocked'
      });
      return true;
    }
    if (s.scanPolls) {
      const pollText = [m.poll.question, ...(m.poll.options || []).map(o => o.text)].join(' ');
      const blacklist = settings.profanity ? (settings.profanity.blacklist || []) : [];
      const hit = findBlacklistHit(pollText, blacklist);
      if (hit) {
        await applyAction(ctx, {
          action: s.action,
          reason: `nsfw poll ("${hit}")`,
          warnReason: 'NSFW poll content is not allowed',
          statKey: 'contentBlocked'
        });
        return true;
      }
      if (detectAnyLink(pollText, true)) {
        await applyAction(ctx, {
          action: s.action,
          reason: 'link inside poll',
          warnReason: 'links inside polls are not allowed',
          statKey: 'contentBlocked'
        });
        return true;
      }
    }
  }

  if (m.game && s.blockGames) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'game message',
      warnReason: 'game messages are not allowed here',
      statKey: 'contentBlocked'
    });
    return true;
  }

  if (m.contact && s.blockContacts) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'contact card',
      warnReason: 'sharing contact cards is not allowed here',
      statKey: 'contentBlocked'
    });
    return true;
  }

  if ((m.location || m.venue) && s.blockLocations) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'location share',
      warnReason: 'location shares are not allowed here',
      statKey: 'contentBlocked'
    });
    return true;
  }

  const text = m.text || m.caption || '';
  if (s.maxMessageLength > 0 && text.length > s.maxMessageLength) {
    await applyAction(ctx, {
      action: s.action,
      reason: `wall of text (${text.length} chars)`,
      warnReason: `messages longer than ${s.maxMessageLength} characters are not allowed`,
      statKey: 'contentBlocked'
    });
    return true;
  }

  if (s.blockRepeatedChars && /(.)\1{14,}/u.test(text)) {
    await applyAction(ctx, {
      action: s.action,
      reason: 'repeated-character spam',
      warnReason: 'character-flood messages are not allowed',
      statKey: 'contentBlocked'
    });
    return true;
  }

  return false;
}

// -------- Anti-Bot-Poster: any non-whitelisted bot posting → delete + ban ----------
async function checkAntiBotPoster(ctx, settings) {
  if (!ctx.from || !ctx.from.is_bot) return false;
  const s = settings.antiBotPoster;
  if (!s || !s.enabled) return false;

  const ids = new Set((s.whitelistBotIds || []).map(Number));
  const usernames = new Set((s.whitelistBotUsernames || []).map(u => String(u).toLowerCase().replace(/^@/, '')));
  if (ids.has(ctx.from.id)) return false;
  if (ctx.from.username && usernames.has(ctx.from.username.toLowerCase())) return false;

  // Always delete the message immediately
  try { await ctx.deleteMessage(); } catch (e) {}

  // Then remove the bot from the chat — exactly ONE log line per removal.
  const display = displayName(ctx.from);
  try {
    if (s.action === 'kick') {
      await ctx.telegram.banChatMember(ctx.chat.id, ctx.from.id);
      await ctx.telegram.unbanChatMember(ctx.chat.id, ctx.from.id);
      config.logEvent('KICK', `🥾 Kicked bot ${display} for posting in “${ctx.chat.title || 'the group'}”.`);
    } else if (s.action === 'delete') {
      config.logEvent('CONTENT', `🗑️ Removed a message from bot ${display} in “${ctx.chat.title || 'the group'}”.`);
    } else {
      // default: ban — addBan() already writes the BAN log line, so don't log again.
      await banMember(ctx.telegram, ctx.chat.id, ctx.from.id);
      config.addBan(ctx.from.id, ctx.from.username, 'bot posting in the group', ctx.chat.id);
    }
    config.incrementStat('botsRemoved');
    markRemoved(ctx.chat.id, ctx.from.id);
  } catch (e) {
    config.logEvent('ERROR', `Bot removal FAILED for ${display} (check the bot has "Ban Users" admin rights): ${e.message}`);
  }
  return true;
}

// -------- Pending captcha enforcement: delete anything from a user mid-captcha ----------
async function checkPendingCaptcha(ctx) {
  const key = `${ctx.chat.id}:${ctx.from.id}`;
  if (!pendingCaptchas[key]) return false;
  try { await ctx.deleteMessage(); } catch (e) {}
  return true;
}

// -------- Already-removed guard: silently clean up a banned user's leftover burst ----------
// Once someone is banned/kicked, their remaining queued messages still arrive.
// Just delete them — no re-ban, no duplicate log entries.
async function checkAlreadyRemoved(ctx) {
  if (!wasRecentlyRemoved(ctx.chat.id, ctx.from.id)) return false;
  try { await ctx.deleteMessage(); } catch (e) {}
  return true;
}

// -------- CAS (Combot Anti-Spam) lookup ----------
async function casLookup(userId) {
  try {
    if (typeof fetch !== 'function') return false; // Node <18, skip silently
    const res = await fetch(`https://api.cas.chat/check?user_id=${userId}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!(json && json.ok);
  } catch (e) {
    return false;
  }
}

// -------- Zalgo / RTL detection ----------
const COMBINING_RE = /[̀-ͯ҉ؐ-ًؚ-ٟۖ-ۜ۟-۪ۤۧۨ-ܑۭܰ-݊ަ-ް߫-߳]/g;
const RTL_OVERRIDE_RE = /[‪-‮⁦-⁩]/;

function countCombining(text) {
  if (!text) return 0;
  const m = text.match(COMBINING_RE);
  return m ? m.length : 0;
}

// -------- Captcha state ----------
// { `${chatId}:${userId}`: { answer, attempts, messageId, timer } }
const pendingCaptchas = {};
const firstMessageCounts = {}; // { `${chatId}:${userId}`: number }
const joinTimes = {};          // { `${chatId}:${userId}`: ts } — set when we SEE the user join

function buildCaptcha() {
  // simple "a + b = ?" with 4 choices, one correct
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const answer = a + b;
  const choices = new Set([answer]);
  while (choices.size < 4) {
    const candidate = Math.max(2, answer + Math.floor(Math.random() * 9) - 4);
    if (candidate !== answer) choices.add(candidate);
  }
  const shuffled = [...choices].sort(() => Math.random() - 0.5);
  return {
    question: `${a} + ${b} = ?`,
    answer,
    buttons: shuffled
  };
}

async function sendCaptcha(ctx, member, settings) {
  const captcha = buildCaptcha();
  const groupChatId = ctx.chat.id;
  const key = `${groupChatId}:${member.id}`;
  const display = member.username ? `@${member.username}` : (member.first_name || `User_${member.id}`);
  const replyToMessageId = ctx.message && ctx.message.message_id;

  // Restrict the new member fully until they answer
  try {
    await ctx.telegram.restrictChatMember(groupChatId, member.id, {
      permissions: zeroPermissions(),
      until_date: Math.floor(Date.now() / 1000) + settings.captcha.timeoutSeconds + 60
    });
  } catch (e) {
    config.logEvent('ERROR', `Captcha restrict failed for ${display}: ${e.message}`);
    return;
  }

  // callback_data embeds the group chat id so the button works from a DM context too.
  const replyMarkup = {
    inline_keyboard: [captcha.buttons.map(n => ({
      text: String(n),
      callback_data: `cap:${groupChatId}:${member.id}:${n}`
    }))]
  };
  const messageText =
    `🛡️ Welcome ${display}!\nPlease solve to chat: *${captcha.question}*\nYou have ${settings.captcha.timeoutSeconds}s.`;

  let captchaChatId = null;
  let messageId = null;

  // Step 1: try DM so only the new user sees the captcha.
  if (settings.captcha.tryDmFirst !== false) {
    try {
      const dm = await ctx.telegram.sendMessage(member.id, messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
      captchaChatId = member.id;
      messageId = dm.message_id;
    } catch (e) {
      // DM failed (user hasn't started chat with bot, or blocked it) — fall back to in-group.
    }
  }

  // Step 2: fallback in-group with quiet notification + reply attach to the join service msg.
  if (!captchaChatId) {
    try {
      const sent = await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
        reply_to_message_id: replyToMessageId,
        allow_sending_without_reply: true,
        disable_notification: settings.captcha.disableNotification !== false
      });
      captchaChatId = groupChatId;
      messageId = sent.message_id;
    } catch (e) {
      config.logEvent('ERROR', `Captcha send failed for ${display}: ${e.message}`);
      return;
    }
  }

  config.incrementStat('captchasIssued');
  config.logEvent('CAPTCHA',
    `Issued captcha to ${display} via ${captchaChatId === member.id ? 'DM' : 'group'} (answer ${captcha.answer})`);

  const timer = setTimeout(async () => {
    if (!pendingCaptchas[key]) return;
    delete pendingCaptchas[key];
    config.incrementStat('captchasFailed');
    config.logEvent('CAPTCHA', `Timed out for ${display}`);
    if (settings.captcha.kickOnFail) {
      try {
        await ctx.telegram.banChatMember(groupChatId, member.id);
        await ctx.telegram.unbanChatMember(groupChatId, member.id);
        config.logEvent('KICK', `Kicked ${display} for captcha timeout`);
      } catch (e) {}
    }
    if (messageId) ctx.telegram.deleteMessage(captchaChatId, messageId).catch(() => {});
  }, settings.captcha.timeoutSeconds * 1000);

  pendingCaptchas[key] = {
    answer: captcha.answer,
    attempts: 0,
    captchaChatId,
    messageId,
    groupChatId,
    timer,
    startedAt: nowMs()
  };
}

function initBot(token, opts = {}) {
  if (!token) {
    config.logEvent('ERROR', 'Cannot initialize bot: Token is missing.');
    return null;
  }
  // Reject duplicates by id-prefix so the same bot can't run twice.
  const idPrefix = String(token).split(':')[0];
  for (const rec of bots.values()) {
    if (rec && rec.info && String(rec.info.id) === idPrefix) {
      config.logEvent('WARN', `Bot id ${idPrefix} is already running; refusing to add twice.`);
      return rec.instance;
    }
  }

  // Optional owner id — Telegram user id allowed to interact in private chat.
  const ownerId = parseInt(process.env.TELEGRAM_OWNER_ID || '', 10);
  const hasOwner = !isNaN(ownerId) && ownerId > 0;

  // Per-user command rate-limit: prevent rogue admin flooding command handler.
  const commandTimestamps = {};
  function commandRateOk(userId) {
    const now = Date.now();
    const arr = commandTimestamps[userId] = (commandTimestamps[userId] || []).filter(t => now - t < 5000);
    arr.push(now);
    return arr.length <= 8; // max 8 commands per 5s per user
  }

  try {
    bot = new Telegraf(token, { handlerTimeout: 9_000 });
    config.logEvent('INFO', 'Initializing Telegraf Bot Instance...');

    // Wrap every update in a try/catch so one malformed update can't take down the bot.
    bot.use(async (ctx, next) => {
      try { await next(); }
      catch (err) { config.logEvent('ERROR', `Handler crashed: ${err.message}`); }
    });

    // Middleware to index usernames for command targeting + ignore private chats (unless owner).
    bot.use(async (ctx, next) => {
      if (ctx.from) {
        if (ctx.from.username) {
          usernameToId[`@${ctx.from.username.toLowerCase()}`] = {
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name || ''
          };
        }
        usernameToId[ctx.from.id] = {
          username: ctx.from.username ? `@${ctx.from.username}` : null,
          first_name: ctx.from.first_name
        };
      }
      // Hard gate: never speak in DMs except to the configured owner.
      if (ctx.chat && ctx.chat.type === 'private') {
        if (!hasOwner || (ctx.from && ctx.from.id !== ownerId)) {
          return; // silent drop
        }
      }
      return next();
    });

    // Capture every group message into the persistent cache so routine scans
    // can replay current rules against past traffic.
    bot.use(async (ctx, next) => {
      try {
        const myId2 = ctx.botInfo && ctx.botInfo.id;
        const isOurOwn = ctx.from && ctx.from.is_bot && myId2 && ctx.from.id === myId2;
        if (ctx.message && ctx.chat && ctx.chat.type !== 'private' &&
            ctx.from && !isOurOwn) {
          config.recordChat(ctx.chat.id, ctx.chat.title);
          const m = ctx.message;
          const isContentful = !!(m.text || m.caption || m.sticker || m.photo || m.video ||
                                  m.document || m.animation || m.voice || m.video_note ||
                                  m.poll || m.paid_media);
          if (isContentful) {
            const entities = m.entities || m.caption_entities || [];
            config.addMessageToCache({
              chatId: ctx.chat.id,
              chatTitle: ctx.chat.title || null,
              messageId: m.message_id,
              userId: ctx.from.id,
              username: ctx.from.username || null,
              firstName: ctx.from.first_name || null,
              text: (m.text || m.caption || '').slice(0, 4096),
              hasSticker: !!m.sticker,
              stickerSetName: (m.sticker && m.sticker.set_name) || null,
              stickerEmoji: (m.sticker && m.sticker.emoji) || null,
              stickerIsVideo: !!(m.sticker && m.sticker.is_video),
              stickerIsAnimated: !!(m.sticker && m.sticker.is_animated),
              stickerCustomEmojiId: (m.sticker && m.sticker.custom_emoji_id) || null,
              customEmojiIds: entities.filter(e => e.type === 'custom_emoji')
                                      .map(e => String(e.custom_emoji_id)),
              forwardFrom: getForwardSource(m),
              hasReplyMarkup: !!m.reply_markup,
              hasButtons: !!(m.reply_markup && Array.isArray(m.reply_markup.inline_keyboard) &&
                             m.reply_markup.inline_keyboard.length > 0),
              viaBotId: m.via_bot && m.via_bot.id,
              viaBotUsername: m.via_bot && m.via_bot.username,
              hasPhoto: !!m.photo,
              hasVideo: !!m.video,
              hasDocument: !!m.document,
              hasAnimation: !!m.animation,
              hasVoice: !!m.voice,
              hasVideoNote: !!m.video_note,
              documentName: (m.document && m.document.file_name) || null,
              senderChatId: m.sender_chat && m.sender_chat.id,
              hasPaidMedia: !!m.paid_media,
              hasSpoiler: !!m.has_media_spoiler,
              pollText: m.poll
                ? [m.poll.question, ...(m.poll.options || []).map(o => o.text)].join(' ').slice(0, 1024)
                : null,
              entities: entities.slice(0, 50).map(e => ({
                type: e.type, offset: e.offset, length: e.length, url: e.url, custom_emoji_id: e.custom_emoji_id
              })),
              ts: Date.now()
            });
          }
        }
      } catch (e) {
        // Cache errors must never break the bot
      }
      return next();
    });

    // New chat members handler (welcome + raid detection)
    bot.on('new_chat_members', async (ctx) => {
      const settings = config.loadSettings();
      const newMembers = ctx.message.new_chat_members;

      config.logEvent('JOIN', `${newMembers.length} new member(s) joined group: ${ctx.chat.title}`);

      if (settings.antiRaid.enabled) {
        const now = nowMs();
        recentJoins.push(now);
        const cutoff = now - (settings.antiRaid.intervalSeconds * 1000);
        recentJoins = recentJoins.filter(t => t > cutoff);

        if (recentJoins.length > settings.antiRaid.joinLimit) {
          if (!raidModeActive) {
            raidModeActive = true;
            config.logEvent('RAID', `ANTI-RAID TRIGGERED! Joins: ${recentJoins.length} in ${settings.antiRaid.intervalSeconds}s.`);
            if (!silentForAnnouncement(settings)) {
              ctx.reply(`🚨 **Anti-Raid Mode Activated!** Unusual join activity. Restricting new members.`).catch(() => {});
            }
          }
        }
      }

      for (const member of newMembers) {
        const display = member.username ? `@${member.username}` : (member.first_name || `User_${member.id}`);

        // Track join time → newUserRestrictions applies stricter rules to their first messages
        joinTimes[`${ctx.chat.id}:${member.id}`] = Date.now();
        firstMessageCounts[`${ctx.chat.id}:${member.id}`] = 0;

        // Always restrict known bots (other bots) — common spam vector
        if (member.is_bot && member.id !== (ctx.botInfo && ctx.botInfo.id)) {
          try {
            await banMember(ctx.telegram, ctx.chat.id, member.id);
            markRemoved(ctx.chat.id, member.id);
            config.logEvent('BAN', `🤖 Auto-removed bot ${display} that tried to join “${ctx.chat.title || 'the group'}”.`);
            continue;
          } catch (e) {}
        }

        // CAS (Combot Anti-Spam) blocklist check — fast, free, async
        if (settings.cas && settings.cas.enabled && !member.is_bot) {
          const cased = await casLookup(member.id);
          if (cased) {
            config.incrementStat('casHits');
            config.logEvent('CAS', `🌐 Blocked ${display} on join — flagged as a known spammer by the global CAS blocklist.`);
            try {
              if (settings.cas.action === 'kick') {
                await ctx.telegram.banChatMember(ctx.chat.id, member.id);
                await ctx.telegram.unbanChatMember(ctx.chat.id, member.id);
              } else if (settings.cas.action === 'restrict') {
                await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions: zeroPermissions() });
              } else {
                await banMember(ctx.telegram, ctx.chat.id, member.id);
                config.addBan(member.id, member.username, `CAS blocklist hit`, ctx.chat.id);
              }
              markRemoved(ctx.chat.id, member.id);
              // Removal is silent in the group; logged under CAS for the dashboard.
              continue;
            } catch (e) {}
          }
        }

        // NSFW name filter — username / first_name / last_name
        if (settings.nameFilter && settings.nameFilter.enabled && !member.is_bot) {
          const profile = [member.username, member.first_name, member.last_name].filter(Boolean).join(' ');
          const hit = findBlacklistHit(profile, settings.profanity.blacklist || []);
          if (hit) {
            config.incrementStat('namesBlocked');
            config.logEvent('NAME', `🚫 Removed ${display} on join — NSFW name (matched “${hit}”).`);
            try {
              if (settings.nameFilter.action === 'kick') {
                await ctx.telegram.banChatMember(ctx.chat.id, member.id);
                await ctx.telegram.unbanChatMember(ctx.chat.id, member.id);
              } else {
                await banMember(ctx.telegram, ctx.chat.id, member.id);
                config.addBan(member.id, member.username, `NSFW name: ${hit}`, ctx.chat.id);
              }
              markRemoved(ctx.chat.id, member.id);
              // NSFW-name removal is silent in the group; logged under NAME for the dashboard.
              continue;
            } catch (e) {}
          }
        }

        if (raidModeActive && settings.antiRaid.enabled && settings.antiRaid.action === 'restrict') {
          try {
            await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions: zeroPermissions() });
            config.logEvent('RAID', `Restricted joining user ${display} (Raid Mode).`);
          } catch (err) {
            config.logEvent('ERROR', `Failed to restrict ${display}: ${err.message}`);
          }
        }

        // Captcha — only if enabled and not already auto-blocked above
        if (settings.captcha && settings.captcha.enabled && !raidModeActive) {
          if (silentForCaptcha(settings)) {
            // Silent mode wants no captcha posted — just restrict member; admin must /unmute.
            try {
              await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, { permissions: zeroPermissions() });
              config.logEvent('CAPTCHA', `Silent-mode restrict (no captcha) on ${display}`);
            } catch (e) {}
          } else {
            await sendCaptcha(ctx, member, settings);
          }
          continue; // welcome message replaced
        }

        if (settings.welcome.enabled && !raidModeActive && !silentForWelcome(settings)) {
          const name = member.username ? `@${member.username}` : `${member.first_name}`;
          const welcomeMsg = (settings.welcome.text || '')
            .replace('{username}', name)
            .replace('{firstname}', member.first_name)
            .replace('{groupname}', ctx.chat.title || 'the group');
          try {
            const welcomeSent = await ctx.reply(welcomeMsg);
            if (settings.welcome.deleteAfterSeconds > 0) {
              setTimeout(() => {
                ctx.telegram.deleteMessage(ctx.chat.id, welcomeSent.message_id).catch(() => {});
              }, settings.welcome.deleteAfterSeconds * 1000);
            }
          } catch (err) {
            config.logEvent('ERROR', `Failed to send welcome message: ${err.message}`);
          }
        }
      }
    });

    // -------- Admin command helpers --------
    async function getCommandTarget(ctx) {
      if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
        const user = ctx.message.reply_to_message.from;
        return {
          id: user.id,
          username: user.username ? `@${user.username}` : `${user.first_name}`,
          firstName: user.first_name
        };
      }
      const text = ctx.message.text || '';
      const parts = text.split(/\s+/);
      if (parts.length > 1) {
        const arg = parts[1];
        if (arg.startsWith('@')) {
          const cached = usernameToId[arg.toLowerCase()];
          if (cached) return { id: cached.id, username: arg, firstName: cached.first_name };
          actionReply(ctx, `❌ Cannot find user ${arg}. They must send at least one message in the group first.`);
          return null;
        }
        const directId = parseInt(arg, 10);
        if (!isNaN(directId)) {
          const cached = usernameToId[directId];
          return {
            id: directId,
            username: cached && cached.username ? cached.username : `User_${directId}`,
            firstName: cached ? cached.first_name : 'User'
          };
        }
      }
      actionReply(ctx, `❌ Reply to a user's message or specify their @username / numeric ID.`);
      return null;
    }

    function adminOnly(handler) {
      return async (ctx) => {
        try {
          if (!ctx.from || !ctx.chat) return;
          if (!commandRateOk(ctx.from.id)) return; // silent rate-limit drop
          // PM owner is allowed (gated earlier); for groups require admin.
          if (ctx.chat.type !== 'private') {
            const ok = await isAdminCached(ctx, ctx.from.id);
            if (!ok) {
              try { await ctx.deleteMessage(); } catch (e) {}
              return; // silent: don't reveal command exists
            }
          }
          config.logEvent('COMMAND', `${displayName(ctx.from)} ran ${(ctx.message.text || '').split(' ')[0]}`);
          return await handler(ctx);
        } catch (err) {
          config.logEvent('ERROR', `Admin command crashed: ${err.message}`);
        }
      };
    }

    // -------- Admin commands --------
    bot.command('ban', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      try {
        await banMember(ctx.telegram, ctx.chat.id, target.id);
        config.addBan(target.id, target.username, `Banned by Admin ${displayName(ctx.from)}`, ctx.chat.id);
        markRemoved(ctx.chat.id, target.id);
        // Silent — dashboard shows the ban under the BAN log level.
      } catch (err) {
        actionReply(ctx, `❌ Failed to ban user: ${err.message}`);
      }
    }));

    bot.command('unban', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      try {
        await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
        config.removeBan(target.id);
        delete recentlyRemoved[`${ctx.chat.id}:${target.id}`]; // let them post again
        config.logEvent('UNBAN', `${displayName(ctx.from)} unbanned ${target.username}`);
        actionReply(ctx, `🔓 Unbanned ${target.username}.`);
      } catch (err) {
        actionReply(ctx, `❌ Failed to unban: ${err.message}`);
      }
    }));

    // Global ban: ban a user in EVERY chat the bot has ever seen.
    bot.command('gban', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      const chats = config.getKnownChats();
      const chatIds = Object.keys(chats);
      let ok = 0, fail = 0;
      for (const cid of chatIds) {
        try {
          await banMember(ctx.telegram, cid, target.id);
          markRemoved(cid, target.id);
          ok++;
        } catch (e) { fail++; }
        await new Promise(r => setTimeout(r, 50)); // gentle on the API
      }
      config.addBan(target.id, target.username, `Global ban by ${displayName(ctx.from)}`, ctx.chat.id);
      config.incrementStat('gbans');
      config.logEvent('GBAN', `${displayName(ctx.from)} global-banned ${target.username}: ${ok} chat(s) ok, ${fail} failed`);
      actionReply(ctx, `🌐🔨 Global-banned ${target.username} across ${ok} chat(s).`);
    }));

    bot.command('ungban', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      const chats = config.getKnownChats();
      let ok = 0;
      for (const cid of Object.keys(chats)) {
        try {
          await ctx.telegram.unbanChatMember(cid, target.id);
          ok++;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 50));
      }
      config.removeBan(target.id);
      config.logEvent('GBAN', `${displayName(ctx.from)} global-unbanned ${target.username} in ${ok} chat(s)`);
      actionReply(ctx, `🌐🔓 Global-unbanned ${target.username} in ${ok} chat(s).`);
    }));

    bot.command('kick', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      try {
        await ctx.telegram.banChatMember(ctx.chat.id, target.id);
        await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
        config.logEvent('KICK', `User ${target.username} kicked by ${displayName(ctx.from)}`);
        actionReply(ctx, `👢 Kicked ${target.username} successfully.`);
      } catch (err) {
        actionReply(ctx, `❌ Failed to kick user: ${err.message}`);
      }
    }));

    bot.command('mute', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      const parts = (ctx.message.text || '').split(/\s+/);
      let duration = 60;
      if (parts.length > 2) {
        const min = parseInt(parts[2], 10);
        if (!isNaN(min)) duration = Math.max(1, Math.min(min, 43200)); // clamp 1 min .. 30 days
      }
      try {
        await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
          permissions: zeroPermissions(),
          until_date: Math.floor(Date.now() / 1000) + (duration * 60)
        });
        config.addMute(target.id, target.username, duration, `Muted by Admin ${displayName(ctx.from)}`);
        actionReply(ctx, `🔇 Muted ${target.username} for ${duration} minutes.`);
      } catch (err) {
        actionReply(ctx, `❌ Failed to mute user: ${err.message}`);
      }
    }));

    bot.command('unmute', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      try {
        await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, { permissions: fullPermissions() });
        config.logEvent('UNMUTE', `User ${target.username} unmuted by Admin ${displayName(ctx.from)}`);
        actionReply(ctx, `🔊 Unmuted ${target.username} successfully.`);
      } catch (err) {
        actionReply(ctx, `❌ Failed to unmute user: ${err.message}`);
      }
    }));

    bot.command('warn', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      const parts = (ctx.message.text || '').split(/\s+/);
      const reason = parts.slice(2).join(' ') || 'Violating chat rules';
      const warningsCount = config.addWarning(target.id, target.username, reason);
      actionReply(ctx, `⚠️ ${target.username} has been warned! Warning: ${warningsCount}/3.\nReason: ${reason}`);
      if (warningsCount >= 3) {
        try {
          await banMember(ctx.telegram, ctx.chat.id, target.id);
          config.addBan(target.id, target.username, `Exceeded 3 warnings. Last: ${reason}`, ctx.chat.id);
          config.clearWarnings(target.id);
          markRemoved(ctx.chat.id, target.id);
          // Ban happens silently — dashboard shows it.
        } catch (err) {
          actionReply(ctx, `❌ User reached 3 warnings but auto-ban failed: ${err.message}`);
        }
      }
    }));

    bot.command('clearwarns', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      config.clearWarnings(target.id);
      actionReply(ctx, `✅ Cleared all warnings for ${target.username}.`);
    }));

    bot.command('purge', adminOnly(async (ctx) => {
      const reply = ctx.message.reply_to_message;
      if (!reply) return actionReply(ctx, `❌ Reply to the first message you want to delete.`);
      const start = reply.message_id;
      const end = ctx.message.message_id;
      const range = end - start;
      if (range > 500) {
        return actionReply(ctx, `❌ Range too large (${range} messages). Cap is 500.`);
      }
      let deleted = 0;
      for (let id = start; id <= end; id++) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, id);
          deleted++;
        } catch (e) {}
      }
      actionReply(ctx, `🧹 Purged ${deleted} messages.`);
    }));

    bot.command('status', adminOnly(async (ctx) => {
      const s = config.loadSettings();
      ctx.reply(
`🛡️ *Bot Security Settings*

• Welcome: ${s.welcome.enabled ? '✅' : '❌'}
• Anti-Flood: ${s.antiSpam.enabled ? '✅' : '❌'}
• Anti-Link: ${s.antiLink.enabled ? '✅' : '❌'}
• Anti-Forward: ${s.antiForward.enabled ? '✅' : '❌'}
• Anti-Mention: ${s.antiMention.enabled ? '✅' : '❌'}
• Anti-NSFW Media: ${s.antiMedia.enabled ? '✅' : '❌'}
• Anti-Button/Inline: ${s.antiButton && s.antiButton.enabled ? '✅' : '❌'}
• Anti-Preview/Thumb: ${s.antiPreview && s.antiPreview.enabled ? '✅' : '❌'}
• Anti-Premium-Emoji: ${s.antiPremiumEmoji && s.antiPremiumEmoji.enabled ? '✅' : '❌'}
• Profanity/NSFW Text: ${s.profanity.enabled ? '✅' : '❌'}
• Anti-Raid: ${s.antiRaid.enabled ? '✅' : '❌'}
• Raid Status: ${raidModeActive ? '🔴 ACTIVE' : '🟢 CALM'}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    bot.command('unraid', adminOnly(async (ctx) => {
      raidModeActive = false;
      recentJoins = [];
      config.logEvent('INFO', `Raid mode deactivated by Admin ${displayName(ctx.from)}`);
      actionReply(ctx, `🟢 *Anti-Raid Mode Deactivated.*`, { parse_mode: 'Markdown' });
    }));

    // -------- Main moderation pipeline --------
    bot.on('message', async (ctx, next) => {
      if (!ctx.chat || ctx.chat.type === 'private') return next ? next() : undefined;
      if (!ctx.from) return next ? next() : undefined;
      // Exempt only our OWN bot's messages — other bots (porn spammers, inline
      // bots used to deliver NSFW) must still go through moderation.
      const myId = ctx.botInfo && ctx.botInfo.id;
      if (ctx.from.is_bot && myId && ctx.from.id === myId) return next ? next() : undefined;
      // Skip service messages (new_chat_members handled separately, etc.)
      if (ctx.message.new_chat_members || ctx.message.left_chat_member ||
          ctx.message.new_chat_title || ctx.message.new_chat_photo ||
          ctx.message.delete_chat_photo || ctx.message.group_chat_created ||
          ctx.message.pinned_message) {
        return;
      }
      // Skip slash commands (they are routed above)
      const txt = ctx.message.text || '';
      if (txt.startsWith('/')) return;

      const settings = config.loadSettings();
      const senderIsAdmin = await isAdminCached(ctx, ctx.from.id);
      // A rule can opt admins back in via enforceOnAdmins
      const skip = (rule) => senderIsAdmin && !(rule && rule.enforceOnAdmins);

      try {
        // Always-on (lockChat + pending captcha apply to everyone)
        if (await checkLockChat(ctx, settings)) return;
        if (await checkAlreadyRemoved(ctx)) return; // already banned → just delete leftovers
        if (await checkPendingCaptcha(ctx)) return;
        if (await checkAntiBotPoster(ctx, settings)) return;

        // Content rules — enforceOnAdmins by default
        if (!skip(settings.contentTypes) && await checkContentTypes(ctx, settings)) return;
        if (!skip(settings.antiPremiumEmoji) && await checkAntiPremiumEmoji(ctx, settings)) return;
        if (!skip(settings.antiLink) && await checkAntiLink(ctx, settings)) return;
        if (!skip(settings.antiPreview) && await checkAntiPreview(ctx, settings)) return;
        if (!skip(settings.antiAdultEmoji) && await checkAntiAdultEmoji(ctx, settings)) return;
        if (!skip(settings.profanity) && await checkProfanity(ctx, settings)) return;
        if (!skip(settings.antiMedia) && await checkAntiMedia(ctx, settings)) return;
        if (!skip(settings.antiForward) && await checkAntiForward(ctx, settings)) return;
        if (!skip(settings.antiMention) && await checkAntiMention(ctx, settings)) return;

        // Admins exit here — they can flood, send buttons, etc.
        if (senderIsAdmin) {
          config.incrementStat('messagesProcessed');
          return;
        }

        // Non-admin-only rules
        if (await checkNewUserRestrictions(ctx, settings)) return;
        if (await checkAntiSenderChat(ctx, settings)) return;
        if (await checkAntiFlood(ctx, settings)) return;
        if (await checkAntiZalgo(ctx, settings)) return;
        if (await checkAntiButton(ctx, settings)) return;
      } catch (err) {
        config.logEvent('ERROR', `Moderation pipeline error: ${err.message}`);
      }

      // Track first-message counts (useful for future stricter-on-newbies logic)
      const fkey = `${ctx.chat.id}:${ctx.from.id}`;
      firstMessageCounts[fkey] = (firstMessageCounts[fkey] || 0) + 1;

      config.incrementStat('messagesProcessed');
    });

    // Edited messages: re-run moderation since users edit to bypass filters
    bot.on('edited_message', async (ctx) => {
      // Wrap edited_message as message for the same pipeline
      ctx.message = ctx.editedMessage || ctx.update.edited_message;
      if (!ctx.message) return;
      if (!ctx.chat || ctx.chat.type === 'private') return;
      if (!ctx.from || ctx.from.is_bot) return;
      const txt = ctx.message.text || '';
      if (txt.startsWith('/')) return;

      const settings = config.loadSettings();
      const senderIsAdmin = await isAdminCached(ctx, ctx.from.id);
      const skip = (rule) => senderIsAdmin && !(rule && rule.enforceOnAdmins);
      try {
        if (!skip(settings.contentTypes) && await checkContentTypes(ctx, settings)) return;
        if (!skip(settings.antiPremiumEmoji) && await checkAntiPremiumEmoji(ctx, settings)) return;
        if (!skip(settings.antiLink) && await checkAntiLink(ctx, settings)) return;
        if (!skip(settings.antiPreview) && await checkAntiPreview(ctx, settings)) return;
        if (!skip(settings.antiAdultEmoji) && await checkAntiAdultEmoji(ctx, settings)) return;
        if (!skip(settings.profanity) && await checkProfanity(ctx, settings)) return;
        if (!skip(settings.antiMedia) && await checkAntiMedia(ctx, settings)) return;
        if (!skip(settings.antiForward) && await checkAntiForward(ctx, settings)) return;
        if (!skip(settings.antiMention) && await checkAntiMention(ctx, settings)) return;
        if (senderIsAdmin) return;
        if (await checkNewUserRestrictions(ctx, settings)) return;
        if (await checkAntiSenderChat(ctx, settings)) return;
        if (await checkAntiZalgo(ctx, settings)) return;
        if (await checkAntiButton(ctx, settings)) return;
      } catch (err) {
        config.logEvent('ERROR', `Edit moderation error: ${err.message}`);
      }
    });

    // Channel-post forwarding into the group (when chat is a discussion group of a channel)
    bot.on('channel_post', async (ctx) => {
      // Treat channel posts same as a forward source within the chat
      // (Only meaningful if bot is in a normal group; channels themselves can't be moderated by non-admin bot)
    });

    // -------- Captcha button handler --------
    bot.action(/^cap:(-?\d+):(\d+):(\d+)$/, async (ctx) => {
      try {
        const [, groupChatIdStr, targetIdStr, chosenStr] = ctx.match;
        const groupChatId = parseInt(groupChatIdStr, 10);
        const targetId = parseInt(targetIdStr, 10);
        const chosen = parseInt(chosenStr, 10);
        const key = `${groupChatId}:${targetId}`;
        const pending = pendingCaptchas[key];

        // Only the target user may answer their own captcha
        if (ctx.from.id !== targetId) {
          return ctx.answerCbQuery('This captcha is not for you.', { show_alert: false });
        }
        if (!pending) {
          return ctx.answerCbQuery('Captcha already resolved.');
        }

        const captchaChatId = pending.captchaChatId || ctx.chat.id;

        if (chosen === pending.answer) {
          clearTimeout(pending.timer);
          delete pendingCaptchas[key];
          try {
            await ctx.telegram.restrictChatMember(groupChatId, targetId, { permissions: fullPermissions() });
          } catch (e) {}
          if (pending.messageId) {
            ctx.telegram.deleteMessage(captchaChatId, pending.messageId).catch(() => {});
          }
          config.logEvent('CAPTCHA', `Solved by ${displayName(ctx.from)}`);
          await ctx.answerCbQuery('✅ Correct! You may chat now.');

          // Optional welcome message — only posts in the group, and only if not silenced.
          const s = config.loadSettings();
          if (s.welcome && s.welcome.enabled && !silentForWelcome(s)) {
            const name = ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.first_name}`;
            const msg = (s.welcome.text || '')
              .replace('{username}', name)
              .replace('{firstname}', ctx.from.first_name)
              .replace('{groupname}', '');
            try {
              const sent = await ctx.telegram.sendMessage(groupChatId, msg);
              if (sent && s.welcome.deleteAfterSeconds > 0) {
                setTimeout(() => ctx.telegram.deleteMessage(groupChatId, sent.message_id).catch(() => {}),
                  s.welcome.deleteAfterSeconds * 1000);
              }
            } catch (e) {}
          }
          return;
        }

        pending.attempts++;
        const s = config.loadSettings();
        const maxAttempts = (s.captcha && s.captcha.maxAttempts) || 2;
        if (pending.attempts >= maxAttempts) {
          clearTimeout(pending.timer);
          delete pendingCaptchas[key];
          config.incrementStat('captchasFailed');
          config.logEvent('CAPTCHA', `Failed by ${displayName(ctx.from)} after ${pending.attempts} attempts`);
          if (s.captcha.kickOnFail) {
            try {
              await ctx.telegram.banChatMember(groupChatId, targetId);
              await ctx.telegram.unbanChatMember(groupChatId, targetId);
              config.logEvent('KICK', `Kicked ${displayName(ctx.from)} for captcha fail`);
            } catch (e) {}
          }
          if (pending.messageId) {
            ctx.telegram.deleteMessage(captchaChatId, pending.messageId).catch(() => {});
          }
          return ctx.answerCbQuery('❌ Wrong answer.');
        }
        return ctx.answerCbQuery(`❌ Wrong. ${maxAttempts - pending.attempts} attempt(s) left.`);
      } catch (e) {
        config.logEvent('ERROR', `Captcha handler error: ${e.message}`);
      }
    });

    // -------- Admin-only utility commands --------
    bot.command('id', adminOnly(async (ctx) => {
      const t = ctx.message.reply_to_message ? ctx.message.reply_to_message.from : ctx.from;
      ctx.reply(`👤 User: ${t.username ? '@' + t.username : t.first_name}\n🆔 ID: \`${t.id}\`\n💬 Chat ID: \`${ctx.chat.id}\``,
        { parse_mode: 'Markdown' }).catch(() => {});
    }));

    bot.command('ping', adminOnly(async (ctx) => {
      const t = Date.now();
      const msg = await ctx.reply('🏓 Pong!').catch(() => null);
      if (msg) {
        const ms = Date.now() - t;
        ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
          `🏓 Pong! Round-trip ${ms}ms`).catch(() => {});
      }
    }));

    bot.command('rules', adminOnly(async (ctx) => {
      ctx.reply(
`📜 *Group Rules — OctoGod is on watch*

• No spam, flooding, or duplicate messages
• No links, channel/group mentions, or t.me/ invites
• No forwards from channels / unknown sources
• No NSFW content (text, captions, file names, stickers)
• No inline-button promos or CTA-style messages
• No link-preview / thumbnail bait
• No posting as a channel
• Respect other members

Repeated violations → warnings → ban after 3.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    bot.command('report', adminOnly(async (ctx) => {
      const target = ctx.message.reply_to_message;
      if (!target) {
        return actionReply(ctx, '❌ Reply to a message to report it.');
      }
      try {
        const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
        const handles = admins
          .filter(a => !a.user.is_bot && a.user.username)
          .map(a => `@${a.user.username}`)
          .join(' ');
        const reporter = displayName(ctx.from);
        const reported = displayName(target.from);
        config.logEvent('REPORT', `${reporter} reported ${reported}`);
        ctx.reply(`🚨 *Report from ${reporter}* against ${reported}\n${handles || '(no admins with public usernames)'}`,
          { reply_to_message_id: target.message_id, parse_mode: 'Markdown' }).catch(() => {});
      } catch (e) {
        actionReply(ctx, `❌ Failed to fetch admins: ${e.message}`);
      }
    }));

    // -------- Extra admin commands --------
    bot.command('userinfo', adminOnly(async (ctx) => {
      const target = await getCommandTarget(ctx);
      if (!target) return;
      const data = config.loadData();
      const w = data.warnings[target.id];
      const bans = data.bans.filter(b => b.userId === target.id).length;
      const mutes = data.mutes.filter(m => m.userId === target.id).length;
      ctx.reply(
`👤 ${target.username}
🆔 ID: \`${target.id}\`
⚠️ Warnings: ${w ? w.count : 0}/3
🔨 Bans (historical): ${bans}
🔇 Mutes (historical): ${mutes}
${w && w.reasons.length ? '\nLast reason: ' + w.reasons[w.reasons.length - 1].reason : ''}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    // -------- Premium custom emoji / sticker blocklist management --------
    bot.command('blockemoji', adminOnly(async (ctx) => {
      const reply = ctx.message.reply_to_message;
      const argParts = (ctx.message.text || '').split(/\s+/).slice(1);
      const argIds = argParts.filter(p => /^\d{1,30}$/.test(p));
      const ids = new Set(argIds);

      if (reply) {
        const ents = reply.entities || reply.caption_entities || [];
        for (const e of ents) if (e.type === 'custom_emoji' && e.custom_emoji_id) ids.add(String(e.custom_emoji_id));
        if (reply.sticker && reply.sticker.custom_emoji_id) ids.add(String(reply.sticker.custom_emoji_id));
      }
      if (ids.size === 0) {
        return actionReply(ctx, '❌ Reply to a message containing the custom emoji/sticker, or pass IDs: `/blockemoji 5123456789 5234567890`',
          { parse_mode: 'Markdown' });
      }
      const s = config.loadSettings();
      const list = new Set([...(s.antiPremiumEmoji.customEmojiBlocklist || []), ...ids]);
      s.antiPremiumEmoji.customEmojiBlocklist = [...list].slice(0, 5000);
      config.saveSettings(s);
      config.logEvent('PREMIUM', `${displayName(ctx.from)} blocked ${ids.size} custom emoji id(s)`);
      actionReply(ctx, `✅ Blocked ${ids.size} custom emoji id(s). Total blocklist: ${s.antiPremiumEmoji.customEmojiBlocklist.length}`);
    }));

    bot.command('unblockemoji', adminOnly(async (ctx) => {
      const parts = (ctx.message.text || '').split(/\s+/).slice(1);
      const ids = parts.filter(p => /^\d{1,30}$/.test(p));
      if (!ids.length) return actionReply(ctx, '❌ Usage: `/unblockemoji 5123456789 ...`', { parse_mode: 'Markdown' });
      const s = config.loadSettings();
      const before = (s.antiPremiumEmoji.customEmojiBlocklist || []).length;
      s.antiPremiumEmoji.customEmojiBlocklist = (s.antiPremiumEmoji.customEmojiBlocklist || []).filter(x => !ids.includes(x));
      config.saveSettings(s);
      actionReply(ctx, `✅ Removed ${before - s.antiPremiumEmoji.customEmojiBlocklist.length} id(s).`);
    }));

    bot.command('blockstickerset', adminOnly(async (ctx) => {
      const reply = ctx.message.reply_to_message;
      const argParts = (ctx.message.text || '').split(/\s+/).slice(1);
      const names = new Set(argParts.filter(p => /^[A-Za-z0-9_]{1,64}$/.test(p)));

      if (reply && reply.sticker && reply.sticker.set_name) {
        names.add(reply.sticker.set_name);
      }
      if (names.size === 0) {
        return actionReply(ctx, '❌ Reply to a sticker, or pass pack names: `/blockstickerset DesiNudesPack ...`',
          { parse_mode: 'Markdown' });
      }
      const s = config.loadSettings();
      const list = new Set([...(s.antiPremiumEmoji.stickerSetBlocklist || []), ...names]);
      s.antiPremiumEmoji.stickerSetBlocklist = [...list].slice(0, 2000);
      config.saveSettings(s);
      config.logEvent('PREMIUM', `${displayName(ctx.from)} blocked sticker pack(s): ${[...names].join(', ')}`);
      actionReply(ctx, `✅ Blocked ${names.size} sticker pack(s). Total: ${s.antiPremiumEmoji.stickerSetBlocklist.length}`);
    }));

    bot.command('unblockstickerset', adminOnly(async (ctx) => {
      const parts = (ctx.message.text || '').split(/\s+/).slice(1);
      const names = parts.filter(p => /^[A-Za-z0-9_]{1,64}$/.test(p));
      if (!names.length) return actionReply(ctx, '❌ Usage: `/unblockstickerset PackName ...`', { parse_mode: 'Markdown' });
      const s = config.loadSettings();
      const before = (s.antiPremiumEmoji.stickerSetBlocklist || []).length;
      s.antiPremiumEmoji.stickerSetBlocklist = (s.antiPremiumEmoji.stickerSetBlocklist || []).filter(x => !names.includes(x));
      config.saveSettings(s);
      actionReply(ctx, `✅ Removed ${before - s.antiPremiumEmoji.stickerSetBlocklist.length} pack(s).`);
    }));

    bot.command('blocklist', adminOnly(async (ctx) => {
      const s = config.loadSettings();
      const emojiList = (s.antiPremiumEmoji.customEmojiBlocklist || []);
      const stickerList = (s.antiPremiumEmoji.stickerSetBlocklist || []);
      const emojiPreview = emojiList.slice(0, 20).join(', ') || '(none)';
      const stickerPreview = stickerList.slice(0, 20).join(', ') || '(none)';
      ctx.reply(
`📛 *Blocklists*

Custom-emoji ids (${emojiList.length}):
\`${emojiPreview}${emojiList.length > 20 ? ' …' : ''}\`

Sticker packs (${stickerList.length}):
\`${stickerPreview}${stickerList.length > 20 ? ' …' : ''}\`

Block all custom emoji: ${s.antiPremiumEmoji.blockAllCustomEmoji ? '✅' : '❌'}
Block video stickers: ${s.antiPremiumEmoji.blockVideoStickers ? '✅' : '❌'}
Block animated stickers: ${s.antiPremiumEmoji.blockAnimatedStickers ? '✅' : '❌'}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    bot.command('lock', adminOnly(async (ctx) => {
      const s = config.loadSettings();
      s.lockChat = { locked: true };
      config.saveSettings(s);
      config.logEvent('LOCK', `Chat locked by ${displayName(ctx.from)}`);
      actionReply(ctx, '🔒 *Chat locked.* Only admins can post until unlocked with /unlock_chat.',
        { parse_mode: 'Markdown' });
    }));

    bot.command('unlock_chat', adminOnly(async (ctx) => {
      const s = config.loadSettings();
      s.lockChat = { locked: false };
      config.saveSettings(s);
      config.logEvent('UNLOCK', `Chat unlocked by ${displayName(ctx.from)}`);
      actionReply(ctx, '🔓 *Chat unlocked.* Everyone may post again.',
        { parse_mode: 'Markdown' });
    }));

    bot.command('stats', adminOnly(async (ctx) => {
      const d = config.loadData();
      const s = d.stats;
      ctx.reply(
`📊 *OctoGod Stats*

Messages processed: ${s.messagesProcessed}
Floods blocked: ${s.spamBlocked}
Links blocked: ${s.linksDeleted}
Forwards blocked: ${s.forwardsBlocked}
Mentions blocked: ${s.mentionsBlocked}
NSFW media blocked: ${s.nsfwMediaBlocked}
Adult emoji blocked: ${s.adultEmojiBlocked || 0}
Premium emoji / stickers blocked: ${s.premiumEmojiBlocked || 0}
New-user blocks: ${s.newUserBlocked || 0}
Content-type blocks: ${s.contentBlocked || 0}
Global bans: ${s.gbans || 0}
Buttons blocked: ${s.buttonsBlocked}
Previews blocked: ${s.previewsBlocked}
Profanity removed: ${s.profanityDeleted}
Zalgo/RTL blocked: ${s.zalgoBlocked || 0}
Sender-chat blocked: ${s.senderChatBlocked || 0}
NSFW names blocked: ${s.namesBlocked || 0}
CAS hits: ${s.casHits || 0}
Captchas issued / failed: ${s.captchasIssued || 0} / ${s.captchasFailed || 0}
Warnings issued: ${s.warningsIssued}
Users banned: ${s.usersBanned}
Users muted: ${s.usersMuted}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    bot.command('help', adminOnly(async (ctx) => {
      ctx.reply(
`🛡️ *OctoGod commands* (admin-only)

/ban /unban /gban /ungban /kick /mute [min] /unmute /warn /clearwarns
/userinfo /purge (reply) /stats /status
/id /ping /rules /report (reply)
/lock /unlock_chat /unraid
/blockemoji (reply) /unblockemoji <id>
/blockstickerset (reply) /unblockstickerset <pack> /blocklist`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }));

    // Global error handler so a single failed update doesn't crash the bot
    bot.catch((err, ctx) => {
      config.logEvent('ERROR', `Telegraf error on ${ctx.updateType}: ${err.message}`);
    });

    // Telegraf v4 `bot.launch()` resolves only when polling STOPS. So we
    // pre-fetch botInfo via getMe(), register the instance synchronously, and
    // fire-and-forget the launch call.
    const _justLaunched = bot;
    (async () => {
      try {
        const info = await _justLaunched.telegram.getMe();
        _justLaunched.botInfo = info;
        bots.set(info.id, {
          instance: _justLaunched,
          info,
          name: (opts && opts.name) || null,
          addedAt: Date.now()
        });
        config.logEvent('INFO', `Bot @${info.username} (id ${info.id}) registered. ${bots.size} bot(s) total.`);
        manuallyStopped.delete(info.id); // explicit (re)start clears the do-not-relaunch flag
        refreshLegacyBotRef();
        startWatchdog();
        startAutoScanLoop();
      } catch (err) {
        config.logEvent('ERROR', `Failed to fetch botInfo: ${err.message}`);
        return;
      }

      // Start polling. `dropPendingUpdates` discards the backlog that piled up
      // while the bot was offline — otherwise every restart replays hundreds of
      // old messages (and re-runs the boot scan over stale cache).
      _justLaunched.launch({ dropPendingUpdates: true }).catch(err => {
        const idNum = _justLaunched.botInfo && _justLaunched.botInfo.id;
        if (idNum) bots.delete(idNum);
        refreshLegacyBotRef();

        if (/409|conflict/i.test(err.message || '')) {
          // Another copy of this exact bot is polling Telegram somewhere else.
          // Relaunching would just hit the same wall, so back off hard and tell
          // the operator plainly what to do.
          if (idNum) relaunchState[String(idNum)] = { attempts: 5, nextTryAt: Date.now() + 5 * 60 * 1000 };
          config.logEvent('WATCHDOG',
            `⚠️ Another copy of this bot is already running elsewhere (Telegram allows only ONE). ` +
            `Stop the duplicate process/deployment. Retrying in 5 min.`);
        } else {
          config.logEvent('ERROR', `Polling stopped for @${_justLaunched.botInfo && _justLaunched.botInfo.username}: ${err.message}`);
        }
      });
      config.logEvent('INFO', `✅ @${_justLaunched.botInfo.username} is online and watching the group.`);

      // Boot scan — only ONCE per process lifetime, not on every watchdog relaunch.
      if (!bootScanDone) {
        bootScanDone = true;
        const s = config.loadSettings();
        if (s.routineScan && s.routineScan.enabled && s.routineScan.scanOnBoot) {
          const hours = s.routineScan.defaultDurationHours || 24;
          setTimeout(() => {
            config.logEvent('INFO', `🧹 Startup cleanup scan running (last ${hours}h of cached messages)…`);
            runRoutineScan({ hours, trigger: 'boot' }).catch(err => {
              config.logEvent('ERROR', `Startup scan failed: ${err.message}`);
            });
          }, 5000);
        }
      }
    })();

  } catch (err) {
    config.logEvent('ERROR', `Error setting up Telegraf instance: ${err.message}`);
    refreshLegacyBotRef();
  }
  return bot;
}

// -------- Watchdog: auto-relaunch dead bots --------
// A 409 conflict, network outage, or unhandled polling stop used to leave a bot
// silently dead until someone noticed. The watchdog compares stored records
// against live instances every 60s and relaunches missing ones with backoff.
// Bots the admin stopped on purpose are excluded via `manuallyStopped`.
const manuallyStopped = new Set();
const relaunchState = {}; // { idPrefix: { attempts, nextTryAt } }
let watchdogTimer = null;

function startWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(async () => {
    try {
      const stored = config.listBotRecords();
      for (const rec of stored) {
        const idPrefix = rec.token.split(':')[0];
        const idNum = parseInt(idPrefix, 10);
        if (manuallyStopped.has(idNum)) continue;

        const live = bots.get(idNum);
        if (live) {
          // Health check with timeout; 3 consecutive failures → stop so the
          // next tick relaunches it cleanly.
          try {
            await Promise.race([
              live.instance.telegram.getMe(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('healthcheck timeout')), 8000))
            ]);
            live.failCount = 0;
            relaunchState[idPrefix] = { attempts: 0, nextTryAt: 0 };
          } catch (e) {
            live.failCount = (live.failCount || 0) + 1;
            config.logEvent('WATCHDOG', `Bot ${idPrefix} health check failed (${live.failCount}/3): ${e.message}`);
            if (live.failCount >= 3) {
              try { live.instance.stop(); } catch (e2) {}
              bots.delete(idNum);
              refreshLegacyBotRef();
            }
          }
          continue;
        }

        // Bot is configured but not running → relaunch with quadratic backoff
        const st = relaunchState[idPrefix] = relaunchState[idPrefix] || { attempts: 0, nextTryAt: 0 };
        if (Date.now() < st.nextTryAt) continue;
        st.attempts++;
        st.nextTryAt = Date.now() + Math.min(st.attempts * st.attempts * 60000, 30 * 60000);
        config.logEvent('WATCHDOG', `Relaunching bot ${idPrefix} (attempt ${st.attempts})`);
        initBot(rec.token, { name: rec.name });
      }
    } catch (e) {
      config.logEvent('ERROR', `Watchdog tick failed: ${e.message}`);
    }
  }, 60 * 1000);
  if (watchdogTimer.unref) watchdogTimer.unref();
}

// -------- Scheduled auto-scan: run the routine scan every N hours --------
let autoScanTimer = null;
let lastAutoScanAt = Date.now(); // seeded so we don't double-fire right after the boot scan
function startAutoScanLoop() {
  if (autoScanTimer) return;
  autoScanTimer = setInterval(() => {
    try {
      const s = config.loadSettings();
      const hrs = s.routineScan && s.routineScan.autoIntervalHours;
      if (!s.routineScan || !s.routineScan.enabled || !hrs || hrs <= 0) return;
      if (bots.size === 0) return;
      if (Date.now() - lastAutoScanAt < hrs * 3600 * 1000) return;
      lastAutoScanAt = Date.now();
      config.logEvent('INFO', `Scheduled auto-scan starting (every ${hrs}h)`);
      runRoutineScan({ hours: s.routineScan.defaultDurationHours, trigger: 'scheduled' })
        .catch(err => config.logEvent('ERROR', `Scheduled scan failed: ${err.message}`));
    } catch (e) {}
  }, 10 * 60 * 1000);
  if (autoScanTimer.unref) autoScanTimer.unref();
}

// Stop a single bot by its Telegram id, OR (no arg) stop them all.
function stopBot(botId) {
  if (botId !== undefined && botId !== null) {
    const id = Number(botId);
    const rec = bots.get(id);
    if (!rec) return false;
    try { rec.instance.stop(); } catch (e) {}
    bots.delete(id);
    manuallyStopped.add(id);
    config.logEvent('INFO', `Bot id ${id} stopped. ${bots.size} bot(s) remain.`);
    refreshLegacyBotRef();
    return true;
  }
  for (const [id, rec] of bots) {
    try { rec.instance.stop(); } catch (e) {}
    manuallyStopped.add(id);
  }
  bots.clear();
  config.logEvent('INFO', 'All bots stopped.');
  refreshLegacyBotRef();
  return true;
}

function getBotStatus() {
  return bots.size > 0;
}

function listBots() {
  return listBotsRuntime();
}

// -------- Routine scan ----------
// Evaluate a cached message against the current rules. Returns
// `{ rule, reason, level }` if the message should be deleted, otherwise null.
function evaluateCacheEntry(entry, settings) {
  if (!entry) return null;

  // Premium custom emoji / sticker pack
  if (settings.antiPremiumEmoji && settings.antiPremiumEmoji.enabled) {
    const customBlocklist = new Set((settings.antiPremiumEmoji.customEmojiBlocklist || []).map(String));
    const setBlocklist = new Set((settings.antiPremiumEmoji.stickerSetBlocklist || []).map(x => String(x).toLowerCase()));
    if (entry.customEmojiIds && entry.customEmojiIds.length) {
      const hit = entry.customEmojiIds.find(id => customBlocklist.has(id));
      if (hit) return { rule: 'premium', reason: `custom emoji ${hit}`, level: 'PREMIUM' };
      if (settings.antiPremiumEmoji.blockAllCustomEmoji) {
        return { rule: 'premium', reason: `${entry.customEmojiIds.length} premium custom emoji`, level: 'PREMIUM' };
      }
    }
    if (entry.hasSticker) {
      if (entry.stickerCustomEmojiId && customBlocklist.has(String(entry.stickerCustomEmojiId))) {
        return { rule: 'premium', reason: 'blocked emoji sticker', level: 'PREMIUM' };
      }
      if (entry.stickerSetName && setBlocklist.has(entry.stickerSetName.toLowerCase())) {
        return { rule: 'premium', reason: `blocked pack "${entry.stickerSetName}"`, level: 'PREMIUM' };
      }
      if (entry.stickerIsVideo && settings.antiPremiumEmoji.blockVideoStickers) {
        return { rule: 'premium', reason: 'video sticker', level: 'PREMIUM' };
      }
      if (entry.stickerIsAnimated && settings.antiPremiumEmoji.blockAnimatedStickers) {
        return { rule: 'premium', reason: 'animated sticker', level: 'PREMIUM' };
      }
    }
  }

  // Anti-Forward
  if (settings.antiForward && settings.antiForward.enabled && entry.forwardFrom) {
    const f = entry.forwardFrom;
    if (f.kind === 'channel' && settings.antiForward.blockChannels) return { rule: 'forward', reason: `channel "${f.title}"`, level: 'FORWARD' };
    if ((f.kind === 'user' || f.kind === 'chat') && settings.antiForward.blockUsers) return { rule: 'forward', reason: `from ${f.title}`, level: 'FORWARD' };
    if (f.kind === 'hidden' && settings.antiForward.blockHidden) return { rule: 'forward', reason: 'hidden source', level: 'FORWARD' };
  }

  // Anti-Mention (t.me / channel link in cached text)
  if (settings.antiMention && settings.antiMention.enabled && settings.antiMention.blockChannelMentions) {
    const tme = /(?:t\.me|telegram\.me|telegram\.dog)\//i;
    if (tme.test(entry.text)) return { rule: 'mention', reason: 'telegram link', level: 'MENTION' };
  }

  // Anti-Link (uses bot-side detectAnyLink)
  if (settings.antiLink && settings.antiLink.enabled) {
    const detected = detectAnyLink(entry.text, settings.antiLink.strictMode);
    if (detected) return { rule: 'link', reason: `link (${detected})`, level: 'LINK' };
  }

  // Profanity / NSFW text + sticker emoji + file name
  if (settings.profanity && settings.profanity.enabled) {
    const blacklist = settings.profanity.blacklist || [];
    const hit = findBlacklistHit(entry.text, blacklist);
    if (hit) return { rule: 'profanity', reason: `keyword "${hit}"`, level: 'PROFANITY' };
    if (entry.stickerEmoji) {
      const h = findBlacklistHit(entry.stickerEmoji, blacklist);
      if (h) return { rule: 'profanity', reason: `sticker emoji "${h}"`, level: 'PROFANITY' };
    }
    if (entry.documentName) {
      const h = findBlacklistHit(entry.documentName, blacklist);
      if (h) return { rule: 'profanity', reason: `file name "${h}"`, level: 'PROFANITY' };
    }
  }

  // Anti-Button
  if (settings.antiButton && settings.antiButton.enabled) {
    if (entry.hasButtons && settings.antiButton.blockInlineKeyboards) {
      return { rule: 'button', reason: 'inline keyboard', level: 'BUTTON' };
    }
    if (entry.viaBotId && settings.antiButton.blockViaBot) {
      return { rule: 'button', reason: `via @${entry.viaBotUsername || entry.viaBotId}`, level: 'BUTTON' };
    }
    if (settings.antiButton.blockButtonText && looksLikeButtonText(entry.text)) {
      return { rule: 'button', reason: 'button-style text', level: 'BUTTON' };
    }
  }

  // Anti-Sender-Chat (posted as a channel)
  if (settings.antiSenderChat && settings.antiSenderChat.enabled && entry.senderChatId) {
    return { rule: 'sender-chat', reason: 'posted as channel', level: 'SENDERCHAT' };
  }

  // Content types — paid media, spoiler media, NSFW polls
  if (settings.contentTypes && settings.contentTypes.enabled) {
    const ct = settings.contentTypes;
    if (entry.hasPaidMedia && ct.blockPaidMedia) {
      return { rule: 'content', reason: 'paid media', level: 'CONTENT' };
    }
    if (entry.hasSpoiler && ct.blockSpoilerMedia) {
      return { rule: 'content', reason: 'spoiler media', level: 'CONTENT' };
    }
    if (entry.pollText) {
      if (ct.blockPolls) return { rule: 'content', reason: 'poll', level: 'CONTENT' };
      if (ct.scanPolls) {
        const hit = findBlacklistHit(entry.pollText, (settings.profanity && settings.profanity.blacklist) || []);
        if (hit) return { rule: 'content', reason: `nsfw poll ("${hit}")`, level: 'CONTENT' };
      }
    }
  }

  return null;
}

// Progress reporter — server.js registers this so the dashboard can stream
// live scan progress over socket.io. Default no-op when not wired.
let onScanProgress = null;
function registerScanProgress(cb) { onScanProgress = typeof cb === 'function' ? cb : null; }
function emitProgress(payload) { if (onScanProgress) { try { onScanProgress(payload); } catch (e) {} } }

async function runRoutineScan(opts = {}) {
  const tg = anyBot();
  if (!tg) return { ok: false, error: 'bot_not_running' };
  const settings = config.loadSettings();
  const max = (settings.routineScan && settings.routineScan.maxDurationHours) || 720;
  const requested = parseInt(opts.hours, 10);
  const defaultHours = (settings.routineScan && settings.routineScan.defaultDurationHours) || 24;
  const hours = Math.max(1, Math.min(isNaN(requested) ? defaultHours : requested, max));
  const cutoff = Date.now() - hours * 3600 * 1000;
  const delayMs = (settings.routineScan && settings.routineScan.scanIntervalDelayMs) || 35;

  const candidates = config.getMessagesSince(cutoff);
  config.logEvent('INFO', `🧹 Cleanup scan started — checking ${candidates.length} recent message(s) from the last ${hours}h.`);
  emitProgress({ phase: 'start', total: candidates.length, scanned: 0, deleted: 0, errors: 0, hours });

  const summary = {
    scanned: 0,
    total: candidates.length,
    deleted: 0,
    errors: 0,
    alreadyGone: 0,
    byRule: {},
    byChat: {},
    sampleDeletes: [],
    durationHours: hours,
    trigger: opts.trigger || 'manual',
    startedAt: new Date().toISOString()
  };

  for (let i = 0; i < candidates.length; i++) {
    const entry = candidates[i];
    summary.scanned++;
    const verdict = evaluateCacheEntry(entry, settings);
    if (verdict) {
      try {
        await tg.telegram.deleteMessage(entry.chatId, entry.messageId);
        summary.deleted++;
        summary.byRule[verdict.rule] = (summary.byRule[verdict.rule] || 0) + 1;
        summary.byChat[entry.chatTitle || entry.chatId] = (summary.byChat[entry.chatTitle || entry.chatId] || 0) + 1;
        if (summary.sampleDeletes.length < 5) {
          summary.sampleDeletes.push({
            user: entry.username || entry.userId,
            rule: verdict.rule,
            reason: verdict.reason,
            text: (entry.text || '').slice(0, 80)
          });
        }
        config.incrementStat('routineScanDeleted');
        config.logEvent(verdict.level, `🧹 Cleanup scan removed ${HUMAN_CATEGORY[verdict.level] || 'a flagged message'} from @${entry.username || entry.userId} in “${entry.chatTitle || 'a group'}”.`);
        config.removeMessageFromCache(entry.chatId, entry.messageId);
      } catch (e) {
        const msg = (e && e.message) || '';
        if (/message to delete not found|message can't be deleted|MESSAGE_ID_INVALID/i.test(msg)) {
          summary.alreadyGone++;
          config.removeMessageFromCache(entry.chatId, entry.messageId);
        } else {
          summary.errors++;
          if (summary.errors <= 3) {
            config.logEvent('ERROR', `[scan] delete failed for ${entry.messageId}: ${msg}`);
          }
        }
      }
    }
    // Live progress every 25 scanned, or every 5 deletes, or the final one
    if (summary.scanned % 25 === 0 || (verdict && summary.deleted % 5 === 0) || i === candidates.length - 1) {
      emitProgress({
        phase: 'progress',
        total: candidates.length,
        scanned: summary.scanned,
        deleted: summary.deleted,
        errors: summary.errors,
        alreadyGone: summary.alreadyGone,
        hours
      });
    }
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  summary.completedAt = new Date().toISOString();
  config.incrementStat('routineScanRuns');
  const d = config.loadData();
  d.stats.routineScanMessages = (d.stats.routineScanMessages || 0) + summary.scanned;
  config.saveData(d);

  config.recordScanResult(summary);
  config.logEvent('INFO',
    `✅ Cleanup scan finished — ${summary.deleted} message(s) removed out of ${summary.scanned} checked` +
    (summary.errors ? ` (${summary.errors} could not be deleted)` : '') + '.');
  emitProgress({ phase: 'done', ...summary });
  return { ok: true, summary };
}

// Used by the dashboard's Unban button. Resolves the chat from the stored ban
// record (if present), calls telegram.unbanChatMember, then clears the DB row.
async function unbanUser(userId, chatIdOverride) {
  const uid = Number(userId);
  if (!uid || isNaN(uid)) return { ok: false, error: 'invalid_user_id' };

  const data = config.loadData();
  const record = data.bans.find(b => Number(b.userId) === uid && b.active !== false);

  const chatId = chatIdOverride || (record && record.chatId);
  const tg = anyBot();
  if (chatId && tg) {
    try {
      await tg.telegram.unbanChatMember(chatId, uid);
      config.removeBan(uid);
      delete recentlyRemoved[`${chatId}:${uid}`]; // let them post again
      return { ok: true, message: `Unbanned user ${uid} in chat ${chatId}.` };
    } catch (err) {
      // If user was never banned Telegram-side, telegram returns "user not banned" — treat as success and clean DB.
      const msg = (err && err.message) || '';
      if (/USER_NOT_PARTICIPANT|user is not (a member|banned)|USER_NOT_BANNED|PARTICIPANT_ID_INVALID/i.test(msg)) {
        config.removeBan(uid);
        return { ok: true, message: `Cleared ban record (telegram already showed user as not banned).` };
      }
      return { ok: false, error: msg || 'telegram_error' };
    }
  }
  // No chatId — just drop the DB record. Admin must lift the actual ban in-group via /unban.
  const removed = config.removeBan(uid);
  if (!removed) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    message: 'Removed record. The original ban was made before chat tracking — run /unban in the affected group to lift it on Telegram.'
  };
}

module.exports = {
  initBot,
  stopBot,
  getBotStatus,
  listBots,
  unbanUser,
  runRoutineScan,
  registerScanProgress
};
