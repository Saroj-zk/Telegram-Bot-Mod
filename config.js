const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_DIR = path.join(__dirname, 'db');
const SETTINGS_PATH = path.join(DB_DIR, 'settings.json');
const DATA_PATH = path.join(DB_DIR, 'db.json');
const ADMIN_PATH = path.join(DB_DIR, 'admin.json');
const LOGS_PATH = path.join(DB_DIR, 'logs.json');
const SESSIONS_PATH = path.join(DB_DIR, 'sessions.json');
const MESSAGE_CACHE_PATH = path.join(DB_DIR, 'messages.json');
const SCAN_HISTORY_PATH = path.join(DB_DIR, 'scans.json');
const HEARTBEAT_PATH = path.join(DB_DIR, 'heartbeat.json');
const BOTS_PATH = path.join(DB_DIR, 'bots.json');
const CHATS_PATH = path.join(DB_DIR, 'chats.json');

// Ensure db directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const NSFW_KEYWORDS = [
  // Global porn sites / brands
  "porn", "porno", "pornhub", "xxx", "xvideos", "xnxx", "redtube", "youporn",
  "brazzers", "onlyfans", "fansly", "camgirl", "camsoda", "chaturbate", "stripchat",
  "spankbang", "tube8", "eporner", "motherless", "bangbros", "naughtyamerica",
  "realitykings", "mofos", "digitalplayground",
  // General NSFW
  "nude", "nudes", "naked", "sex", "sexy", "sexvideo", "sextape", "hentai",
  "rule34", "milf", "dildo", "vagina", "pussy", "cock", "dick", "boobs", "boobies",
  "tits", "titties", "nipple", "anal", "blowjob", "handjob", "rimjob", "cumshot",
  "creampie", "gangbang", "threesome", "orgy", "incest", "bdsm", "fetish", "kink",
  "escort", "hooker", "prostitute", "callgirl", "horny", "masturbate", "jerkoff",
  "fucking", "fucked", "fuckme", "fuck me", "suck my", "rape", "rapist",
  "ass", "asshole", "bukkake", "footjob", "deepthroat", "milking",
  // Underage / illegal
  "loli", "lolita", "shota", "cp", "childporn", "child porn", "teenporn", "teen porn",
  "underage", "minor porn",
  // Generic flags
  "18+", "nsfw", "adult content", "porn channel", "porn group", "leaked", "leaks",
  "🍑 nudes", "🔞", "💦",
  // Indian / desi porn sites & terms
  "desigirls", "desigirl", "desipapa", "desitales", "desipaki", "desi porn", "desisex",
  "desi sex", "desi mms", "indian porn", "indianporn", "indian sex", "indiansex",
  "bhabhi sex", "bhabhi porn", "bhabhi mms", "bhabhi xxx", "bhabhi nude",
  "antarvasna", "mastram", "savita bhabhi", "savitabhabhi", "kirtu",
  "bollywood porn", "bollywood xxx", "b-grade", "bgrade", "b grade movie",
  "mallu sex", "mallu porn", "mallu aunty", "tamil sex", "tamil porn", "tamil aunty",
  "telugu sex", "telugu porn", "telugu aunty",
  "kannada sex", "malayalam sex", "marathi sex", "punjabi sex", "bengali sex",
  "pakistani sex", "pakistani porn", "paki porn",
  "hindi sex", "hindi porn", "hindi xxx", "hindi audio porn",
  "desi mms", "leaked mms", "viral mms", "mms video", "mms scandal",
  // Hindi / Urdu slang
  "randi", "randi khana", "chudai", "chudwana", "choot", "chut", "chutiya",
  "lund", "lauda", "land", "gandu", "gaandu", "gand mara",
  "madarchod", "madarjaat", "behenchod", "bhenchod", "bhosdi", "bhosdike", "bhosdiwala",
  "mc bc", "haramzada", "harami",
  "boobs hindi", "doodh", "mamme", "chuche", "chuchi",
  "sexy bhabhi", "hot bhabhi", "horny bhabhi", "sexy aunty", "hot aunty", "horny aunty",
  "village sex", "village aunty", "village bhabhi",
  // Channel/group bait names
  "join porn", "porn vip", "vip porn", "premium porn", "porn premium",
  "desi vip", "desi premium", "free nudes", "nude pack", "leaked pack",
  "girls leaked", "girl leaked", "telegram nude", "telegram porn", "telegram xxx",
  // Common adult emoji combos
  "🍑🍆", "🍆💦", "🍑💦", "🔞🔥", "🥵🤤", "🥵🍑", "🤤🍆", "🤤🍑",
  "🍆🍆", "🍑🍑", "💦💦", "👅💦", "🍆👅", "🍑👅", "🥵🥵", "🫦🍆", "🫦🍑"
];

const SCAM_KEYWORDS = [
  "crypto scam", "free money", "free crypto", "airdrop free", "earn $", "easy money",
  "investment opportunity", "double your money", "guaranteed profit", "join my group",
  "join our channel", "promote channel", "channel promotion", "buy followers",
  // Casino / betting / "bonus" spam. Matching runs on the NFKC-normalized text,
  // so stylized Unicode ("𝗕𝗢𝗡𝗨𝗦", "８０$") is folded to plain ASCII first.
  // Multi-word / brand phrases only — single generic words like "casino",
  // "betting" or "play now" caused false positives in ordinary chat.
  "bonus ready", "no kyc", "instant payout", "instant payouts", "join play withdraw",
  "promo code", "bonus code", "free spins", "freespins", "free bet", "freebet",
  "deposit bonus", "welcome bonus", "sign up bonus", "signup bonus", "no deposit bonus",
  "slots bot", "slot bot", "bet now", "claim bonus", "claim your bonus",
  "withdraw instantly", "instant withdrawal", "guaranteed win", "sure win",
  "online casino", "casino bonus", "betting site", "betting bot", "gambling site",
  "1xbet", "bcgame", "bc game", "stake com", "melbet", "parimatch", "mostbet",
  "betwinner", "linebet", "pin up casino", "1win", "22bet"
];

const DEFAULT_SETTINGS = {
  silentMode: {
    enabled: true,                // bot never talks to members in the group
    suppressWelcome: true,        // skip welcome messages
    suppressCaptcha: false,       // still show captcha (otherwise new joiners are stuck restricted)
    suppressAnnouncements: true,  // raid alerts / CAS removal pings / NSFW name notices
    suppressActionNotices: true   // /ban /kick /mute "Banned X" group replies (admins see logs)
  },
  welcome: {
    enabled: true,
    text: "Welcome to the group, {username}! 👋 Please make sure to follow the guidelines.",
    deleteAfterSeconds: 30
  },
  antiSpam: {
    enabled: true,
    maxMessages: 5,
    intervalMs: 3000,
    action: "warn", // warn, mute, kick, ban
    duplicateLimit: 3 // identical messages within window trigger spam
  },
  antiLink: {
    enabled: true,
    // Admins are trusted to post links (announcements, official URLs), so they
    // are exempt by default. Flip this on only if you don't trust your admins.
    enforceOnAdmins: false,
    strictMode: true,          // catch bare domains, shorteners, all schemes
    action: "delete_and_warn", // delete, warn, delete_and_warn, ban
    whitelistDomains: []       // exact hostname or *.example.com matches never blocked
  },
  antiForward: {
    enabled: true,
    action: "delete_and_warn", // delete, delete_and_warn, ban
    blockChannels: true,       // forwards from channels
    blockUsers: true,          // forwards from other users/bots
    blockHidden: true          // forwards where origin name is hidden
  },
  antiMention: {
    enabled: true,
    action: "delete_and_warn",
    blockChannelMentions: true, // @channelname, t.me/joinchat, t.me/+invite, t.me/anything
    blockUserMentions: false,   // tagging members is allowed by default
    whitelistUsernames: []      // e.g. ["@myofficialchannel"]
  },
  antiMedia: {
    enabled: true,
    action: "delete_and_warn",
    blockStickers: false,        // delete all stickers
    blockAnimations: false,      // delete all GIFs
    blockVideoNotes: false,      // round video messages
    blockPhotos: false,          // delete all photos (incl. thumbnails)
    blockVideos: false,          // delete all videos
    blockDocuments: false,       // delete all document/file uploads
    blockVoice: false,           // delete voice notes
    scanCaptions: true,          // scan captions/file names for NSFW
    scanStickerEmoji: true,      // sticker emoji against NSFW list (e.g. 🔞)
    scanFileNames: true,         // document file name against NSFW list
    requireCaptionForPhotos: false, // delete photos with no caption (common spam pattern)
    minPhotoCaptionLen: 0        // delete photos with captions shorter than N chars
  },
  antiButton: {
    enabled: true,
    action: "delete_and_warn",
    blockInlineKeyboards: true, // messages carrying reply_markup inline buttons
    blockViaBot: true,           // messages sent via @inlinebot
    blockButtonText: true        // text formatted to look like buttons / promo CTA
  },
  antiPreview: {
    enabled: true,
    enforceOnAdmins: false,      // admins share previewed links legitimately
    action: "delete_and_warn",
    blockWebPreviews: true       // any message that resolves a link preview thumbnail
  },
  profanity: {
    enabled: true,
    enforceOnAdmins: true,
    blacklist: [...NSFW_KEYWORDS, ...SCAM_KEYWORDS],
    action: "delete_and_warn"
  },
  antiRaid: {
    enabled: false,
    joinLimit: 10,
    intervalSeconds: 10,
    action: "restrict" // restrict (mute), lock (close chat)
  },
  captcha: {
    enabled: true,
    timeoutSeconds: 90,
    maxAttempts: 2,
    kickOnFail: true,
    tryDmFirst: true,           // try DM the captcha so only the new user sees it
    disableNotification: true,  // when posted in group, no ping
    autoDeleteOnFallback: true  // in-group fallback message deletes on solve/fail
  },
  cas: {
    enabled: true, // Combot Anti-Spam blocklist lookup on join
    action: "ban"  // ban | kick | restrict
  },
  nameFilter: {
    enabled: true, // scan username + first_name + last_name on join against NSFW blacklist
    action: "ban"
  },
  antiSenderChat: {
    enabled: true,              // channels / "send as channel" posting into the group
    banChannel: true,           // banChatSenderChat so that channel can never post again
    allowLinkedChannel: true,   // don't touch auto-forwards from the group's own linked channel
    action: "delete"            // channel gets banned anyway; warning a channel is meaningless
  },
  languageFilter: {
    // Per-group overridable: a Korean or Chinese community should turn the
    // matching script OFF for that group via the Groups panel.
    enabled: true,
    blockCJK: true,             // Han + kana. Chinese/Japanese payment spam is rampant in crypto groups
    blockKorean: false,         // Hangul — off by default so Korean groups work out of the box
    blockCyrillic: false,       // careful: overlaps with confusable-glyph usage
    blockArabic: false,
    blockThai: false,
    minChars: 2,                // N+ chars of a blocked script → delete
    action: "delete_and_warn"
  },
  antiZalgo: {
    enabled: true,
    maxCombiningChars: 30,    // overall U+0300..U+036F count
    blockRtlOverride: true,   // U+202E and friends
    action: "delete_and_warn"
  },
  lockChat: {
    locked: false             // when true, only admins can send messages
  },
  enforcement: {
    // When banning, also delete EVERY message the user has posted in the group
    // (Telegram banChatMember revoke_messages). Makes a spammer's whole burst
    // vanish in one shot instead of leaving the other messages behind.
    revokeMessagesOnBan: true,
    // Master switch: group admins and the owner are never moderated by any rule.
    // This overrides every per-rule enforceOnAdmins flag, so there is exactly one
    // place to look when an admin's message gets touched.
    exemptAdmins: true
  },
  antiAdultEmoji: {
    enabled: true,
    enforceOnAdmins: true,
    threshold: 2,              // 2 suggestive emojis in one message → block
    densityRatio: 0.4,         // adult-emoji-grapheme share of message ≥ 40% → block
    blockOnSticker: true,      // sticker emoji that's adult → block (even if pack name is clean)
    scanCaptions: true,        // run the check on media captions too
    action: "delete_and_warn"
  },
  antiBotPoster: {
    enabled: true,
    action: "ban",                  // ban | kick | delete
    whitelistBotIds: [],            // numeric bot user ids the group has approved
    whitelistBotUsernames: []       // @handles (case-insensitive)
  },
  antiPremiumEmoji: {
    enabled: true,
    enforceOnAdmins: false,       // admins legitimately use premium/custom emoji
    blockAllCustomEmoji: true,    // any premium custom_emoji entity → block (recommended)
    blockVideoStickers: true,     // is_video stickers (WebM) — overwhelmingly NSFW packs
    blockAnimatedStickers: false, // is_animated (TGS) — many free packs are fine, off by default
    customEmojiBlocklist: [],     // string ids learned via /blockemoji
    stickerSetBlocklist: [],      // sticker pack names learned via /blockstickerset
    action: "delete_and_warn"
  },
  routineScan: {
    enabled: true,
    scanOnBoot: true,             // auto-sweep at startup over the last defaultDurationHours
    defaultDurationHours: 24,     // default window for the dashboard "Scan now" button
    maxDurationHours: 720,        // hard cap (30 days)
    cacheSizeLimit: 10000,        // max messages to retain in db/messages.json
    cacheTtlDays: 7,              // automatic pruning age
    scanIntervalDelayMs: 35,      // throttle between deletes so Telegram doesn't rate-limit
    autoIntervalHours: 0          // >0 = run a scan automatically every N hours
  },
  newUserRestrictions: {
    enabled: true,
    messageCount: 3,              // user's first N messages are restricted
    durationMinutes: 1440,        // …or any message within this window after joining (24h)
    blockLinks: true,
    blockMedia: true,             // photos/videos/docs/stickers/voice from brand-new members
    blockForwards: true,
    action: "delete_and_warn"
  },
  contentTypes: {
    enabled: true,
    enforceOnAdmins: false,       // admins post polls / media legitimately
    blockPaidMedia: true,         // Telegram Stars paid media — primary porn-sale vector
    blockSpoilerMedia: false,     // photos/videos hidden behind tap-to-reveal spoiler
    scanPolls: true,              // poll question + options run through the blacklist
    blockPolls: false,            // blanket-delete all polls
    blockGames: true,             // game messages (HTML5 games, often spam)
    blockContacts: true,          // shared contact cards — near-universally spam in groups
    blockLocations: false,        // location/venue shares
    maxMessageLength: 0,          // 0 = off; otherwise delete walls of text above N chars
    blockRepeatedChars: true,     // "aaaaaaaa…" 15+ same char in a row
    action: "delete_and_warn"
  }
};

const DEFAULT_DATA = {
  stats: {
    messagesProcessed: 0,
    spamBlocked: 0,
    linksDeleted: 0,
    profanityDeleted: 0,
    forwardsBlocked: 0,
    mentionsBlocked: 0,
    nsfwMediaBlocked: 0,
    buttonsBlocked: 0,
    previewsBlocked: 0,
    captchasIssued: 0,
    captchasFailed: 0,
    casHits: 0,
    namesBlocked: 0,
    senderChatBlocked: 0,
    channelsBanned: 0,
    languageBlocked: 0,
    zalgoBlocked: 0,
    adultEmojiBlocked: 0,
    premiumEmojiBlocked: 0,
    botsRemoved: 0,
    routineScanRuns: 0,
    routineScanDeleted: 0,
    routineScanMessages: 0,
    newUserBlocked: 0,
    contentBlocked: 0,
    gbans: 0,
    warningsIssued: 0,
    usersBanned: 0,
    usersMuted: 0
  },
  warnings: {}, // { userId: { username: string, count: number, reasons: [] } }
  bans: [],      // [ { userId: number, username: string, bannedAt: date, reason: string } ]
  mutes: [],     // [ { userId: number, username: string, mutedAt: date, until: date } ]
  chats: {}      // { chatId: { title, lastSeen } } — every group the bot has seen (for /gban)
};

let settings = { ...DEFAULT_SETTINGS };
let data = { ...DEFAULT_DATA };

// Deep-merge user settings on top of defaults so newly-added rule sections
// (e.g. antiForward) appear even if the stored settings.json predates them.
function mergeWithDefaults(stored) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    merged[key] = { ...DEFAULT_SETTINGS[key], ...(stored && stored[key] ? stored[key] : {}) };
  }
  return merged;
}

// Bump when a saved setting must be corrected on existing installs. Stored
// values normally win over defaults, so changing a default alone is not enough.
const SETTINGS_SCHEMA_VERSION = 6;

// v3 briefly shipped these as blacklist entries. They are ordinary English words
// that fire on innocent chat ("lets play now a game"), so v4 removes them again.
const FALSE_POSITIVE_KEYWORDS = [
  'casino', 'betting', 'gamble', 'gambling', 'jackpot', 'roulette', 'blackjack',
  'sportsbook', 'wager', 'cashout', 'cash out now', 'play now', 'use code', 'no deposit'
];

// v2: earlier builds shipped enforceOnAdmins=true on link/preview/media rules,
// which deleted (and tried to ban for) links posted by group admins. Admins are
// trusted for those; only the NSFW text/emoji rules still apply to them.
function migrateSettings(s) {
  if (!s || s._schemaVersion >= SETTINGS_SCHEMA_VERSION) return { settings: s, changed: false };
  let changed = false;
  for (const section of ['antiLink', 'antiPreview', 'antiPremiumEmoji', 'contentTypes']) {
    if (s[section] && s[section].enforceOnAdmins === true) {
      s[section].enforceOnAdmins = false;
      changed = true;
    }
  }
  // Drop the dead flag that contradicted enforceOnAdmins in the UI.
  if (s.antiLink && 'allowAdmins' in s.antiLink) { delete s.antiLink.allowAdmins; changed = true; }

  // v3: fold any newly-shipped blacklist keywords into the saved list. Additive
  // only — words the operator added by hand are preserved, and words they
  // deliberately deleted stay deleted for everything except this new batch.
  if (s.profanity && Array.isArray(s.profanity.blacklist)) {
    // Prune the over-broad words v3 introduced before re-merging.
    const bad = new Set(FALSE_POSITIVE_KEYWORDS);
    const before = s.profanity.blacklist.length;
    s.profanity.blacklist = s.profanity.blacklist.filter(w => !bad.has(String(w).toLowerCase()));
    if (s.profanity.blacklist.length !== before) {
      changed = true;
      logEvent('INFO', `⚙️ Removed ${before - s.profanity.blacklist.length} over-broad keyword(s) that flagged normal chat.`);
    }

    const have = new Set(s.profanity.blacklist.map(w => String(w).toLowerCase()));
    const added = DEFAULT_SETTINGS.profanity.blacklist.filter(w => !have.has(String(w).toLowerCase()));
    if (added.length) {
      s.profanity.blacklist = s.profanity.blacklist.concat(added);
      changed = true;
      logEvent('INFO', `⚙️ Added ${added.length} new spam keyword(s) to the filter (casino/betting spam).`);
    }
  }

  // v5: shared contact cards ("MESSAGE / ADD" cards carrying a phone number and
  // an advert in the contact's name) are a standing spam vector — block by default.
  if (s.contentTypes && s.contentTypes.blockContacts === false) {
    s.contentTypes.blockContacts = true;
    changed = true;
    logEvent('INFO', '⚙️ Shared contact cards are now blocked (common phone/WeChat spam vector).');
  }

  // v6: one master switch for admin exemption. Existing installs had it spread
  // across per-rule enforceOnAdmins flags, so an admin could still be moderated
  // by whichever rule still had the flag on (profanity, adult emoji). Turn the
  // master switch on and clear the stragglers so "admins are exempt" is true.
  if (!s.enforcement) s.enforcement = {};
  if (s.enforcement.exemptAdmins !== false) {
    s.enforcement.exemptAdmins = true;
    for (const section of ['profanity', 'antiAdultEmoji', 'antiMedia', 'antiForward',
                           'antiMention', 'antiLink', 'antiPreview', 'antiPremiumEmoji', 'contentTypes']) {
      if (s[section] && s[section].enforceOnAdmins === true) s[section].enforceOnAdmins = false;
    }
    changed = true;
    logEvent('INFO', '⚙️ Group admins and the owner are now exempt from every moderation rule.');
  }

  s._schemaVersion = SETTINGS_SCHEMA_VERSION;
  return { settings: s, changed: true };
}

// Load settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const fileContent = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const stored = JSON.parse(fileContent);
      const { settings: migrated, changed } = migrateSettings(stored);
      settings = mergeWithDefaults(migrated);
      settings._schemaVersion = SETTINGS_SCHEMA_VERSION;
      if (changed) {
        try {
          fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
          logEvent('INFO', '⚙️ Settings updated: group admins are no longer blocked from posting links, previews, polls or custom emoji.');
        } catch (e) {}
      }
    } else {
      settings = { ...DEFAULT_SETTINGS, _schemaVersion: SETTINGS_SCHEMA_VERSION };
      saveSettings(settings);
    }
  } catch (err) {
    console.error("Error loading settings.json, reverting to defaults:", err);
    settings = { ...DEFAULT_SETTINGS };
  }
  return settings;
}

// Save settings
function saveSettings(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    logEvent('INFO', 'Settings updated and saved successfully.');
  } catch (err) {
    console.error("Error saving settings.json:", err);
  }
}

// Load DB data
function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const fileContent = fs.readFileSync(DATA_PATH, 'utf8');
      data = JSON.parse(fileContent);
      // Ensure properties exist
      data.stats = { ...DEFAULT_DATA.stats, ...data.stats };
      data.warnings = data.warnings || {};
      data.bans = data.bans || [];
      data.mutes = data.mutes || [];
      // NOTE: the chat registry moved to db/chats.json — see loadChatRegistry().
    } else {
      saveData(DEFAULT_DATA);
    }
  } catch (err) {
    console.error("Error loading db.json, reverting to defaults:", err);
    data = { ...DEFAULT_DATA };
  }
  return data;
}

// Debounced notify-on-data-changed (for the dashboard's User Database tab).
let onDataChangeCallback = null;
let dataChangeTimer = null;
function notifyDataChanged() {
  if (!onDataChangeCallback) return;
  if (dataChangeTimer) return;
  dataChangeTimer = setTimeout(() => {
    dataChangeTimer = null;
    try { onDataChangeCallback(); } catch (e) {}
  }, 400);
}
function registerDataCallback(cb) { onDataChangeCallback = cb; }

// Save DB data
function saveData(newData) {
  try {
    data = { ...data, ...newData };
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
    notifyDataChanged();
  } catch (err) {
    console.error("Error saving db.json:", err);
  }
}

// Increment stat — does NOT call loadData() mid-flight so callers can batch
// a push + incrementStat + saveData without losing their in-memory mutations.
function incrementStat(statKey) {
  if (!data.stats) {
    loadData();
  }
  if (data.stats[statKey] === undefined) data.stats[statKey] = 0;
  data.stats[statKey]++;
  saveData(data);
}

// Log buffer — kept in memory and mirrored to db/logs.json so restarts
// don't wipe the live terminal. Persisted writes are debounced (1s) so a
// burst of events doesn't hammer the disk.
const LOG_BUFFER_MAX = 1000;
const LOG_PERSIST_MAX = 5000;
const logBuffer = [];
let onLogCallback = null;

let logFlushTimer = null;
function flushLogsToDisk() {
  try {
    const data = JSON.stringify(logBuffer.slice(-LOG_PERSIST_MAX));
    fs.writeFileSync(LOGS_PATH, data, 'utf8');
  } catch (e) {
    // Disk full or read-only — fall back to memory only.
  }
}
function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogsToDisk();
  }, 1000);
}

function loadPersistedLogs() {
  try {
    if (!fs.existsSync(LOGS_PATH)) return;
    const arr = JSON.parse(fs.readFileSync(LOGS_PATH, 'utf8'));
    if (Array.isArray(arr)) {
      for (const entry of arr.slice(-LOG_BUFFER_MAX)) {
        if (entry && entry.timestamp && entry.level && entry.message) {
          logBuffer.push(entry);
        }
      }
    }
  } catch (e) {}
}

// All known log levels — used by the dashboard filter dropdown.
const LOG_LEVELS = [
  'INFO', 'WARN', 'ERROR', 'COMMAND',
  'SPAM', 'FLOOD', 'RAID', 'JOIN', 'LEAVE',
  'LINK', 'FORWARD', 'MENTION', 'MEDIA', 'BUTTON', 'PREVIEW',
  'PROFANITY', 'ZALGO', 'NAME', 'SENDERCHAT', 'PREMIUM',
  'BAN', 'UNBAN', 'KICK', 'MUTE', 'UNMUTE', 'WARNING', 'DELETE',
  'CAPTCHA', 'CAS', 'LOCK', 'UNLOCK', 'REPORT',
  'NEWUSER', 'CONTENT', 'GBAN', 'WATCHDOG'
];

function logEvent(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const lvl = (level || 'INFO').toUpperCase();
  const logEntry = { timestamp, level: lvl, message, metadata };

  const colorMap = {
    ERROR: '\x1b[31m', WARN: '\x1b[33m', SPAM: '\x1b[35m', FLOOD: '\x1b[35m',
    RAID: '\x1b[41m\x1b[37m', LINK: '\x1b[36m', FORWARD: '\x1b[36m',
    MENTION: '\x1b[36m', MEDIA: '\x1b[34m', BUTTON: '\x1b[34m',
    PREVIEW: '\x1b[34m', PROFANITY: '\x1b[35m', ZALGO: '\x1b[35m',
    NAME: '\x1b[33m', SENDERCHAT: '\x1b[33m', PREMIUM: '\x1b[35m',
    BAN: '\x1b[41m\x1b[37m', UNBAN: '\x1b[32m', KICK: '\x1b[33m', MUTE: '\x1b[33m',
    UNMUTE: '\x1b[32m', WARNING: '\x1b[33m', DELETE: '\x1b[36m',
    NEWUSER: '\x1b[33m', CONTENT: '\x1b[35m', GBAN: '\x1b[41m\x1b[37m', WATCHDOG: '\x1b[33m',
    CAPTCHA: '\x1b[34m', CAS: '\x1b[31m', LOCK: '\x1b[33m',
    UNLOCK: '\x1b[32m', REPORT: '\x1b[33m', JOIN: '\x1b[32m',
    LEAVE: '\x1b[36m', COMMAND: '\x1b[36m'
  };
  const consoleColor = colorMap[lvl] || '\x1b[32m';
  console.log(`[${timestamp}] ${consoleColor}[${lvl}]\x1b[0m ${message}`);

  logBuffer.push(logEntry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  scheduleLogFlush();
  if (onLogCallback) onLogCallback(logEntry);
}

function registerLogCallback(callback) {
  onLogCallback = callback;
}

function getLogs() {
  return logBuffer;
}

// Warnings Management
function addWarning(userId, username, reason, chatId, chatTitle) {
  loadData();
  if (!data.warnings[userId]) {
    data.warnings[userId] = {
      username: username || `User_${userId}`,
      count: 0,
      reasons: []
    };
  }
  const w = data.warnings[userId];
  // Keep the display name fresh — users rename themselves.
  if (username) w.username = username;
  w.count++;
  // Which group this happened in, so the dashboard can show/filter by it.
  w.chatId = chatId || w.chatId || null;
  w.chatTitle = chatTitle || w.chatTitle || null;
  w.lastAt = new Date().toISOString();
  w.firstAt = w.firstAt || w.lastAt;
  w.reasons.push({
    reason,
    chatId: chatId || null,
    chatTitle: chatTitle || null,
    timestamp: w.lastAt
  });
  // Don't let one persistent spammer balloon the file.
  if (w.reasons.length > 20) w.reasons = w.reasons.slice(-20);
  incrementStat('warningsIssued');
  saveData(data);
  const c = w.count;
  logEvent('WARNING', `⚠️ Warned @${username || userId} (${c}/3) — ${reason}${chatTitle ? ` in “${chatTitle}”` : ''}`);
  return c;
}

function clearWarnings(userId) {
  loadData();
  if (data.warnings[userId]) {
    const username = data.warnings[userId].username;
    delete data.warnings[userId];
    saveData(data);
    logEvent('INFO', `Cleared all warnings for @${username || userId}`);
    return true;
  }
  return false;
}

function getWarnings() {
  loadData();
  return data.warnings;
}

// Ban / Mute management
function addBan(userId, username, reason, chatId) {
  loadData();
  data.bans.push({
    userId,
    username: username || `User_${userId}`,
    bannedAt: new Date().toISOString(),
    reason,
    chatId: chatId || null,
    active: true
  });
  incrementStat('usersBanned');
  saveData(data);
  logEvent('BAN', `🔨 Banned @${username || userId} — ${reason}`);
}

// Marks the ban record as inactive (kept for history) so the dashboard can
// move it out of the "Active bans" list. Pass `purge: true` to delete the row.
function removeBan(userId, opts = {}) {
  loadData();
  const idx = data.bans.findIndex(b => Number(b.userId) === Number(userId) && b.active !== false);
  if (idx < 0) return null;
  const record = data.bans[idx];
  if (opts.purge) {
    data.bans.splice(idx, 1);
  } else {
    data.bans[idx] = { ...record, active: false, unbannedAt: new Date().toISOString() };
  }
  saveData(data);
  logEvent('UNBAN', `🔓 Unbanned @${record.username || userId}`);
  return record;
}

function addMute(userId, username, durationMinutes, reason) {
  loadData();
  const until = durationMinutes ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
  data.mutes.push({
    userId,
    username: username || `User_${userId}`,
    mutedAt: new Date().toISOString(),
    until,
    reason
  });
  incrementStat('usersMuted');
  saveData(data);
  logEvent('MUTE', `🔇 Muted @${username || userId} for ${durationMinutes || 'indefinite'} min — ${reason}`);
}

// -------- Uptime heartbeat --------
// Telegram only queues ~24h of updates while a bot is offline, and caps the
// queue. Past that window, messages posted during downtime are gone for good —
// no bot can retrieve them. We record a heartbeat so the operator gets told
// exactly how long the blind spot was instead of silently missing spam.
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
let heartbeatTimer = null;

function writeHeartbeat() {
  try { fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({ lastAlive: Date.now() })); } catch (e) {}
}
function readLastAlive() {
  try {
    if (!fs.existsSync(HEARTBEAT_PATH)) return null;
    const j = JSON.parse(fs.readFileSync(HEARTBEAT_PATH, 'utf8'));
    return j && j.lastAlive ? j.lastAlive : null;
  } catch (e) { return null; }
}
function startHeartbeat() {
  if (heartbeatTimer) return;
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}
// Returns { downMs, downText, beyondBacklog } describing the gap since last run.
function getDowntime() {
  const last = readLastAlive();
  if (!last) return null;
  const downMs = Date.now() - last;
  if (downMs < 5 * 60 * 1000) return null; // normal restart, not worth reporting
  const h = Math.floor(downMs / 3600000);
  const m = Math.floor((downMs % 3600000) / 60000);
  return {
    downMs,
    downText: h ? `${h}h ${m}m` : `${m}m`,
    beyondBacklog: downMs > 24 * 3600 * 1000
  };
}

// -------- Known-chats registry (own file: db/chats.json) --------
// Tracks every group the bot is in: used for /gban, the dashboard Groups panel,
// and per-group rule overrides.
//
// This deliberately lives OUTSIDE db.json. It used to be `data.chats`, but any
// loadData() call (from addBan, incrementStat, a dashboard read…) reloads `data`
// from disk and silently discarded chat records that were still waiting on the
// debounced write — groups would appear, then vanish. Its own file + its own
// in-memory object removes that race entirely.
let chatRegistry = {};
let chatRegistryDirty = false;

function loadChatRegistry() {
  try {
    if (fs.existsSync(CHATS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CHATS_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') chatRegistry = parsed;
    }
  } catch (e) {
    console.error('Error loading chats.json:', e.message);
  }
  // One-time migration from the old data.chats location.
  try {
    if (data && data.chats && Object.keys(data.chats).length) {
      for (const [id, rec] of Object.entries(data.chats)) {
        if (!chatRegistry[id]) chatRegistry[id] = rec;
      }
      delete data.chats;
      saveData(data);
      flushChatRegistry();
      logEvent('INFO', `Migrated ${Object.keys(chatRegistry).length} group record(s) to db/chats.json`);
    }
  } catch (e) {}
  return chatRegistry;
}

function flushChatRegistry() {
  try {
    fs.writeFileSync(CHATS_PATH, JSON.stringify(chatRegistry, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving chats.json:', e.message);
  }
}
function scheduleChatFlush() {
  if (chatRegistryDirty) return;
  chatRegistryDirty = true;
  setTimeout(() => { chatRegistryDirty = false; flushChatRegistry(); }, 3000);
}

function recordChat(chatId, title, meta = {}) {
  if (!chatId) return;
  const key = String(chatId);
  const prev = chatRegistry[key] || {};
  const isNew = !chatRegistry[key];
  chatRegistry[key] = {
    ...prev,                                   // keep overrides + counters
    title: title || prev.title || null,
    type: meta.type || prev.type || null,
    memberCount: meta.memberCount !== undefined ? meta.memberCount : prev.memberCount,
    // Permission snapshot — the dashboard warns when the bot can't actually act.
    botIsAdmin: meta.botIsAdmin !== undefined ? meta.botIsAdmin : prev.botIsAdmin,
    canDelete: meta.canDelete !== undefined ? meta.canDelete : prev.canDelete,
    canBan: meta.canBan !== undefined ? meta.canBan : prev.canBan,
    firstSeen: prev.firstSeen || Date.now(),
    lastSeen: Date.now(),
    messagesSeen: (prev.messagesSeen || 0) + (meta.countMessage ? 1 : 0),
    actionsTaken: prev.actionsTaken || 0
  };
  // A brand-new group is worth writing immediately so a crash can't lose it.
  if (isNew) flushChatRegistry();
  else scheduleChatFlush();
}
function getKnownChats() {
  return chatRegistry;
}
function removeChat(chatId) {
  const key = String(chatId);
  if (!chatRegistry[key]) return false;
  delete chatRegistry[key];
  flushChatRegistry();
  return true;
}
// Count a moderation action against a group (dashboard "actions" column).
function bumpChatAction(chatId) {
  if (!chatId) return;
  const rec = chatRegistry[String(chatId)];
  if (!rec) return;
  rec.actionsTaken = (rec.actionsTaken || 0) + 1;
  scheduleChatFlush();
}

// -------- Per-group rule overrides --------
// A Korean or Chinese-speaking group needs different language rules than an
// English one. Overrides are a partial settings object stored per chat and
// merged over the global settings at moderation time.
function setChatOverrides(chatId, overrides) {
  const key = String(chatId);
  if (!chatRegistry[key]) {
    chatRegistry[key] = { title: null, firstSeen: Date.now(), lastSeen: Date.now() };
  }
  const clean = {};
  if (overrides && typeof overrides === 'object') {
    // Only allow keys that exist in the real settings schema.
    for (const section of Object.keys(DEFAULT_SETTINGS)) {
      if (overrides[section] && typeof overrides[section] === 'object') {
        clean[section] = { ...overrides[section] };
      }
    }
  }
  chatRegistry[key].overrides = clean;
  flushChatRegistry();
  logEvent('INFO', `⚙️ Per-group settings updated for “${chatRegistry[key].title || key}”.`);
  return clean;
}
function clearChatOverrides(chatId) {
  const rec = chatRegistry[String(chatId)];
  if (!rec) return false;
  delete rec.overrides;
  flushChatRegistry();
  return true;
}
// Global settings with this chat's overrides applied on top.
function getSettingsForChat(chatId) {
  const base = loadSettings();
  if (!chatId) return base;
  const rec = chatRegistry[String(chatId)];
  const ov = rec && rec.overrides;
  if (!ov || Object.keys(ov).length === 0) return base;
  const merged = { ...base };
  for (const section of Object.keys(ov)) {
    if (base[section] && typeof base[section] === 'object') {
      merged[section] = { ...base[section], ...ov[section] };
    }
  }
  return merged;
}

// -------- Admin account + session helpers ---------
function adminExists() {
  try { return fs.existsSync(ADMIN_PATH); } catch (e) { return false; }
}

function _hash(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function createAdmin(username, password) {
  if (adminExists()) return { ok: false, error: 'admin_already_exists' };
  if (!username || typeof username !== 'string' || username.length < 3 || username.length > 32) {
    return { ok: false, error: 'invalid_username' };
  }
  if (!password || typeof password !== 'string' || password.length < 8 || password.length > 256) {
    return { ok: false, error: 'password_too_short' };
  }
  const safeUser = username.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = _hash(password, salt);
  fs.writeFileSync(ADMIN_PATH, JSON.stringify({ username: safeUser, salt, hash, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  logEvent('INFO', `Admin account created: ${safeUser}`);
  return { ok: true };
}

function verifyAdmin(username, password) {
  if (!adminExists()) return false;
  try {
    const admin = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'));
    if (typeof username !== 'string' || typeof password !== 'string') return false;
    if (admin.username !== username) return false;
    const calc = _hash(password, admin.salt);
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(admin.hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function changeAdminPassword(currentPassword, newPassword) {
  if (!adminExists()) return { ok: false, error: 'no_admin' };
  try {
    const admin = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'));
    if (!verifyAdmin(admin.username, currentPassword)) return { ok: false, error: 'wrong_password' };
    if (!newPassword || newPassword.length < 8) return { ok: false, error: 'password_too_short' };
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = _hash(newPassword, salt);
    fs.writeFileSync(ADMIN_PATH, JSON.stringify({ ...admin, salt, hash, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    logEvent('INFO', `Admin password rotated for ${admin.username}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'internal' };
  }
}

// Sessions persist to db/sessions.json so admins stay logged in across restarts.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = {};

let sessionFlushTimer = null;
function flushSessionsToDisk() {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions), { mode: 0o600 });
  } catch (e) {}
}
function scheduleSessionFlush() {
  if (sessionFlushTimer) return;
  sessionFlushTimer = setTimeout(() => {
    sessionFlushTimer = null;
    flushSessionsToDisk();
  }, 500);
}

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const obj = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    if (!obj || typeof obj !== 'object') return;
    const now = Date.now();
    for (const [token, s] of Object.entries(obj)) {
      if (s && typeof s === 'object' && s.username && s.lastSeen &&
          now - s.lastSeen < SESSION_TTL_MS &&
          /^[a-f0-9]{64}$/.test(token)) {
        sessions[token] = s;
      }
    }
  } catch (e) {}
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username, createdAt: Date.now(), lastSeen: Date.now() };
  scheduleSessionFlush();
  return token;
}
function validateSession(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = sessions[token];
  if (!s) return null;
  if (Date.now() - s.lastSeen > SESSION_TTL_MS) {
    delete sessions[token];
    scheduleSessionFlush();
    return null;
  }
  s.lastSeen = Date.now();
  scheduleSessionFlush();
  return s;
}
function destroySession(token) {
  if (token && sessions[token]) {
    delete sessions[token];
    scheduleSessionFlush();
  }
}

// -------- Multi-bot record storage --------
// Tokens are stored in db/bots.json (file mode 0600). The dashboard never
// returns the raw token over the wire — only metadata (id, name, addedAt).
const BOT_TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;

function listBotRecords() {
  try {
    if (!fs.existsSync(BOTS_PATH)) return [];
    const arr = JSON.parse(fs.readFileSync(BOTS_PATH, 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.filter(b => b && typeof b.token === 'string' && BOT_TOKEN_RE.test(b.token));
  } catch (e) {
    return [];
  }
}

function _saveBotRecords(arr) {
  try {
    fs.writeFileSync(BOTS_PATH, JSON.stringify(arr, null, 2), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('Error writing bots.json:', e.message);
    return false;
  }
}

function addBotRecord(token, name) {
  if (!token || typeof token !== 'string' || !BOT_TOKEN_RE.test(token.trim())) {
    return { ok: false, error: 'invalid_token_format' };
  }
  const trimmed = token.trim();
  const list = listBotRecords();
  if (list.some(b => b.token === trimmed)) {
    return { ok: false, error: 'already_added' };
  }
  list.push({ token: trimmed, name: (name && String(name).slice(0, 64)) || null, addedAt: new Date().toISOString() });
  _saveBotRecords(list);
  logEvent('INFO', `Bot record added (${list.length} total)`);
  return { ok: true };
}

// Remove by token-prefix (first 12 chars before ":") so the API never has to
// accept the raw token. Returns the record that was removed, or null.
function removeBotRecord(idPrefix) {
  if (typeof idPrefix !== 'string') return null;
  const list = listBotRecords();
  const i = list.findIndex(b => b.token.startsWith(String(idPrefix) + ':'));
  if (i < 0) return null;
  const [removed] = list.splice(i, 1);
  _saveBotRecords(list);
  logEvent('INFO', `Bot record ${idPrefix} removed`);
  return removed;
}

// Public-safe view of bot records (no tokens).
function publicBotRecords() {
  return listBotRecords().map(b => ({
    id: b.token.split(':')[0],            // numeric bot id (Telegram's, also part of the token)
    name: b.name || null,
    addedAt: b.addedAt || null
  }));
}

// Bootstrap: if .env has a token AND bots.json is empty, migrate it in.
function migrateEnvTokenIfNeeded() {
  if (listBotRecords().length > 0) return false;
  const envTok = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!envTok || !BOT_TOKEN_RE.test(envTok)) return false;
  addBotRecord(envTok, 'Initial bot (migrated from .env)');
  return true;
}

// -------- Message cache (for routine scans) ----------
// We can't ask Telegram for a group's history (bots have no `getChatHistory` for
// regular groups), so we mirror messages we DO see into a ring buffer. Routine
// scans replay current moderation rules against this cache.
let messageCache = [];
let messageCacheTimer = null;

function loadMessageCache() {
  try {
    if (fs.existsSync(MESSAGE_CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(MESSAGE_CACHE_PATH, 'utf8'));
      if (Array.isArray(data)) messageCache = data;
    }
  } catch (e) {}
  pruneMessageCache();
}
function pruneMessageCache() {
  const s = (settings && settings.routineScan) || DEFAULT_SETTINGS.routineScan;
  const ttlMs = (s.cacheTtlDays || 7) * 86400 * 1000;
  const cutoff = Date.now() - ttlMs;
  messageCache = messageCache.filter(m => m && m.ts >= cutoff);
  if (messageCache.length > (s.cacheSizeLimit || 10000)) {
    messageCache = messageCache.slice(-(s.cacheSizeLimit || 10000));
  }
}
function scheduleMessageCacheFlush() {
  if (messageCacheTimer) return;
  messageCacheTimer = setTimeout(() => {
    messageCacheTimer = null;
    pruneMessageCache();
    try { fs.writeFileSync(MESSAGE_CACHE_PATH, JSON.stringify(messageCache)); } catch (e) {}
  }, 2000);
}
function addMessageToCache(entry) {
  if (!entry || !entry.chatId || !entry.messageId) return;
  messageCache.push(entry);
  scheduleMessageCacheFlush();
}
function getMessagesSince(timestamp) {
  return messageCache.filter(m => m && m.ts >= timestamp);
}
function removeMessageFromCache(chatId, messageId) {
  const before = messageCache.length;
  messageCache = messageCache.filter(m => !(m.chatId === chatId && m.messageId === messageId));
  if (messageCache.length !== before) scheduleMessageCacheFlush();
}

// -------- Scan history (last few scan summaries) ----------
let scanHistory = [];
function loadScanHistory() {
  try {
    if (fs.existsSync(SCAN_HISTORY_PATH)) {
      const data = JSON.parse(fs.readFileSync(SCAN_HISTORY_PATH, 'utf8'));
      if (Array.isArray(data)) scanHistory = data.slice(-50);
    }
  } catch (e) {}
}
function recordScanResult(summary) {
  scanHistory.push(summary);
  if (scanHistory.length > 50) scanHistory = scanHistory.slice(-50);
  try { fs.writeFileSync(SCAN_HISTORY_PATH, JSON.stringify(scanHistory, null, 2)); } catch (e) {}
}
function getScanHistory() { return scanHistory; }

// Sanitize a settings payload from the dashboard — drop unknown keys, clamp numbers.
function sanitizeSettings(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); // start from defaults
  const current = loadSettings();
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    out[key] = { ...current[key], ...DEFAULT_SETTINGS[key] };
    if (payload[key] && typeof payload[key] === 'object') {
      for (const subkey of Object.keys(DEFAULT_SETTINGS[key])) {
        if (Object.prototype.hasOwnProperty.call(payload[key], subkey)) {
          out[key][subkey] = payload[key][subkey];
        } else if (Object.prototype.hasOwnProperty.call(current[key], subkey)) {
          out[key][subkey] = current[key][subkey];
        }
      }
    } else {
      out[key] = { ...DEFAULT_SETTINGS[key], ...current[key] };
    }
  }

  const clampInt = (v, min, max, fallback) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
  };
  out.welcome.deleteAfterSeconds = clampInt(out.welcome.deleteAfterSeconds, 0, 3600, 30);
  out.antiSpam.maxMessages = clampInt(out.antiSpam.maxMessages, 1, 50, 5);
  out.antiSpam.intervalMs = clampInt(out.antiSpam.intervalMs, 500, 60000, 3000);
  out.antiSpam.duplicateLimit = clampInt(out.antiSpam.duplicateLimit, 1, 20, 3);
  out.antiRaid.joinLimit = clampInt(out.antiRaid.joinLimit, 1, 200, 10);
  out.antiRaid.intervalSeconds = clampInt(out.antiRaid.intervalSeconds, 1, 600, 10);
  out.captcha.timeoutSeconds = clampInt(out.captcha.timeoutSeconds, 15, 600, 90);
  out.captcha.maxAttempts = clampInt(out.captcha.maxAttempts, 1, 10, 2);
  out.antiMedia.minPhotoCaptionLen = clampInt(out.antiMedia.minPhotoCaptionLen, 0, 500, 0);
  out.antiZalgo.maxCombiningChars = clampInt(out.antiZalgo.maxCombiningChars, 0, 500, 30);
  out.antiAdultEmoji.threshold = clampInt(out.antiAdultEmoji.threshold, 1, 20, 2);
  const densNum = parseFloat(out.antiAdultEmoji.densityRatio);
  out.antiAdultEmoji.densityRatio = isNaN(densNum) ? 0.4 : Math.max(0, Math.min(1, densNum));
  out.routineScan.defaultDurationHours = clampInt(out.routineScan.defaultDurationHours, 1, 720, 24);
  out.routineScan.maxDurationHours = clampInt(out.routineScan.maxDurationHours, 1, 8760, 720);
  out.routineScan.cacheSizeLimit = clampInt(out.routineScan.cacheSizeLimit, 100, 200000, 10000);
  out.routineScan.cacheTtlDays = clampInt(out.routineScan.cacheTtlDays, 1, 365, 7);
  out.routineScan.scanIntervalDelayMs = clampInt(out.routineScan.scanIntervalDelayMs, 0, 5000, 35);
  out.routineScan.autoIntervalHours = clampInt(out.routineScan.autoIntervalHours, 0, 720, 0);
  out.newUserRestrictions.messageCount = clampInt(out.newUserRestrictions.messageCount, 1, 50, 3);
  out.newUserRestrictions.durationMinutes = clampInt(out.newUserRestrictions.durationMinutes, 1, 10080, 1440);
  out.contentTypes.maxMessageLength = clampInt(out.contentTypes.maxMessageLength, 0, 4096, 0);
  out.languageFilter.minChars = clampInt(out.languageFilter.minChars, 1, 500, 2);

  // String arrays
  out.profanity.blacklist = Array.isArray(payload.profanity && payload.profanity.blacklist)
    ? payload.profanity.blacklist.filter(w => typeof w === 'string' && w.length > 0 && w.length < 100).slice(0, 5000)
    : DEFAULT_SETTINGS.profanity.blacklist;
  out.antiMention.whitelistUsernames = Array.isArray(payload.antiMention && payload.antiMention.whitelistUsernames)
    ? payload.antiMention.whitelistUsernames.filter(w => typeof w === 'string' && w.length < 64).slice(0, 200)
    : (current.antiMention.whitelistUsernames || []);
  out.antiLink.whitelistDomains = Array.isArray(payload.antiLink && payload.antiLink.whitelistDomains)
    ? payload.antiLink.whitelistDomains.filter(w => typeof w === 'string' && w.length < 128).slice(0, 200)
    : (current.antiLink.whitelistDomains || []);
  out.antiBotPoster.whitelistBotIds = Array.isArray(payload.antiBotPoster && payload.antiBotPoster.whitelistBotIds)
    ? payload.antiBotPoster.whitelistBotIds
        .map(x => parseInt(x, 10))
        .filter(x => !isNaN(x) && x > 0)
        .slice(0, 200)
    : (current.antiBotPoster && current.antiBotPoster.whitelistBotIds) || [];
  out.antiBotPoster.whitelistBotUsernames = Array.isArray(payload.antiBotPoster && payload.antiBotPoster.whitelistBotUsernames)
    ? payload.antiBotPoster.whitelistBotUsernames
        .filter(x => typeof x === 'string' && /^@?[A-Za-z0-9_]{3,64}$/.test(x))
        .map(x => x.toLowerCase().replace(/^@/, ''))
        .slice(0, 200)
    : (current.antiBotPoster && current.antiBotPoster.whitelistBotUsernames) || [];
  out.antiPremiumEmoji.customEmojiBlocklist = Array.isArray(payload.antiPremiumEmoji && payload.antiPremiumEmoji.customEmojiBlocklist)
    ? payload.antiPremiumEmoji.customEmojiBlocklist.filter(x => typeof x === 'string' && /^\d{1,30}$/.test(x)).slice(0, 5000)
    : (current.antiPremiumEmoji && current.antiPremiumEmoji.customEmojiBlocklist) || [];
  out.antiPremiumEmoji.stickerSetBlocklist = Array.isArray(payload.antiPremiumEmoji && payload.antiPremiumEmoji.stickerSetBlocklist)
    ? payload.antiPremiumEmoji.stickerSetBlocklist.filter(x => typeof x === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(x)).slice(0, 2000)
    : (current.antiPremiumEmoji && current.antiPremiumEmoji.stickerSetBlocklist) || [];

  // Welcome text capped at 1k chars
  if (typeof out.welcome.text === 'string') {
    out.welcome.text = out.welcome.text.slice(0, 1024);
  } else {
    out.welcome.text = DEFAULT_SETTINGS.welcome.text;
  }

  return out;
}

// Initial boot load
loadSettings();
loadData();
loadPersistedLogs();
loadPersistedSessions();
loadMessageCache();
loadScanHistory();
loadChatRegistry();

// Flush in-flight buffers on shutdown so nothing is lost.
function _gracefulFlush() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); flushLogsToDisk(); }
  if (sessionFlushTimer) { clearTimeout(sessionFlushTimer); flushSessionsToDisk(); }
  if (chatRegistryDirty) { chatRegistryDirty = false; flushChatRegistry(); }
  if (messageCacheTimer) {
    clearTimeout(messageCacheTimer);
    try { fs.writeFileSync(MESSAGE_CACHE_PATH, JSON.stringify(messageCache)); } catch (e) {}
  }
}
process.on('SIGINT',  () => { _gracefulFlush(); process.exit(0); });
process.on('SIGTERM', () => { _gracefulFlush(); process.exit(0); });
process.on('beforeExit', _gracefulFlush);

module.exports = {
  loadSettings,
  saveSettings,
  sanitizeSettings,
  loadData,
  saveData,
  incrementStat,
  logEvent,
  registerLogCallback,
  registerDataCallback,
  getLogs,
  LOG_LEVELS,
  addWarning,
  clearWarnings,
  getWarnings,
  addBan,
  removeBan,
  addMute,
  startHeartbeat,
  getDowntime,
  recordChat,
  getKnownChats,
  removeChat,
  bumpChatAction,
  setChatOverrides,
  clearChatOverrides,
  getSettingsForChat,
  // auth
  adminExists,
  createAdmin,
  verifyAdmin,
  changeAdminPassword,
  createSession,
  validateSession,
  destroySession,
  // message cache + scans
  addMessageToCache,
  getMessagesSince,
  removeMessageFromCache,
  recordScanResult,
  getScanHistory,
  // multi-bot records
  listBotRecords,
  addBotRecord,
  removeBotRecord,
  publicBotRecords,
  migrateEnvTokenIfNeeded,
  BOT_TOKEN_RE
};
