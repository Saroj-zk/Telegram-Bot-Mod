// OctoGod Web Dashboard Client Logic

document.addEventListener('DOMContentLoaded', () => {
  let socket = null;
  let currentSettings = null;
  const allLogs = [];
  let terminalPaused = false;   // Pause button holds incoming terminal lines

  // UI Element Selectors
  const appContainer = document.getElementById('app-container');
  const setupWizard = document.getElementById('setup-wizard');
  const tokenForm = document.getElementById('token-form');
  const botTokenInput = document.getElementById('bot-token');

  // Auth Selectors
  const createAdminModal = document.getElementById('create-admin-modal');
  const createAdminForm = document.getElementById('create-admin-form');
  const caUsername = document.getElementById('ca-username');
  const caPassword = document.getElementById('ca-password');
  const caPasswordConfirm = document.getElementById('ca-password-confirm');

  const loginModal = document.getElementById('login-modal');
  const loginForm = document.getElementById('login-form');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  const logoutBtn = document.getElementById('logout-btn');

  const changePasswordForm = document.getElementById('change-password-form');
  const cpCurrent = document.getElementById('cp-current');
  const cpNew = document.getElementById('cp-new');
  const cpNewConfirm = document.getElementById('cp-new-confirm');

  // Wrap fetch so credentials (session cookie) are always sent and 401s redirect to login.
  async function api(input, init = {}) {
    const opts = { credentials: 'same-origin', ...init };
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(input, opts);
    if (res.status === 401) {
      showAuthScreen('login');
      throw new Error('unauthorized');
    }
    return res;
  }
  
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const quickActionStatusBtn = document.getElementById('quick-action-status');
  const quickActionText = document.getElementById('quick-action-text');

  // Stats Selectors
  const statMessages = document.getElementById('stat-messages');
  const statSpam = document.getElementById('stat-spam');
  const statLinks = document.getElementById('stat-links');
  const statWarns = document.getElementById('stat-warns');
  const statBans = document.getElementById('stat-bans');
  const statMutes = document.getElementById('stat-mutes');
  const statProfanity = document.getElementById('stat-profanity');

  // Checklist Selectors
  const chkToken = document.getElementById('chk-token');

  // Quick Switch Toggles
  const quickWelcomeToggle = document.getElementById('quick-welcome-toggle');
  const quickSpamToggle = document.getElementById('quick-spam-toggle');
  const quickLinkToggle = document.getElementById('quick-link-toggle');
  const quickRaidToggle = document.getElementById('quick-raid-toggle');

  const quickWelcomeLabel = document.getElementById('quick-welcome-label');
  const quickSpamLabel = document.getElementById('quick-spam-label');
  const quickLinkLabel = document.getElementById('quick-link-label');
  const quickRaidLabel = document.getElementById('quick-raid-label');

  // Rules Form Selectors
  const rulesForm = document.getElementById('rules-form');
  // Silent Mode
  const ruleSilentEnabled = document.getElementById('rule-silent-enabled');
  const ruleSilentWelcome = document.getElementById('rule-silent-welcome');
  const ruleSilentAnnouncements = document.getElementById('rule-silent-announcements');
  const ruleSilentActionNotices = document.getElementById('rule-silent-action-notices');
  const ruleSilentCaptcha = document.getElementById('rule-silent-captcha');

  // New-user restrictions
  const ruleNewUserEnabled = document.getElementById('rule-newuser-enabled');
  const ruleNewUserCount = document.getElementById('rule-newuser-count');
  const ruleNewUserDuration = document.getElementById('rule-newuser-duration');
  const ruleNewUserLinks = document.getElementById('rule-newuser-links');
  const ruleNewUserMedia = document.getElementById('rule-newuser-media');
  const ruleNewUserForwards = document.getElementById('rule-newuser-forwards');
  const ruleNewUserAction = document.getElementById('rule-newuser-action');

  // Content-type filters
  const ruleContentEnabled = document.getElementById('rule-content-enabled');
  const ruleContentPaid = document.getElementById('rule-content-paid');
  const ruleContentSpoiler = document.getElementById('rule-content-spoiler');
  const ruleContentScanPolls = document.getElementById('rule-content-scanpolls');
  const ruleContentBlockPolls = document.getElementById('rule-content-blockpolls');
  const ruleContentGames = document.getElementById('rule-content-games');
  const ruleContentContacts = document.getElementById('rule-content-contacts');
  const ruleContentLocations = document.getElementById('rule-content-locations');
  const ruleContentRepeated = document.getElementById('rule-content-repeated');
  const ruleContentMaxLen = document.getElementById('rule-content-maxlen');
  const ruleContentEnforceAdmins = document.getElementById('rule-content-enforce-admins');
  const ruleContentAction = document.getElementById('rule-content-action');

  // Routine scan settings
  const ruleScanEnabled = document.getElementById('rule-scan-enabled');
  const ruleScanAuto = document.getElementById('rule-scan-auto');
  const ruleScanBoot = document.getElementById('rule-scan-boot');
  const ruleScanDefault = document.getElementById('rule-scan-default');
  const ruleScanMax = document.getElementById('rule-scan-max');
  const ruleScanCacheSize = document.getElementById('rule-scan-cache-size');
  const ruleScanCacheTtl = document.getElementById('rule-scan-cache-ttl');
  const ruleScanDelay = document.getElementById('rule-scan-delay');

  // Routine scan overview controls
  const scanDurationSelect = document.getElementById('scan-duration-select');
  const scanDurationCustom = document.getElementById('scan-duration-custom');
  const btnRoutineScan = document.getElementById('btn-routine-scan');
  const btnRoutineScanLabel = document.getElementById('btn-routine-scan-label');
  const lastScanSummary = document.getElementById('last-scan-summary');

  // Captcha
  const ruleCaptchaEnabled = document.getElementById('rule-captcha-enabled');
  const ruleCaptchaTimeout = document.getElementById('rule-captcha-timeout');
  const ruleCaptchaAttempts = document.getElementById('rule-captcha-attempts');
  const ruleCaptchaKick = document.getElementById('rule-captcha-kick');
  const ruleCaptchaDm = document.getElementById('rule-captcha-dm');
  const ruleCaptchaSilent = document.getElementById('rule-captcha-silent');

  // CAS
  const ruleCasEnabled = document.getElementById('rule-cas-enabled');
  const ruleCasAction = document.getElementById('rule-cas-action');

  // Name Filter
  const ruleNameFilterEnabled = document.getElementById('rule-namefilter-enabled');
  const ruleNameFilterAction = document.getElementById('rule-namefilter-action');

  // Anti Sender-Chat
  const ruleSenderChatEnabled = document.getElementById('rule-senderchat-enabled');
  const ruleSenderChatAction = document.getElementById('rule-senderchat-action');
  const ruleSenderChatBanChannel = document.getElementById('rule-senderchat-banchannel');
  const ruleSenderChatLinked = document.getElementById('rule-senderchat-linked');

  // Language Filter
  const ruleLanguageEnabled = document.getElementById('rule-language-enabled');
  const ruleLanguageCjk = document.getElementById('rule-language-cjk');
  const ruleLanguageArabic = document.getElementById('rule-language-arabic');
  const ruleLanguageCyrillic = document.getElementById('rule-language-cyrillic');
  const ruleLanguageMinChars = document.getElementById('rule-language-minchars');
  const ruleLanguageAction = document.getElementById('rule-language-action');

  // Anti Zalgo
  const ruleZalgoEnabled = document.getElementById('rule-zalgo-enabled');
  const ruleZalgoMax = document.getElementById('rule-zalgo-max');
  const ruleZalgoRtl = document.getElementById('rule-zalgo-rtl');
  const ruleZalgoAction = document.getElementById('rule-zalgo-action');

  // Anti-spam duplicate
  const ruleSpamDuplicate = document.getElementById('rule-spam-duplicate');

  // Anti-link whitelist
  const ruleLinkWhitelist = document.getElementById('rule-link-whitelist');

  // enforceOnAdmins toggles
  const ruleProfanityEnforceAdmins = document.getElementById('rule-profanity-enforce-admins');
  const ruleAdultEmojiEnforceAdmins = document.getElementById('rule-adultemoji-enforce-admins');
  const rulePreviewEnforceAdmins = document.getElementById('rule-preview-enforce-admins');

  const ruleWelcomeEnabled = document.getElementById('rule-welcome-enabled');
  const ruleWelcomeText = document.getElementById('rule-welcome-text');
  const ruleWelcomeDelete = document.getElementById('rule-welcome-delete');
  const ruleSpamEnabled = document.getElementById('rule-spam-enabled');
  const ruleSpamMax = document.getElementById('rule-spam-max');
  const ruleSpamInterval = document.getElementById('rule-spam-interval');
  const ruleSpamAction = document.getElementById('rule-spam-action');
  const ruleLinkEnabled = document.getElementById('rule-link-enabled');
  const ruleLinkStrict = document.getElementById('rule-link-strict');
  const ruleLinkEnforceAdmins = document.getElementById('rule-link-enforce-admins');
  const ruleLinkAction = document.getElementById('rule-link-action');
  const ruleProfanityEnabled = document.getElementById('rule-profanity-enabled');
  const ruleProfanityBlacklist = document.getElementById('rule-profanity-blacklist');
  const ruleProfanityAction = document.getElementById('rule-profanity-action');
  const ruleRaidEnabled = document.getElementById('rule-raid-enabled');
  const ruleRaidLimit = document.getElementById('rule-raid-limit');
  const ruleRaidInterval = document.getElementById('rule-raid-interval');
  const ruleRaidAction = document.getElementById('rule-raid-action');

  // Anti-Forward
  const ruleForwardEnabled = document.getElementById('rule-forward-enabled');
  const ruleForwardChannels = document.getElementById('rule-forward-channels');
  const ruleForwardUsers = document.getElementById('rule-forward-users');
  const ruleForwardHidden = document.getElementById('rule-forward-hidden');
  const ruleForwardAction = document.getElementById('rule-forward-action');

  // Anti-Mention
  const ruleMentionEnabled = document.getElementById('rule-mention-enabled');
  const ruleMentionChannels = document.getElementById('rule-mention-channels');
  const ruleMentionUsers = document.getElementById('rule-mention-users');
  const ruleMentionWhitelist = document.getElementById('rule-mention-whitelist');
  const ruleMentionAction = document.getElementById('rule-mention-action');

  // Anti-Media (NSFW)
  const ruleMediaEnabled = document.getElementById('rule-media-enabled');
  const ruleMediaCaptions = document.getElementById('rule-media-captions');
  const ruleMediaFilenames = document.getElementById('rule-media-filenames');
  const ruleMediaStickerEmoji = document.getElementById('rule-media-sticker-emoji');
  const ruleMediaBlockStickers = document.getElementById('rule-media-block-stickers');
  const ruleMediaBlockGifs = document.getElementById('rule-media-block-gifs');
  const ruleMediaBlockVideoNotes = document.getElementById('rule-media-block-videonotes');
  const ruleMediaBlockPhotos = document.getElementById('rule-media-block-photos');
  const ruleMediaBlockVideos = document.getElementById('rule-media-block-videos');
  const ruleMediaBlockDocuments = document.getElementById('rule-media-block-documents');
  const ruleMediaBlockVoice = document.getElementById('rule-media-block-voice');
  const ruleMediaRequireCaption = document.getElementById('rule-media-require-caption');
  const ruleMediaMinCaption = document.getElementById('rule-media-min-caption');
  const ruleMediaAction = document.getElementById('rule-media-action');

  // Anti-Button
  const ruleButtonEnabled = document.getElementById('rule-button-enabled');
  const ruleButtonInline = document.getElementById('rule-button-inline');
  const ruleButtonViaBot = document.getElementById('rule-button-viabot');
  const ruleButtonText = document.getElementById('rule-button-text');
  const ruleButtonAction = document.getElementById('rule-button-action');

  // Anti-Preview
  const rulePreviewEnabled = document.getElementById('rule-preview-enabled');
  const rulePreviewWeb = document.getElementById('rule-preview-web');
  const rulePreviewAction = document.getElementById('rule-preview-action');

  // "Do these rules apply to your admins?" summary card. Each box mirrors the
  // enforceOnAdmins checkbox that already lives inside the matching rule card,
  // so the existing save payload keeps working — this is just a clear front-end.
  const admLink = document.getElementById('adm-link');
  const admContent = document.getElementById('adm-content');
  const admPremium = document.getElementById('adm-premium');
  const admProfanity = document.getElementById('adm-profanity');
  const admAdultEmoji = document.getElementById('adm-adultemoji');

  // Anti-Premium Emoji & Sticker
  const rulePremiumEnabled = document.getElementById('rule-premium-enabled');
  const rulePremiumEnforceAdmins = document.getElementById('rule-premium-enforce-admins');
  const rulePremiumAll = document.getElementById('rule-premium-all');
  const rulePremiumVideo = document.getElementById('rule-premium-video');
  const rulePremiumAnimated = document.getElementById('rule-premium-animated');
  const rulePremiumEmojiBlocklist = document.getElementById('rule-premium-emoji-blocklist');
  const rulePremiumSetBlocklist = document.getElementById('rule-premium-set-blocklist');
  const rulePremiumAction = document.getElementById('rule-premium-action');

  function parseList(str, re) {
    return (str || '')
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && re.test(s));
  }

  // Anti-Adult-Emoji
  const ruleAdultEmojiEnabled = document.getElementById('rule-adultemoji-enabled');
  const ruleAdultEmojiThreshold = document.getElementById('rule-adultemoji-threshold');
  const ruleAdultEmojiDensity = document.getElementById('rule-adultemoji-density');
  const ruleAdultEmojiSticker = document.getElementById('rule-adultemoji-sticker');
  const ruleAdultEmojiCaptions = document.getElementById('rule-adultemoji-captions');
  const ruleAdultEmojiAction = document.getElementById('rule-adultemoji-action');

  // Database Tbody Selectors
  const warningsTbody = document.getElementById('warnings-tbody');
  const bansTbody = document.getElementById('bans-tbody');
  const historyTbody = document.getElementById('history-tbody');

  // Search / filter controls for the moderation tables
  const warnSearch = document.getElementById('warn-search');
  const warnGroupFilter = document.getElementById('warn-group-filter');
  const warnLevelFilter = document.getElementById('warn-level-filter');
  const warnCountBadge = document.getElementById('warn-count-badge');
  const banSearch = document.getElementById('ban-search');
  const banGroupFilter = document.getElementById('ban-group-filter');
  const banStatusFilter = document.getElementById('ban-status-filter');
  const banCountBadge = document.getElementById('ban-count-badge');
  const historySearch = document.getElementById('history-search');
  const historyTypeFilter = document.getElementById('history-type-filter');
  const historyGroupFilter = document.getElementById('history-group-filter');
  const historyLimit = document.getElementById('history-limit');
  const historyCountBadge = document.getElementById('history-count-badge');
  const logSearch = document.getElementById('log-search');
  const pauseConsoleBtn = document.getElementById('pause-console-btn');
  const pauseConsoleLabel = document.getElementById('pause-console-label');

  // Terminal Selectors
  const terminalConsole = document.getElementById('terminal-body-console');
  const logFilterLevel = document.getElementById('log-filter-level');
  const clearConsoleBtn = document.getElementById('clear-console-btn');

  // System Settings Selectors
  const activeTokenInput = document.getElementById('settings-bot-token');   // legacy — may be null after multi-bot UI swap
  const revealTokenBtn = document.getElementById('reveal-token-btn');       // legacy — may be null
  const btnRestartBot = document.getElementById('btn-restart-bot');
  const btnStopBot = document.getElementById('btn-stop-bot');
  const btnChangeToken = document.getElementById('btn-change-token');       // legacy — may be null
  const rulesResetBtn = document.getElementById('rules-reset-btn');

  // Multi-bot manager selectors
  const botsTbody = document.getElementById('bots-tbody');
  const addBotForm = document.getElementById('add-bot-form');
  const newBotTokenInput = document.getElementById('new-bot-token');
  const newBotNameInput = document.getElementById('new-bot-name');

  // Toast Functionality
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s ease-out reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function hideAllModals() {
    createAdminModal.classList.add('hidden');
    loginModal.classList.add('hidden');
    setupWizard.classList.add('hidden');
    appContainer.classList.add('hidden');
  }

  function showAuthScreen(which) {
    hideAllModals();
    if (which === 'create') createAdminModal.classList.remove('hidden');
    else if (which === 'login') loginModal.classList.remove('hidden');
    else if (which === 'setup') setupWizard.classList.remove('hidden');
    else if (which === 'app') appContainer.classList.remove('hidden');
  }

  // Boot — auth first, then bot status
  async function bootstrap() {
    try {
      const auth = await fetch('/api/auth-status', { credentials: 'same-origin' }).then(r => r.json());
      if (!auth.adminExists) {
        showAuthScreen('create');
        return;
      }
      if (!auth.loggedIn) {
        showAuthScreen('login');
        return;
      }
      await checkBotStatus();
    } catch (err) {
      showToast('Cannot connect to backend server.', 'error');
    }
  }

  // Check Status (assumes authenticated)
  async function checkBotStatus() {
    try {
      const response = await api('/api/status');
      const status = await response.json();

      if (status.hasToken) {
        showAuthScreen('app');
        chkToken.className = 'checked';
        chkToken.innerHTML = '<i class="fa-solid fa-check-circle"></i> Configure Bot Token';
        initSocket();
        loadAllSettings();
        loadModData();
        loadLastScan();
        loadBots();
        loadChats();
      } else {
        showAuthScreen('setup');
        chkToken.className = '';
        chkToken.innerHTML = '<i class="fa-solid fa-circle-notch"></i> Configure Bot Token';
      }

      updateBotStatusUI(status.online);
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Cannot connect to backend server.', 'error');
    }
  }

  function updateBotStatusUI(online) {
    if (online) {
      statusDot.className = 'status-indicator-dot online';
      statusText.textContent = 'Running (Online)';
      quickActionStatusBtn.className = 'btn btn-outline';
      quickActionText.textContent = 'Stop Bot';
      quickActionStatusBtn.querySelector('i').className = 'fa-solid fa-circle-stop';
    } else {
      statusDot.className = 'status-indicator-dot offline';
      statusText.textContent = 'Stopped (Offline)';
      quickActionStatusBtn.className = 'btn btn-primary';
      quickActionText.textContent = 'Start Bot';
      quickActionStatusBtn.querySelector('i').className = 'fa-solid fa-circle-play';
    }
  }

  // Socket Connections
  function initSocket() {
    if (socket) return;
    
    socket = io();

    socket.on('connect', () => {
      showToast('Real-time sync connected.', 'success');
    });

    socket.on('disconnect', () => {
      statusDot.className = 'status-indicator-dot';
      statusText.textContent = 'Disconnected';
      showToast('Real-time sync lost.', 'error');
    });

    // Real-time log stream
    socket.on('log', (logEntry) => {
      appendLogLine(logEntry);
      allLogs.push(logEntry);
      if (allLogs.length > 1000) allLogs.shift();
      updateHistoryTable();

      // Broadcast toast notifications for moderation events
      const level = logEntry.level;
      const msg = logEntry.message;
      const modLevels = new Set([
        'BAN', 'KICK', 'MUTE', 'UNMUTE', 'WARNING',
        'SPAM', 'FLOOD', 'LINK', 'FORWARD', 'MENTION', 'MEDIA', 'BUTTON', 'PREVIEW',
        'PROFANITY', 'ZALGO', 'NAME', 'SENDERCHAT', 'PREMIUM', 'RAID', 'CAS', 'LOCK', 'UNLOCK', 'REPORT'
      ]);
      if (modLevels.has(level)) {
        let type = 'info';
        if (['BAN', 'KICK', 'RAID', 'CAS', 'REPORT'].includes(level)) {
          type = 'error';
        } else if (['MUTE', 'WARNING', 'LOCK'].includes(level)) {
          type = 'error';
        } else if (['UNMUTE', 'UNLOCK'].includes(level)) {
          type = 'success';
        }
        showToast(`[${level}] ${msg}`, type);
      }
    });

    // Bulk historical logs
    socket.on('init_logs', (logs) => {
      terminalConsole.innerHTML = '';
      allLogs.length = 0;
      logs.forEach(log => {
        appendLogLine(log);
        allLogs.push(log);
      });
      updateHistoryTable();
    });

    // Populate the log-level filter dropdown from the server's known levels
    fetch('/api/log-levels', { credentials: 'same-origin' }).then(r => r.json()).then(levels => {
      const seen = new Set([...logFilterLevel.options].map(o => o.value));
      levels.forEach(lvl => {
        if (seen.has(lvl)) return;
        const opt = document.createElement('option');
        opt.value = lvl;
        opt.textContent = lvl.charAt(0) + lvl.slice(1).toLowerCase();
        logFilterLevel.appendChild(opt);
      });
    }).catch(() => {});

    // Real-time counter metrics
    socket.on('stats_update', (stats) => {
      statMessages.textContent = stats.messagesProcessed;
      statSpam.textContent = stats.spamBlocked;
      statLinks.textContent = stats.linksDeleted;
      statWarns.textContent = stats.warningsIssued;
      statBans.textContent = stats.usersBanned;
      statMutes.textContent = stats.usersMuted;
      statProfanity.textContent = stats.profanityDeleted;

      // Update Group Checklists
      const chkGroup = document.getElementById('chk-group');
      const chkAdmin = document.getElementById('chk-admin');
      if (stats.messagesProcessed > 0) {
        chkGroup.className = 'checked';
        chkGroup.innerHTML = '<i class="fa-solid fa-check-circle"></i> Add Bot to Group';
        chkAdmin.className = 'checked';
        chkAdmin.innerHTML = '<i class="fa-solid fa-check-circle"></i> Promote Bot to Admin';
      }
    });

    // Real-time status toggle sync
    socket.on('status_change', (status) => {
      updateBotStatusUI(status.online);
      if (status.online) {
        showToast('Bot engine started successfully.', 'success');
      } else {
        showToast('Bot engine stopped.', 'info');
      }
    });

    // Data tables refresh request
    socket.on('data_update', () => {
      loadModData();
      loadBots();
      loadChats();
    });

    // Live routine-scan progress (button label + summary panel update)
    socket.on('scan_progress', (p) => {
      if (!p) return;
      if (btnRoutineScanLabel) {
        if (p.phase === 'start') {
          btnRoutineScanLabel.textContent = `Scanning 0 / ${p.total}…`;
        } else if (p.phase === 'progress') {
          btnRoutineScanLabel.textContent = `Scanning ${p.scanned} / ${p.total} (${p.deleted} hit${p.deleted === 1 ? '' : 's'})`;
        } else if (p.phase === 'done') {
          btnRoutineScanLabel.textContent = 'Scan now';
          if (btnRoutineScan) btnRoutineScan.disabled = false;
        }
      }
      if (p.phase === 'done' && lastScanSummary) renderScanSummary(p);
    });
  }

  // Auth forms
  createAdminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (caPassword.value !== caPasswordConfirm.value) {
      return showToast('Passwords do not match.', 'error');
    }
    try {
      const res = await fetch('/api/create-admin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: caUsername.value.trim(), password: caPassword.value })
      }).then(r => r.json());
      if (res.success) {
        showToast('Admin account created. Signed in.', 'success');
        caPassword.value = ''; caPasswordConfirm.value = '';
        checkBotStatus();
      } else {
        showToast(res.error || 'Failed to create admin.', 'error');
      }
    } catch (err) {
      showToast('Cannot reach server.', 'error');
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername.value.trim(), password: loginPassword.value })
      }).then(r => r.json().then(j => ({ status: r.status, body: j })));
      if (res.body.success) {
        showToast('Signed in.', 'success');
        loginPassword.value = '';
        checkBotStatus();
      } else if (res.status === 429) {
        showToast(`Too many attempts. Try again in ${res.body.retry_after || 60}s.`, 'error');
      } else {
        showToast('Invalid credentials.', 'error');
      }
    } catch (err) {
      showToast('Cannot reach server.', 'error');
    }
  });

  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    if (socket) { socket.disconnect(); socket = null; }
    showAuthScreen('login');
    showToast('Signed out.', 'info');
  });

  if (changePasswordForm) changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (cpNew.value !== cpNewConfirm.value) {
      return showToast('New passwords do not match.', 'error');
    }
    try {
      const r = await api('/api/change-password', {
        method: 'POST',
        body: { currentPassword: cpCurrent.value, newPassword: cpNew.value }
      });
      const j = await r.json();
      if (j.success) {
        showToast('Password rotated.', 'success');
        cpCurrent.value = ''; cpNew.value = ''; cpNewConfirm.value = '';
      } else {
        showToast(j.error || 'Failed to change password.', 'error');
      }
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Cannot reach server.', 'error');
    }
  });

  // Handle Token Setup Form
  tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = botTokenInput.value.trim();
    if (!token) return;

    try {
      showToast('Initializing Bot. Please wait...', 'info');
      const response = await api('/api/setup', { method: 'POST', body: { token } });
      const res = await response.json();
      if (res.success) {
        showToast('Bot setup completed successfully!', 'success');
        showAuthScreen('app');
        chkToken.className = 'checked';
        chkToken.innerHTML = '<i class="fa-solid fa-check-circle"></i> Configure Bot Token';
        initSocket();
        loadAllSettings();
        loadModData();
      } else {
        showToast(res.error || 'Failed to setup bot.', 'error');
      }
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('API network connection error during setup.', 'error');
    }
  });

  // Client Side Tab Router
  const menuItems = document.querySelectorAll('.menu-item');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const currentTabTitle = document.getElementById('current-tab-title');
  const currentTabDesc = document.getElementById('current-tab-desc');

  const tabMeta = {
    'tab-overview': { title: 'Overview Dashboard', desc: 'Monitor your Telegram community health and stats.' },
    'tab-rules': { title: 'Moderation Rules', desc: 'Configure automatic security filters and response actions.' },
    'tab-terminal': { title: 'Live Console Terminal', desc: 'Real-time output stream directly from the OctoGod moderator service.' },
    'tab-groups': { title: 'Connected Groups', desc: 'Every group the bot protects, with per-group rule overrides.' },
    'tab-moderation': { title: 'Moderation User Database', desc: 'Verify warning records and manage restricted accounts.' },
    'tab-settings': { title: 'System Credentials', desc: 'View API logs, configure bot token, and manage system status.' }
  };

  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTab = item.getAttribute('data-tab');
      
      menuItems.forEach(i => i.classList.remove('active'));
      tabPanels.forEach(panel => panel.classList.remove('active'));
      
      item.classList.add('active');
      document.getElementById(targetTab).classList.add('active');

      const meta = tabMeta[targetTab];
      if (meta) {
        currentTabTitle.textContent = meta.title;
        currentTabDesc.textContent = meta.desc;
      }
    });
  });

  // Toggle Theme (Dark / Light)
  // Light is the base palette in :root; dark is the `dark-theme` class on <body>.
  // With no saved choice we follow the operating system.
  const themeToggle = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('theme');
  let isDark = saved
    ? saved === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;

  function applyTheme() {
    document.body.classList.toggle('dark-theme', isDark);
    const icon = themeToggle && themeToggle.querySelector('i');
    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (themeToggle) {
      themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    }
  }
  applyTheme();

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      isDark = !isDark;
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      applyTheme();
    });
  }

  // Load configuration from API
  async function loadAllSettings() {
    try {
      const response = await api('/api/settings');
      currentSettings = await response.json();
      populateRulesForm(currentSettings);
      updateQuickSwitches(currentSettings);
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Error retrieving rules database.', 'error');
    }
  }

  // Populate configuration forms
  // Keep the "applies to admins?" summary card and the per-rule checkboxes in
  // lockstep, in both directions, so the two views can never disagree.
  const ADMIN_MIRRORS = [
    () => [admLink, [ruleLinkEnforceAdmins, rulePreviewEnforceAdmins]],
    () => [admContent, [ruleContentEnforceAdmins]],
    () => [admPremium, [rulePremiumEnforceAdmins]],
    () => [admProfanity, [ruleProfanityEnforceAdmins]],
    () => [admAdultEmoji, [ruleAdultEmojiEnforceAdmins]]
  ];
  function syncAdminCardFromRules() {
    ADMIN_MIRRORS.forEach(get => {
      const [summary, targets] = get();
      if (!summary) return;
      const first = targets.find(Boolean);
      if (first) summary.checked = first.checked;
    });
  }
  ADMIN_MIRRORS.forEach(get => {
    const [summary, targets] = get();
    if (!summary) return;
    summary.addEventListener('change', () => {
      targets.forEach(t => { if (t) t.checked = summary.checked; });
    });
    targets.forEach(t => {
      if (t) t.addEventListener('change', syncAdminCardFromRules);
    });
  });

  // Master switch. While it is on, the per-rule boxes have no effect, so grey
  // them out rather than leaving controls on screen that quietly do nothing.
  const admExemptAll = document.getElementById('adm-exempt-all');
  const admPerRule = document.getElementById('adm-per-rule');
  function syncExemptAll() {
    const on = !!(admExemptAll && admExemptAll.checked);
    if (admPerRule) admPerRule.classList.toggle('is-disabled', on);
    ADMIN_MIRRORS.forEach(get => {
      const [summary, targets] = get();
      if (summary) summary.disabled = on;
      targets.forEach(t => { if (t) t.disabled = on; });
    });
  }
  if (admExemptAll) admExemptAll.addEventListener('change', syncExemptAll);

  function populateRulesForm(set) {
    // Silent Mode
    if (set.silentMode) {
      ruleSilentEnabled.checked = !!set.silentMode.enabled;
      ruleSilentWelcome.checked = !!set.silentMode.suppressWelcome;
      ruleSilentAnnouncements.checked = !!set.silentMode.suppressAnnouncements;
      ruleSilentActionNotices.checked = !!set.silentMode.suppressActionNotices;
      ruleSilentCaptcha.checked = !!set.silentMode.suppressCaptcha;
      toggleRuleCardBody('silent', set.silentMode.enabled);
    }

    // Welcome
    ruleWelcomeEnabled.checked = set.welcome.enabled;
    ruleWelcomeText.value = set.welcome.text;
    ruleWelcomeDelete.value = set.welcome.deleteAfterSeconds;
    toggleRuleCardBody('welcome', set.welcome.enabled);

    // Anti-Spam
    ruleSpamEnabled.checked = set.antiSpam.enabled;
    ruleSpamMax.value = set.antiSpam.maxMessages;
    ruleSpamInterval.value = set.antiSpam.intervalMs;
    if (ruleSpamDuplicate) ruleSpamDuplicate.value = set.antiSpam.duplicateLimit || 3;
    ruleSpamAction.value = set.antiSpam.action;
    toggleRuleCardBody('spam', set.antiSpam.enabled);

    // Anti-Link
    ruleLinkEnabled.checked = set.antiLink.enabled;

    ruleLinkStrict.checked = !!set.antiLink.strictMode;
    ruleLinkEnforceAdmins.checked = !!set.antiLink.enforceOnAdmins;
    if (ruleLinkWhitelist) ruleLinkWhitelist.value = (set.antiLink.whitelistDomains || []).join('\n');
    ruleLinkAction.value = set.antiLink.action;
    toggleRuleCardBody('link', set.antiLink.enabled);

    // Profanity
    ruleProfanityEnabled.checked = set.profanity.enabled;
    ruleProfanityBlacklist.value = set.profanity.blacklist.join(', ');
    if (ruleProfanityEnforceAdmins) ruleProfanityEnforceAdmins.checked = !!set.profanity.enforceOnAdmins;
    ruleProfanityAction.value = set.profanity.action;
    toggleRuleCardBody('profanity', set.profanity.enabled);

    // enforceOnAdmins on adult-emoji and preview
    if (ruleAdultEmojiEnforceAdmins && set.antiAdultEmoji) {
      ruleAdultEmojiEnforceAdmins.checked = !!set.antiAdultEmoji.enforceOnAdmins;
    }
    if (rulePreviewEnforceAdmins && set.antiPreview) {
      rulePreviewEnforceAdmins.checked = !!set.antiPreview.enforceOnAdmins;
    }

    // New-user restrictions
    if (set.newUserRestrictions) {
      ruleNewUserEnabled.checked = !!set.newUserRestrictions.enabled;
      ruleNewUserCount.value = set.newUserRestrictions.messageCount || 3;
      ruleNewUserDuration.value = set.newUserRestrictions.durationMinutes || 1440;
      ruleNewUserLinks.checked = !!set.newUserRestrictions.blockLinks;
      ruleNewUserMedia.checked = !!set.newUserRestrictions.blockMedia;
      ruleNewUserForwards.checked = !!set.newUserRestrictions.blockForwards;
      ruleNewUserAction.value = set.newUserRestrictions.action || 'delete_and_warn';
      toggleRuleCardBody('newuser', set.newUserRestrictions.enabled);
    }

    // Content-type filters
    if (set.contentTypes) {
      ruleContentEnabled.checked = !!set.contentTypes.enabled;
      ruleContentPaid.checked = !!set.contentTypes.blockPaidMedia;
      ruleContentSpoiler.checked = !!set.contentTypes.blockSpoilerMedia;
      ruleContentScanPolls.checked = !!set.contentTypes.scanPolls;
      ruleContentBlockPolls.checked = !!set.contentTypes.blockPolls;
      ruleContentGames.checked = !!set.contentTypes.blockGames;
      ruleContentContacts.checked = !!set.contentTypes.blockContacts;
      ruleContentLocations.checked = !!set.contentTypes.blockLocations;
      ruleContentRepeated.checked = !!set.contentTypes.blockRepeatedChars;
      ruleContentMaxLen.value = set.contentTypes.maxMessageLength || 0;
      ruleContentEnforceAdmins.checked = !!set.contentTypes.enforceOnAdmins;
      ruleContentAction.value = set.contentTypes.action || 'delete_and_warn';
      toggleRuleCardBody('content', set.contentTypes.enabled);
    }

    // Routine scan
    if (set.routineScan) {
      ruleScanEnabled.checked = !!set.routineScan.enabled;
      ruleScanBoot.checked = !!set.routineScan.scanOnBoot;
      ruleScanDefault.value = set.routineScan.defaultDurationHours || 24;
      ruleScanMax.value = set.routineScan.maxDurationHours || 720;
      ruleScanCacheSize.value = set.routineScan.cacheSizeLimit || 10000;
      ruleScanCacheTtl.value = set.routineScan.cacheTtlDays || 7;
      ruleScanDelay.value = set.routineScan.scanIntervalDelayMs || 35;
      if (ruleScanAuto) ruleScanAuto.value = set.routineScan.autoIntervalHours || 0;
      toggleRuleCardBody('scan', set.routineScan.enabled);
      // Default the overview duration picker to the configured default
      if (scanDurationSelect && set.routineScan.defaultDurationHours) {
        const v = String(set.routineScan.defaultDurationHours);
        const opt = [...scanDurationSelect.options].find(o => o.value === v);
        if (opt) scanDurationSelect.value = v;
      }
    }

    // Captcha
    if (set.captcha) {
      ruleCaptchaEnabled.checked = !!set.captcha.enabled;
      ruleCaptchaTimeout.value = set.captcha.timeoutSeconds || 90;
      ruleCaptchaAttempts.value = set.captcha.maxAttempts || 2;
      ruleCaptchaKick.checked = !!set.captcha.kickOnFail;
      ruleCaptchaDm.checked = set.captcha.tryDmFirst !== false;
      ruleCaptchaSilent.checked = set.captcha.disableNotification !== false;
      toggleRuleCardBody('captcha', set.captcha.enabled);
    }
    // CAS
    if (set.cas) {
      ruleCasEnabled.checked = !!set.cas.enabled;
      ruleCasAction.value = set.cas.action || 'ban';
      toggleRuleCardBody('cas', set.cas.enabled);
    }
    // Name Filter
    if (set.nameFilter) {
      ruleNameFilterEnabled.checked = !!set.nameFilter.enabled;
      ruleNameFilterAction.value = set.nameFilter.action || 'ban';
      toggleRuleCardBody('namefilter', set.nameFilter.enabled);
    }
    // Anti Sender-Chat
    if (set.antiSenderChat) {
      ruleSenderChatEnabled.checked = !!set.antiSenderChat.enabled;
      ruleSenderChatAction.value = set.antiSenderChat.action || 'delete';
      if (ruleSenderChatBanChannel) ruleSenderChatBanChannel.checked = set.antiSenderChat.banChannel !== false;
      if (ruleSenderChatLinked) ruleSenderChatLinked.checked = set.antiSenderChat.allowLinkedChannel !== false;
      toggleRuleCardBody('senderchat', set.antiSenderChat.enabled);
    }

    // Language Filter
    if (set.languageFilter) {
      ruleLanguageEnabled.checked = !!set.languageFilter.enabled;
      ruleLanguageCjk.checked = !!set.languageFilter.blockCJK;
      ruleLanguageArabic.checked = !!set.languageFilter.blockArabic;
      ruleLanguageCyrillic.checked = !!set.languageFilter.blockCyrillic;
      ruleLanguageMinChars.value = set.languageFilter.minChars || 2;
      ruleLanguageAction.value = set.languageFilter.action || 'delete_and_warn';
      toggleRuleCardBody('language', set.languageFilter.enabled);
    }
    // Anti Zalgo
    if (set.antiZalgo) {
      ruleZalgoEnabled.checked = !!set.antiZalgo.enabled;
      ruleZalgoMax.value = set.antiZalgo.maxCombiningChars || 30;
      ruleZalgoRtl.checked = !!set.antiZalgo.blockRtlOverride;
      ruleZalgoAction.value = set.antiZalgo.action || 'delete_and_warn';
      toggleRuleCardBody('zalgo', set.antiZalgo.enabled);
    }

    // Anti-Raid
    ruleRaidEnabled.checked = set.antiRaid.enabled;
    ruleRaidLimit.value = set.antiRaid.joinLimit;
    ruleRaidInterval.value = set.antiRaid.intervalSeconds;
    ruleRaidAction.value = set.antiRaid.action;
    toggleRuleCardBody('raid', set.antiRaid.enabled);

    // Anti-Forward
    if (set.antiForward) {
      ruleForwardEnabled.checked = !!set.antiForward.enabled;
      ruleForwardChannels.checked = !!set.antiForward.blockChannels;
      ruleForwardUsers.checked = !!set.antiForward.blockUsers;
      ruleForwardHidden.checked = !!set.antiForward.blockHidden;
      ruleForwardAction.value = set.antiForward.action || 'delete_and_warn';
      toggleRuleCardBody('forward', set.antiForward.enabled);
    }

    // Anti-Mention
    if (set.antiMention) {
      ruleMentionEnabled.checked = !!set.antiMention.enabled;
      ruleMentionChannels.checked = !!set.antiMention.blockChannelMentions;
      ruleMentionUsers.checked = !!set.antiMention.blockUserMentions;
      ruleMentionWhitelist.value = (set.antiMention.whitelistUsernames || []).join(', ');
      ruleMentionAction.value = set.antiMention.action || 'delete_and_warn';
      toggleRuleCardBody('mention', set.antiMention.enabled);
    }

    // Anti-Media (NSFW)
    if (set.antiMedia) {
      ruleMediaEnabled.checked = !!set.antiMedia.enabled;
      ruleMediaCaptions.checked = !!set.antiMedia.scanCaptions;
      ruleMediaFilenames.checked = !!set.antiMedia.scanFileNames;
      ruleMediaStickerEmoji.checked = !!set.antiMedia.scanStickerEmoji;
      ruleMediaBlockStickers.checked = !!set.antiMedia.blockStickers;
      ruleMediaBlockGifs.checked = !!set.antiMedia.blockAnimations;
      ruleMediaBlockVideoNotes.checked = !!set.antiMedia.blockVideoNotes;
      ruleMediaBlockPhotos.checked = !!set.antiMedia.blockPhotos;
      ruleMediaBlockVideos.checked = !!set.antiMedia.blockVideos;
      ruleMediaBlockDocuments.checked = !!set.antiMedia.blockDocuments;
      ruleMediaBlockVoice.checked = !!set.antiMedia.blockVoice;
      ruleMediaRequireCaption.checked = !!set.antiMedia.requireCaptionForPhotos;
      ruleMediaMinCaption.value = set.antiMedia.minPhotoCaptionLen || 0;
      ruleMediaAction.value = set.antiMedia.action || 'delete_and_warn';
      toggleRuleCardBody('media', set.antiMedia.enabled);
    }

    // Anti-Button
    if (set.antiButton) {
      ruleButtonEnabled.checked = !!set.antiButton.enabled;
      ruleButtonInline.checked = !!set.antiButton.blockInlineKeyboards;
      ruleButtonViaBot.checked = !!set.antiButton.blockViaBot;
      ruleButtonText.checked = !!set.antiButton.blockButtonText;
      ruleButtonAction.value = set.antiButton.action || 'delete_and_warn';
      toggleRuleCardBody('button', set.antiButton.enabled);
    }

    // Anti-Preview
    if (set.antiPreview) {
      rulePreviewEnabled.checked = !!set.antiPreview.enabled;
      rulePreviewWeb.checked = !!set.antiPreview.blockWebPreviews;
      rulePreviewAction.value = set.antiPreview.action || 'delete_and_warn';
      toggleRuleCardBody('preview', set.antiPreview.enabled);
    }

    // Anti-Premium Emoji & Sticker
    if (set.antiPremiumEmoji) {
      rulePremiumEnabled.checked = !!set.antiPremiumEmoji.enabled;
      rulePremiumEnforceAdmins.checked = !!set.antiPremiumEmoji.enforceOnAdmins;
      rulePremiumAll.checked = !!set.antiPremiumEmoji.blockAllCustomEmoji;
      rulePremiumVideo.checked = !!set.antiPremiumEmoji.blockVideoStickers;
      rulePremiumAnimated.checked = !!set.antiPremiumEmoji.blockAnimatedStickers;
      rulePremiumEmojiBlocklist.value = (set.antiPremiumEmoji.customEmojiBlocklist || []).join('\n');
      rulePremiumSetBlocklist.value = (set.antiPremiumEmoji.stickerSetBlocklist || []).join('\n');
      rulePremiumAction.value = set.antiPremiumEmoji.action || 'delete_and_warn';
      toggleRuleCardBody('premium', set.antiPremiumEmoji.enabled);
    }

    // Anti-Adult-Emoji
    if (set.antiAdultEmoji) {
      ruleAdultEmojiEnabled.checked = !!set.antiAdultEmoji.enabled;
      ruleAdultEmojiThreshold.value = set.antiAdultEmoji.threshold || 2;
      ruleAdultEmojiDensity.value = set.antiAdultEmoji.densityRatio || 0.4;
      ruleAdultEmojiSticker.checked = !!set.antiAdultEmoji.blockOnSticker;
      ruleAdultEmojiCaptions.checked = !!set.antiAdultEmoji.scanCaptions;
      ruleAdultEmojiAction.value = set.antiAdultEmoji.action || 'delete_and_warn';
      toggleRuleCardBody('adultemoji', set.antiAdultEmoji.enabled);
    }

    syncAdminCardFromRules();
    if (admExemptAll) {
      // Absent means "on" — the default is that admins are never moderated.
      admExemptAll.checked = !(set.enforcement && set.enforcement.exemptAdmins === false);
      syncExemptAll();
    }
  }

  // Update quick controls switch positions
  function updateQuickSwitches(set) {
    quickWelcomeToggle.checked = set.welcome.enabled;
    quickWelcomeLabel.textContent = set.welcome.enabled ? 'Active' : 'Disabled';

    quickSpamToggle.checked = set.antiSpam.enabled;
    quickSpamLabel.textContent = set.antiSpam.enabled ? 'Active' : 'Disabled';

    quickLinkToggle.checked = set.antiLink.enabled;
    quickLinkLabel.textContent = set.antiLink.enabled ? 'Active' : 'Disabled';

    quickRaidToggle.checked = set.antiRaid.enabled;
    quickRaidLabel.textContent = set.antiRaid.enabled ? 'Active' : 'Disabled';
  }

  // Quick action card toggling behavior
  function toggleRuleCardBody(key, enabled) {
    const body = document.getElementById(`body-${key}`);
    if (body) {
      if (enabled) {
        body.classList.remove('disabled');
      } else {
        body.classList.add('disabled');
      }
    }
  }

  // Hook rules change selectors
  [
    { check: ruleWelcomeEnabled, key: 'welcome' },
    { check: ruleSpamEnabled, key: 'spam' },
    { check: ruleLinkEnabled, key: 'link' },
    { check: ruleProfanityEnabled, key: 'profanity' },
    { check: ruleRaidEnabled, key: 'raid' },
    { check: ruleForwardEnabled, key: 'forward' },
    { check: ruleMentionEnabled, key: 'mention' },
    { check: ruleMediaEnabled, key: 'media' },
    { check: ruleButtonEnabled, key: 'button' },
    { check: rulePreviewEnabled, key: 'preview' },
    { check: ruleAdultEmojiEnabled, key: 'adultemoji' },
    { check: rulePremiumEnabled, key: 'premium' },
    { check: ruleSilentEnabled, key: 'silent' },
    { check: ruleCaptchaEnabled, key: 'captcha' },
    { check: ruleCasEnabled, key: 'cas' },
    { check: ruleNameFilterEnabled, key: 'namefilter' },
    { check: ruleSenderChatEnabled, key: 'senderchat' },
    { check: ruleLanguageEnabled, key: 'language' },
    { check: ruleZalgoEnabled, key: 'zalgo' },
    { check: ruleScanEnabled, key: 'scan' },
    { check: ruleNewUserEnabled, key: 'newuser' },
    { check: ruleContentEnabled, key: 'content' }
  ].forEach(item => {
    if (!item.check) return;
    item.check.addEventListener('change', () => {
      toggleRuleCardBody(item.key, item.check.checked);
    });
  });

  // Handle saving configurations
  rulesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Parse keywords
    const blacklistWords = ruleProfanityBlacklist.value
      .split(',')
      .map(w => w.trim())
      .filter(w => w.length > 0);

    const payload = {
      silentMode: {
        enabled: ruleSilentEnabled.checked,
        suppressWelcome: ruleSilentWelcome.checked,
        suppressAnnouncements: ruleSilentAnnouncements.checked,
        suppressActionNotices: ruleSilentActionNotices.checked,
        suppressCaptcha: ruleSilentCaptcha.checked
      },
      welcome: {
        enabled: ruleWelcomeEnabled.checked,
        text: ruleWelcomeText.value,
        deleteAfterSeconds: parseInt(ruleWelcomeDelete.value, 10) || 0
      },
      antiSpam: {
        enabled: ruleSpamEnabled.checked,
        maxMessages: parseInt(ruleSpamMax.value, 10) || 5,
        intervalMs: parseInt(ruleSpamInterval.value, 10) || 3000,
        duplicateLimit: parseInt(ruleSpamDuplicate && ruleSpamDuplicate.value, 10) || 3,
        action: ruleSpamAction.value
      },
      antiLink: {
        enabled: ruleLinkEnabled.checked,

        strictMode: ruleLinkStrict.checked,
        enforceOnAdmins: ruleLinkEnforceAdmins.checked,
        whitelistDomains: ruleLinkWhitelist
          ? ruleLinkWhitelist.value.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
          : [],
        action: ruleLinkAction.value
      },
      profanity: {
        enabled: ruleProfanityEnabled.checked,
        blacklist: blacklistWords,
        enforceOnAdmins: ruleProfanityEnforceAdmins ? ruleProfanityEnforceAdmins.checked : true,
        action: ruleProfanityAction.value
      },
      captcha: {
        enabled: ruleCaptchaEnabled.checked,
        timeoutSeconds: parseInt(ruleCaptchaTimeout.value, 10) || 90,
        maxAttempts: parseInt(ruleCaptchaAttempts.value, 10) || 2,
        kickOnFail: ruleCaptchaKick.checked,
        tryDmFirst: ruleCaptchaDm.checked,
        disableNotification: ruleCaptchaSilent.checked
      },
      cas: {
        enabled: ruleCasEnabled.checked,
        action: ruleCasAction.value
      },
      nameFilter: {
        enabled: ruleNameFilterEnabled.checked,
        action: ruleNameFilterAction.value
      },
      antiSenderChat: {
        enabled: ruleSenderChatEnabled.checked,
        banChannel: ruleSenderChatBanChannel ? ruleSenderChatBanChannel.checked : true,
        allowLinkedChannel: ruleSenderChatLinked ? ruleSenderChatLinked.checked : true,
        action: ruleSenderChatAction.value
      },
      languageFilter: {
        enabled: ruleLanguageEnabled.checked,
        blockCJK: ruleLanguageCjk.checked,
        blockArabic: ruleLanguageArabic.checked,
        blockCyrillic: ruleLanguageCyrillic.checked,
        minChars: parseInt(ruleLanguageMinChars.value, 10) || 2,
        action: ruleLanguageAction.value
      },
      antiZalgo: {
        enabled: ruleZalgoEnabled.checked,
        maxCombiningChars: parseInt(ruleZalgoMax.value, 10) || 30,
        blockRtlOverride: ruleZalgoRtl.checked,
        action: ruleZalgoAction.value
      },
      routineScan: {
        enabled: ruleScanEnabled.checked,
        scanOnBoot: ruleScanBoot.checked,
        defaultDurationHours: parseInt(ruleScanDefault.value, 10) || 24,
        maxDurationHours: parseInt(ruleScanMax.value, 10) || 720,
        cacheSizeLimit: parseInt(ruleScanCacheSize.value, 10) || 10000,
        cacheTtlDays: parseInt(ruleScanCacheTtl.value, 10) || 7,
        scanIntervalDelayMs: parseInt(ruleScanDelay.value, 10) || 35,
        autoIntervalHours: parseInt(ruleScanAuto && ruleScanAuto.value, 10) || 0
      },
      newUserRestrictions: {
        enabled: ruleNewUserEnabled.checked,
        messageCount: parseInt(ruleNewUserCount.value, 10) || 3,
        durationMinutes: parseInt(ruleNewUserDuration.value, 10) || 1440,
        blockLinks: ruleNewUserLinks.checked,
        blockMedia: ruleNewUserMedia.checked,
        blockForwards: ruleNewUserForwards.checked,
        action: ruleNewUserAction.value
      },
      contentTypes: {
        enabled: ruleContentEnabled.checked,
        enforceOnAdmins: ruleContentEnforceAdmins.checked,
        blockPaidMedia: ruleContentPaid.checked,
        blockSpoilerMedia: ruleContentSpoiler.checked,
        scanPolls: ruleContentScanPolls.checked,
        blockPolls: ruleContentBlockPolls.checked,
        blockGames: ruleContentGames.checked,
        blockContacts: ruleContentContacts.checked,
        blockLocations: ruleContentLocations.checked,
        blockRepeatedChars: ruleContentRepeated.checked,
        maxMessageLength: parseInt(ruleContentMaxLen.value, 10) || 0,
        action: ruleContentAction.value
      },
      antiRaid: {
        enabled: ruleRaidEnabled.checked,
        joinLimit: parseInt(ruleRaidLimit.value, 10) || 10,
        intervalSeconds: parseInt(ruleRaidInterval.value, 10) || 10,
        action: ruleRaidAction.value
      },
      antiForward: {
        enabled: ruleForwardEnabled.checked,
        blockChannels: ruleForwardChannels.checked,
        blockUsers: ruleForwardUsers.checked,
        blockHidden: ruleForwardHidden.checked,
        action: ruleForwardAction.value
      },
      antiMention: {
        enabled: ruleMentionEnabled.checked,
        blockChannelMentions: ruleMentionChannels.checked,
        blockUserMentions: ruleMentionUsers.checked,
        whitelistUsernames: ruleMentionWhitelist.value
          .split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0),
        action: ruleMentionAction.value
      },
      antiMedia: {
        enabled: ruleMediaEnabled.checked,
        scanCaptions: ruleMediaCaptions.checked,
        scanFileNames: ruleMediaFilenames.checked,
        scanStickerEmoji: ruleMediaStickerEmoji.checked,
        blockStickers: ruleMediaBlockStickers.checked,
        blockAnimations: ruleMediaBlockGifs.checked,
        blockVideoNotes: ruleMediaBlockVideoNotes.checked,
        blockPhotos: ruleMediaBlockPhotos.checked,
        blockVideos: ruleMediaBlockVideos.checked,
        blockDocuments: ruleMediaBlockDocuments.checked,
        blockVoice: ruleMediaBlockVoice.checked,
        requireCaptionForPhotos: ruleMediaRequireCaption.checked,
        minPhotoCaptionLen: parseInt(ruleMediaMinCaption.value, 10) || 0,
        action: ruleMediaAction.value
      },
      antiButton: {
        enabled: ruleButtonEnabled.checked,
        blockInlineKeyboards: ruleButtonInline.checked,
        blockViaBot: ruleButtonViaBot.checked,
        blockButtonText: ruleButtonText.checked,
        action: ruleButtonAction.value
      },
      antiPreview: {
        enabled: rulePreviewEnabled.checked,
        blockWebPreviews: rulePreviewWeb.checked,
        enforceOnAdmins: rulePreviewEnforceAdmins ? rulePreviewEnforceAdmins.checked : true,
        action: rulePreviewAction.value
      },
      antiAdultEmoji: {
        enabled: ruleAdultEmojiEnabled.checked,
        threshold: parseInt(ruleAdultEmojiThreshold.value, 10) || 2,
        densityRatio: parseFloat(ruleAdultEmojiDensity.value) || 0.4,
        blockOnSticker: ruleAdultEmojiSticker.checked,
        scanCaptions: ruleAdultEmojiCaptions.checked,
        enforceOnAdmins: ruleAdultEmojiEnforceAdmins ? ruleAdultEmojiEnforceAdmins.checked : true,
        action: ruleAdultEmojiAction.value
      },
      antiPremiumEmoji: {
        enabled: rulePremiumEnabled.checked,
        enforceOnAdmins: rulePremiumEnforceAdmins.checked,
        blockAllCustomEmoji: rulePremiumAll.checked,
        blockVideoStickers: rulePremiumVideo.checked,
        blockAnimatedStickers: rulePremiumAnimated.checked,
        customEmojiBlocklist: parseList(rulePremiumEmojiBlocklist.value, /^\d{1,30}$/),
        stickerSetBlocklist: parseList(rulePremiumSetBlocklist.value, /^[A-Za-z0-9_]{1,64}$/),
        action: rulePremiumAction.value
      },
      enforcement: {
        exemptAdmins: admExemptAll ? admExemptAll.checked : true
      }
    };

    try {
      const response = await api('/api/settings', { method: 'POST', body: payload });
      const res = await response.json();
      if (res.success) {
        currentSettings = res.settings;
        updateQuickSwitches(currentSettings);
        showToast('Moderation rules saved successfully.', 'success');
      } else {
        showToast('Failed to save rules database.', 'error');
      }
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Network error saving configuration.', 'error');
    }
  });

  // Reset rules modifications to database state
  rulesResetBtn.addEventListener('click', () => {
    if (currentSettings) {
      populateRulesForm(currentSettings);
      showToast('Modifications reset to last saved state.', 'info');
    }
  });

  // Quick Controls handlers
  async function saveSingleQuickSetting(key, val) {
    if (!currentSettings) return;
    
    const copy = { ...currentSettings };
    copy[key].enabled = val;

    try {
      const response = await api('/api/settings', { method: 'POST', body: copy });
      const res = await response.json();
      if (res.success) {
        currentSettings = res.settings;
        populateRulesForm(currentSettings);
        updateQuickSwitches(currentSettings);
        showToast(`${key.toUpperCase()} state updated.`, 'success');
      }
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Error syncing quick setting.', 'error');
    }
  }

  quickWelcomeToggle.addEventListener('change', () => {
    saveSingleQuickSetting('welcome', quickWelcomeToggle.checked);
  });
  quickSpamToggle.addEventListener('change', () => {
    saveSingleQuickSetting('antiSpam', quickSpamToggle.checked);
  });
  quickLinkToggle.addEventListener('change', () => {
    saveSingleQuickSetting('antiLink', quickLinkToggle.checked);
  });
  quickRaidToggle.addEventListener('change', () => {
    saveSingleQuickSetting('antiRaid', quickRaidToggle.checked);
  });

  // Console Logs Processing
  function appendLogLine(log) {
    if (terminalPaused) return;  // held while the operator is reading

    const line = document.createElement('div');
    line.className = `terminal-line log-level-${log.level.toLowerCase()}`;
    line.setAttribute('data-level', log.level);

    const d = new Date(log.timestamp);
    // Date matters once the log spans more than a day.
    const dayStr = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    const timeStr = d.toLocaleTimeString();
    const grp = groupFromMessage(log.message);

    line.innerHTML =
      `<span class="line-time" title="${fullTime(log.timestamp)}">${dayStr} ${timeStr}</span>` +
      `<span class="line-level level-${log.level.toLowerCase()}">${log.level}</span>` +
      (grp ? `<span class="line-group">${escapeHtml(grp)}</span>` : '') +
      `<span class="line-msg">${escapeHtml(grp ? cleanDetail(log.message) : log.message)}</span>`;

    terminalConsole.appendChild(line);

    // Cap DOM size — an always-on bot would otherwise grow this unbounded.
    while (terminalConsole.childElementCount > 500) {
      terminalConsole.removeChild(terminalConsole.firstElementChild);
    }

    const threshold = 80;
    const isAtBottom = terminalConsole.scrollHeight - terminalConsole.clientHeight - terminalConsole.scrollTop < threshold;
    if (isAtBottom) terminalConsole.scrollTop = terminalConsole.scrollHeight;

    applyTerminalFilters();
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Levels that represent an actual moderation action (vs. plumbing/INFO noise)
  const MOD_LEVELS = new Set([
    'BAN', 'UNBAN', 'GBAN', 'KICK', 'MUTE', 'UNMUTE', 'WARNING', 'DELETE',
    'SPAM', 'FLOOD', 'LINK', 'FORWARD', 'MENTION', 'MEDIA', 'BUTTON', 'PREVIEW',
    'PROFANITY', 'ZALGO', 'NAME', 'SENDERCHAT', 'PREMIUM', 'RAID', 'CAS',
    'LOCK', 'UNLOCK', 'REPORT', 'NEWUSER', 'CONTENT'
  ]);
  // Levels that mean "a message was removed" — grouped under one filter option.
  const DELETE_LEVELS = new Set([
    'DELETE', 'LINK', 'FORWARD', 'MENTION', 'MEDIA', 'BUTTON', 'PREVIEW',
    'PROFANITY', 'ZALGO', 'SENDERCHAT', 'PREMIUM', 'CONTENT', 'NEWUSER', 'SPAM', 'FLOOD'
  ]);

  // One line, username only — the numeric ID is noise in a dense table, so it
  // lives in the hover tooltip and the detail panel. Accounts with no username
  // fall back to the ID, because for them it is the only handle there is.
  function identityCell(username, userId, extra) {
    const named = username && !String(username).startsWith('User_');
    const label = named ? '@' + username : String(userId);
    return `<span class="identity" title="ID ${userId}">` +
           `<span class="identity-name${named ? '' : ' identity-id'}">${escapeHtml(label)}</span>` +
           `${extra || ''}</span>`;
  }

  function badgeFor(level) {
    if (['BAN', 'GBAN', 'RAID', 'CAS', 'ERROR'].includes(level)) return 'red-bg';
    if (['UNBAN', 'UNMUTE', 'UNLOCK'].includes(level)) return 'green-bg';
    if (DELETE_LEVELS.has(level)) return 'purple-bg';
    return 'yellow-bg';
  }
  // The group name is embedded in log text as: in "Group Name".
  function groupFromMessage(msg) {
    const m = msg.match(/in [“"]([^”"]+)[”"]/);
    return m ? m[1] : null;
  }
  function userFromMessage(msg) {
    const m = msg.match(/@([A-Za-z0-9_]+)/) || msg.match(/(User_\d+)/);
    return m ? m[0] : null;
  }
  // Strip the leading emoji + trailing group clause so the Details column is tight.
  function cleanDetail(msg) {
    return msg
      .replace(/^[^\w@(]+/, '')
      .replace(/\s*in [“"][^”"]+[”"]\.?$/, '')
      .trim();
  }

  function updateHistoryTable() {
    if (!historyTbody) return;

    const q = (historySearch && historySearch.value || '').toLowerCase().trim();
    const type = historyTypeFilter ? historyTypeFilter.value : '';
    const grp = historyGroupFilter ? historyGroupFilter.value : '';
    const limit = historyLimit ? parseInt(historyLimit.value, 10) || 50 : 50;

    let events = allLogs.filter(l => MOD_LEVELS.has(l.level));

    // Populate the group dropdown from what's actually in the log.
    syncGroupFilter(historyGroupFilter,
      [...new Set(events.map(e => groupFromMessage(e.message)).filter(Boolean))]);

    const filtered = events.filter(l => {
      if (type === 'DELETES') { if (!DELETE_LEVELS.has(l.level)) return false; }
      else if (type && l.level !== type) return false;
      if (grp && groupFromMessage(l.message) !== grp) return false;
      if (!q) return true;
      return (l.message + ' ' + l.level).toLowerCase().includes(q);
    }).slice(-limit).reverse();

    if (historyCountBadge) historyCountBadge.textContent = filtered.length;

    if (!filtered.length) {
      historyTbody.innerHTML = `<tr><td colspan="5" class="center-text text-muted">${events.length ? 'No events match your filters.' : 'No recent events recorded.'}</td></tr>`;
      return;
    }

    historyTbody.innerHTML = filtered.map(log => {
      const grpName = groupFromMessage(log.message);
      const user = userFromMessage(log.message);
      return `<tr>
        <td><span title="${fullTime(log.timestamp)}">${relativeTime(log.timestamp)}</span></td>
        <td><span class="item-badge ${badgeFor(log.level)}">${log.level}</span></td>
        <td>${user ? `<strong>${escapeHtml(user)}</strong>` : '<span class="text-muted">System</span>'}</td>
        <td>${grpName ? escapeHtml(grpName) : '<span class="text-muted">—</span>'}</td>
        <td>${escapeHtml(cleanDetail(log.message))}</td>
      </tr>`;
    }).join('');
  }

  [historySearch, historyTypeFilter, historyGroupFilter, historyLimit].forEach(el => {
    if (el) el.addEventListener('input', updateHistoryTable);
    if (el) el.addEventListener('change', updateHistoryTable);
  });

  // ---- Live terminal: level filter + free-text search + pause ----
  function applyTerminalFilters() {
    const level = logFilterLevel.value;
    const q = (logSearch && logSearch.value || '').toLowerCase().trim();
    let shown = 0;
    terminalConsole.querySelectorAll('.terminal-line').forEach(line => {
      const lineLevel = line.getAttribute('data-level');
      const text = (line.textContent || '').toLowerCase();
      const ok = (level === 'ALL' || lineLevel === level) && (!q || text.includes(q));
      line.style.display = ok ? 'flex' : 'none';
      if (ok) shown++;
    });
    return shown;
  }

  logFilterLevel.addEventListener('change', applyTerminalFilters);
  if (logSearch) logSearch.addEventListener('input', applyTerminalFilters);

  if (pauseConsoleBtn) pauseConsoleBtn.addEventListener('click', () => {
    terminalPaused = !terminalPaused;
    pauseConsoleLabel.textContent = terminalPaused ? 'Resume' : 'Pause';
    pauseConsoleBtn.querySelector('i').className = terminalPaused ? 'fa-solid fa-play' : 'fa-solid fa-pause';
    if (!terminalPaused) terminalConsole.scrollTop = terminalConsole.scrollHeight;
    showToast(terminalPaused ? 'Terminal paused — new lines are held.' : 'Terminal resumed.', 'info');
  });

  clearConsoleBtn.addEventListener('click', () => {
    terminalConsole.innerHTML = '';
    showToast('Terminal cleared (server logs are unaffected).', 'info');
  });

  // Load Moderation Database (Warnings, Bans)
  // ---- Moderation tables: cached data + search/filter, re-rendered locally ----
  let warningsCache = [];
  let bansCache = [];

  // "3 minutes ago" reads better than a raw timestamp when scanning a list.
  function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return '—';
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }
  function fullTime(iso) {
    return iso ? new Date(iso).toLocaleString() : '';
  }
  // Keep a group <select> populated from whatever the data actually contains.
  function syncGroupFilter(sel, names) {
    if (!sel) return;
    const current = sel.value;
    const wanted = ['', ...names];
    if (sel.options.length - 1 !== names.length) {
      sel.innerHTML = '<option value="">All groups</option>' +
        names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
      if (wanted.includes(current)) sel.value = current;
    }
  }

  function renderWarnings() {
    if (!warningsTbody) return;
    const q = (warnSearch && warnSearch.value || '').toLowerCase().trim();
    const grp = warnGroupFilter ? warnGroupFilter.value : '';
    const lvl = warnLevelFilter ? warnLevelFilter.value : '';

    let rows = warningsCache.filter(w => {
      if (grp && (w.chatTitle || '') !== grp) return false;
      if (lvl && String(w.count) !== lvl) return false;
      if (!q) return true;
      return [w.username, w.userId, w.chatTitle, w.lastReason]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    rows = sortRows(rows, warnSort);

    if (warnCountBadge) warnCountBadge.textContent = rows.length;
    if (!rows.length) {
      warningsTbody.innerHTML = `<tr><td colspan="6" class="center-text text-muted">${warningsCache.length ? 'No warnings match your filters.' : 'No warnings issued yet.'}</td></tr>`;
      return;
    }

    warningsTbody.innerHTML = rows.map(w => {
      const sev = w.count >= 2 ? 'red-bg' : 'yellow-bg';
      return `<tr data-severity="${w.count >= 2 ? 'high' : 'low'}">
        <td>${identityCell(w.username, w.userId)}</td>
        <td class="col-group">${w.chatTitle ? escapeHtml(w.chatTitle) : '<span class="text-muted">—</span>'}</td>
        <td><span class="item-badge ${sev}">${w.count}/3</span></td>
        <td class="col-reason" title="${escapeHtml(w.lastReason || '')}">${escapeHtml(w.lastReason || '—')}</td>
        <td class="col-when"><span title="${fullTime(w.lastAt)}">${relativeTime(w.lastAt)}</span></td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="btn btn-secondary btn-small clear-warns-btn" data-id="${w.userId}" title="Reset this user's warnings to 0">Reset</button>
            <button class="btn btn-danger btn-small warn-ban-btn" data-id="${w.userId}" data-chat="${w.chatId || ''}" title="Ban this user now">Ban</button>
            <button class="btn btn-outline btn-small btn-icon user-detail-btn" data-id="${w.userId}" title="Open full record (ban / mute / kick)" aria-label="Open full record">
              <i class="fa-solid fa-id-card"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    document.querySelectorAll('#warnings-tbody .clear-warns-btn').forEach(b =>
      b.addEventListener('click', () => triggerClearWarnings(b.dataset.id)));
    document.querySelectorAll('#warnings-tbody .warn-ban-btn').forEach(b =>
      b.addEventListener('click', () => {
        if (confirm('Ban this user from the group?')) triggerBanUser(b.dataset.id, b.dataset.chat);
      }));
    document.querySelectorAll('#warnings-tbody .user-detail-btn').forEach(b =>
      b.addEventListener('click', () => openUserModal(b.dataset.id)));
  }

  function renderBans() {
    if (!bansTbody) return;
    const q = (banSearch && banSearch.value || '').toLowerCase().trim();
    const grp = banGroupFilter ? banGroupFilter.value : '';
    const status = banStatusFilter ? banStatusFilter.value : 'active';

    let rows = bansCache.filter(b => {
      if (status === 'active' && !b.active) return false;
      if (status === 'unbanned' && b.active) return false;
      if (grp && !(b.groups || []).includes(grp)) return false;
      if (!q) return true;
      return [b.username, b.userId, (b.groups || []).join(' '), b.lastReason]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    rows = sortRows(rows, banSort);

    if (banCountBadge) banCountBadge.textContent = rows.length;
    if (!rows.length) {
      bansTbody.innerHTML = `<tr><td colspan="6" class="center-text text-muted">${bansCache.length ? 'No bans match your filters.' : 'No bans recorded.'}</td></tr>`;
      return;
    }

    bansTbody.innerHTML = rows.map(b => {
      const status = b.active
        ? '<span class="item-badge red-bg">Banned</span>'
        : '<span class="item-badge green-bg">Unbanned</span>';
      // Repeat offenders read as "banned 5x" rather than five separate rows.
      const repeat = b.banCount > 1
        ? `<span class="repeat-pill" title="Banned ${b.banCount} times">${b.banCount}×</span>` : '';
      const groups = (b.groups || []).length
        ? (b.groups.length > 1
            ? `<span title="${escapeHtml(b.groups.join(', '))}">${escapeHtml(b.groups[0])} <span class="text-muted">+${b.groups.length - 1}</span></span>`
            : escapeHtml(b.groups[0]))
        : '<span class="text-muted">—</span>';
      const action = b.active
        ? `<button class="btn btn-secondary btn-small unban-btn" data-id="${b.userId}" data-chat="${b.lastChatId || ''}">Unban</button>`
        : '';
      return `<tr data-severity="${!b.active ? 'none' : b.banCount >= 5 ? 'high' : 'low'}">
        <td>${identityCell(b.username, b.userId, repeat)}</td>
        <td class="col-group">${groups}</td>
        <td class="col-when"><span title="${fullTime(b.lastBannedAt)}">${relativeTime(b.lastBannedAt)}</span></td>
        <td class="col-reason" title="${escapeHtml(b.lastReason || '')}">${escapeHtml(b.lastReason || '—')}</td>
        <td>${status}</td>
        <td class="col-actions">
          <div class="row-actions">${action}
            <button class="btn btn-outline btn-small btn-icon user-detail-btn" data-id="${b.userId}" title="Open full record" aria-label="Open full record">
              <i class="fa-solid fa-id-card"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    document.querySelectorAll('#bans-tbody .unban-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const chatId = btn.dataset.chat ? Number(btn.dataset.chat) : null;
        triggerUnban(btn.dataset.id, chatId);
      }));
    document.querySelectorAll('#bans-tbody .user-detail-btn').forEach(btn =>
      btn.addEventListener('click', () => openUserModal(btn.dataset.id)));
  }

  // ---- Click-to-sort table headers ----
  // Each table keeps { key, dir }. Clicking the same header flips direction.
  let warnSort = { key: 'lastAt', dir: 'desc' };
  let banSort  = { key: 'lastBannedAt', dir: 'desc' };

  function sortRows(rows, state) {
    if (!state || !state.key) return rows;
    const dir = state.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let x = a[state.key], y = b[state.key];
      if (state.key === 'groups') { x = (x || [])[0] || ''; y = (y || [])[0] || ''; }
      // Dates compare numerically; everything else as lower-cased text/number.
      if (/At$/.test(state.key)) { x = new Date(x || 0).getTime(); y = new Date(y || 0).getTime(); }
      else if (typeof x === 'string' || typeof y === 'string') {
        x = String(x == null ? '' : x).toLowerCase();
        y = String(y == null ? '' : y).toLowerCase();
      } else { x = x || 0; y = y || 0; }
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }

  // Wire <th data-sort="key"> headers to their table's sort state.
  function makeSortable(tableId, getState, setState, rerender) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.add('sortable-th');
      // Mark the column the table is already sorted by so the arrow isn't a lie.
      if (th.dataset.sort === getState().key) th.setAttribute('data-dir', getState().dir);
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const s = getState();
        setState({ key, dir: (s.key === key && s.dir === 'desc') ? 'asc' : 'desc' });
        table.querySelectorAll('th[data-sort]').forEach(o => o.removeAttribute('data-dir'));
        th.setAttribute('data-dir', getState().dir);
        rerender();
      });
    });
  }
  makeSortable('table-warnings', () => warnSort, s => { warnSort = s; }, () => renderWarnings());
  makeSortable('table-bans', () => banSort, s => { banSort = s; }, () => renderBans());

  // ================= Global user lookup =================
  const globalSearch = document.getElementById('global-user-search');
  const globalResults = document.getElementById('global-search-results');
  const userModal = document.getElementById('user-modal');
  let umUserId = null;

  function closeUserModal() {
    if (userModal) userModal.classList.add('hidden');
    umUserId = null;
  }
  const umClose = document.getElementById('um-close');
  if (umClose) umClose.addEventListener('click', closeUserModal);
  if (userModal) userModal.addEventListener('click', (e) => {
    if (e.target === userModal) closeUserModal();   // click the backdrop to dismiss
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeUserModal(); if (globalResults) globalResults.classList.add('hidden'); }
  });

  async function openUserModal(userId, keepScope) {
    try {
      const r = await api('/api/users/' + userId);
      const u = await r.json();
      umUserId = u.userId;

      const uname = u.username && !String(u.username).startsWith('User_') ? '@' + u.username : 'No username';
      document.getElementById('um-name').textContent = uname;
      document.getElementById('um-id').textContent = 'ID ' + u.userId;
      document.getElementById('um-warns').textContent = `${u.warnings}/3`;
      document.getElementById('um-bans').textContent = u.banCount;
      document.getElementById('um-mutes').textContent = u.muteCount;
      const st = document.getElementById('um-status');
      st.textContent = u.currentlyBanned ? 'BANNED' : 'Active';
      st.style.color = u.currentlyBanned ? 'var(--color-red)' : 'var(--color-green)';

      // Scope dropdown: all groups, or one specific group.
      // Rebuilding the options wipes the selection, so keep whatever the admin
      // picked — otherwise a refresh after one action silently re-narrows the
      // next action to a single group.
      const scope = document.getElementById('um-scope');
      const previous = keepScope ? scope.value : null;
      const groupOpts = chatsCache.length
        ? chatsCache.map(c => `<option value="${c.id}">${escapeHtml(c.title || c.id)}</option>`).join('')
        : '';
      scope.innerHTML = '<option value="">All groups the bot is in</option>' + groupOpts;
      if (previous !== null) scope.value = previous;
      else if (u.lastChatId) scope.value = String(u.lastChatId);

      // History: warnings + bans + mutes, newest first
      const items = [];
      (u.warningHistory || []).forEach(h => items.push({
        t: h.timestamp, kind: 'WARNING', txt: h.reason, grp: h.chatTitle
      }));
      (u.bans || []).forEach(b => items.push({
        t: b.bannedAt, kind: b.active === false ? 'UNBANNED' : 'BAN', txt: b.reason, grp: b.chatTitle
      }));
      (u.mutes || []).forEach(m => items.push({
        t: m.mutedAt, kind: 'MUTE', txt: m.reason, grp: null
      }));
      items.sort((a, b) => new Date(b.t || 0) - new Date(a.t || 0));

      document.getElementById('um-history-body').innerHTML = items.length
        ? items.slice(0, 20).map(i => `
            <div class="um-hist-row">
              <span class="item-badge ${badgeFor(i.kind === 'UNBANNED' ? 'UNBAN' : i.kind)}">${i.kind}</span>
              <span class="um-hist-txt">${escapeHtml(i.txt || '—')}</span>
              <span class="text-muted um-hist-meta">${i.grp ? escapeHtml(i.grp) + ' · ' : ''}${relativeTime(i.t)}</span>
            </div>`).join('')
        : '<p class="text-muted">No records.</p>';

      userModal.classList.remove('hidden');
      if (globalResults) globalResults.classList.add('hidden');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Could not load that user.', 'error');
    }
  }

  // Debounced type-ahead search
  let searchTimer = null;
  if (globalSearch) {
    globalSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = globalSearch.value.trim();
      if (q.length < 2) { globalResults.classList.add('hidden'); return; }
      searchTimer = setTimeout(async () => {
        try {
          const r = await api('/api/users/search?q=' + encodeURIComponent(q));
          const { results } = await r.json();
          if (!results.length) {
            globalResults.innerHTML = '<div class="gs-empty">No user found. They must have been warned, muted or banned at least once.</div>';
          } else {
            globalResults.innerHTML = results.map(u => {
              const named = u.username && !String(u.username).startsWith('User_');
              const tags = [
                u.currentlyBanned ? '<span class="item-badge red-bg">Banned</span>' : '',
                u.warnings ? `<span class="item-badge yellow-bg">${u.warnings}/3</span>` : '',
                u.banCount ? `<span class="repeat-pill">${u.banCount}×</span>` : ''
              ].filter(Boolean).join(' ');
              return `<div class="gs-row" data-id="${u.userId}" role="option" tabindex="0">
                        <span class="identity-name${named ? '' : ' identity-id'}">${escapeHtml(named ? '@' + u.username : String(u.userId))}</span>
                        <span class="gs-tags">${tags}</span>
                      </div>`;
            }).join('');
            globalResults.querySelectorAll('.gs-row').forEach(row =>
              row.addEventListener('click', () => openUserModal(row.dataset.id)));
          }
          globalResults.classList.remove('hidden');
        } catch (e) { /* ignore transient search errors */ }
      }, 250);
    });
    document.addEventListener('click', (e) => {
      if (globalResults && !globalResults.contains(e.target) && e.target !== globalSearch) {
        globalResults.classList.add('hidden');
      }
    });
  }

  // Modal action buttons
  async function umAction(endpoint, extra, confirmMsg) {
    if (!umUserId) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    const scope = document.getElementById('um-scope').value;
    try {
      const r = await api('/api/action/' + endpoint, {
        method: 'POST',
        body: Object.assign({ userId: umUserId, chatId: scope || undefined }, extra || {})
      });
      const j = await r.json();
      if (j.success) {
        showToast(j.message || 'Done.', 'success');
        openUserModal(umUserId, true);   // refresh, keeping the chosen scope
        loadModData();
      } else showToast(j.error || 'Action failed.', 'error');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  }
  const umBan = document.getElementById('um-ban');
  if (umBan) umBan.addEventListener('click', () => umAction('ban', null, 'Ban this user?'));
  const umUnban = document.getElementById('um-unban');
  if (umUnban) umUnban.addEventListener('click', () => umAction('unban'));
  const umKick = document.getElementById('um-kick');
  if (umKick) umKick.addEventListener('click', () => umAction('kick', null, 'Kick this user? They can rejoin.'));
  const umMute = document.getElementById('um-mute');
  if (umMute) umMute.addEventListener('click', () => {
    const mins = Number(document.getElementById('um-mute-mins').value);
    umAction('mute', { minutes: mins > 0 ? mins : 60 });   // fall back to 1 hour
  });
  const umReset = document.getElementById('um-reset');
  if (umReset) umReset.addEventListener('click', async () => {
    if (!umUserId) return;
    await triggerClearWarnings(umUserId);
    openUserModal(umUserId, true);
  });

  async function triggerBanUser(userId, chatId) {
    try {
      const r = await api('/api/action/ban', { method: 'POST', body: { userId, chatId: chatId || undefined } });
      const j = await r.json();
      if (j.success) { showToast(j.message || 'User banned.', 'success'); loadModData(); }
      else showToast(j.error || 'Ban failed.', 'error');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  }

  async function loadModData() {
    try {
      const response = await api('/api/data');
      const data = await response.json();

      statBans.textContent = (data.bans || []).filter(b => b.active !== false).length;
      statMutes.textContent = (data.mutes || []).length;

      warningsCache = data.warningsList || [];
      bansCache = data.bans || [];

      // Group dropdowns reflect the groups actually present in the data.
      syncGroupFilter(warnGroupFilter, [...new Set(warningsCache.map(w => w.chatTitle).filter(Boolean))]);
      syncGroupFilter(banGroupFilter, [...new Set(bansCache.map(b => b.chatTitle).filter(Boolean))]);

      renderWarnings();
      renderBans();
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Error reading moderation databases.', 'error');
    }
  }

  // Live search/filter — re-render from cache, no server round-trip.
  [warnSearch, warnGroupFilter, warnLevelFilter].forEach(el => {
    if (el) el.addEventListener('input', renderWarnings);
    if (el) el.addEventListener('change', renderWarnings);
  });
  [banSearch, banGroupFilter, banStatusFilter].forEach(el => {
    if (el) el.addEventListener('input', renderBans);
    if (el) el.addEventListener('change', renderBans);
  });

  async function triggerUnban(userId, chatId) {
    try {
      const body = chatId ? { userId, chatId } : { userId };
      const response = await api('/api/action/unban', { method: 'POST', body });
      const res = await response.json();
      if (res.success) {
        showToast(res.message || 'User unbanned.', 'success');
        loadModData();
      } else {
        showToast(res.error || 'Failed to unban user.', 'error');
      }
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('API request error unbanning user.', 'error');
    }
  }

  async function triggerClearWarnings(userId) {
    try {
      const response = await api('/api/action/clear-warns', { method: 'POST', body: { userId } });
      const res = await response.json();
      if (res.success) {
        showToast('Warnings reset successfully.', 'success');
        loadModData();
      } else {
        showToast(res.error || 'Failed to clear warnings.', 'error');
      }
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('API request error clearing warnings.', 'error');
    }
  }

  // System Controls Hooking
  async function triggerBotControlAction(action) {
    try {
      showToast(`Triggering bot ${action}...`, 'info');
      const response = await api(`/api/action/${action}`, { method: 'POST' });
      const res = await response.json();
      if (res.success) {
        showToast(res.message, 'success');
        checkBotStatus();
      } else {
        showToast(res.error || 'Control action failed.', 'error');
      }
    } catch (err) {
      if (err.message !== 'unauthorized') showToast('Network error triggering bot actions.', 'error');
    }
  }

  btnRestartBot.addEventListener('click', () => triggerBotControlAction('restart'));
  btnStopBot.addEventListener('click', () => triggerBotControlAction('stop'));

  // --- Routine Scan: duration picker + Scan-now button + last-result render ---
  function getSelectedScanHours() {
    if (!scanDurationSelect) return 24;
    if (scanDurationSelect.value === 'custom') {
      return Math.max(1, Math.min(parseInt(scanDurationCustom.value, 10) || 24, 8760));
    }
    return parseInt(scanDurationSelect.value, 10) || 24;
  }
  if (scanDurationSelect) {
    scanDurationSelect.addEventListener('change', () => {
      scanDurationCustom.style.display = scanDurationSelect.value === 'custom' ? 'block' : 'none';
    });
  }
  function renderScanSummary(summary) {
    if (!lastScanSummary || !summary) return;
    const when = summary.completedAt ? new Date(summary.completedAt).toLocaleString()
                                     : new Date(summary.startedAt || Date.now()).toLocaleString();
    const byRule = Object.entries(summary.byRule || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '(no rule hits)';
    const samples = (summary.sampleDeletes || []).slice(0, 3)
      .map(s => `<div class="text-muted">• <strong>${s.rule}</strong> @${s.user}: ${escapeHtml(s.text || s.reason)}</div>`)
      .join('');
    lastScanSummary.innerHTML = `
      <div><strong>Window:</strong> last ${summary.durationHours}h <span class="text-muted">(${summary.trigger || 'manual'})</span></div>
      <div><strong>Scanned:</strong> ${summary.scanned} of ${summary.total || summary.scanned}
           • <strong>Deleted:</strong> ${summary.deleted}
           • <span class="text-muted">already gone: ${summary.alreadyGone || 0}, errors: ${summary.errors}</span></div>
      <div class="text-muted">Breakdown — ${byRule}</div>
      ${samples}
      <div class="text-muted">Finished ${when}</div>`;
  }
  async function loadLastScan() {
    try {
      const r = await api('/api/scans');
      const list = await r.json();
      if (Array.isArray(list) && list.length) renderScanSummary(list[list.length - 1]);
    } catch (e) {}
  }
  if (btnRoutineScan) {
    btnRoutineScan.addEventListener('click', async () => {
      const hours = getSelectedScanHours();
      btnRoutineScan.disabled = true;
      btnRoutineScanLabel.textContent = `Scanning… (${hours}h)`;
      try {
        const r = await api('/api/action/routine-scan', { method: 'POST', body: { hours } });
        const j = await r.json();
        if (j.success) {
          renderScanSummary(j.summary);
          showToast(`Scan done — ${j.summary.deleted} deleted of ${j.summary.scanned} scanned.`, 'success');
          loadModData();
        } else {
          showToast(j.error || 'Scan failed.', 'error');
        }
      } catch (e) {
        if (e.message !== 'unauthorized') showToast('Scan request error.', 'error');
      } finally {
        btnRoutineScan.disabled = false;
        btnRoutineScanLabel.textContent = 'Scan now';
      }
    });
  }
  // Don't call this at startup — it would 401 before login and bounce the
  // unauthenticated visitor to the sign-in screen even when no admin exists.
  // loadLastScan is invoked from checkBotStatus() once we're authenticated.
  
  // Quick status bar button (Stop / Start toggle)
  quickActionStatusBtn.addEventListener('click', () => {
    const text = quickActionText.textContent.toLowerCase();
    if (text.includes('stop')) {
      triggerBotControlAction('stop');
    } else {
      triggerBotControlAction('restart');
    }
  });

  // Re-enter token settings (legacy single-bot flow — element may not exist in multi-bot UI)
  if (btnChangeToken) btnChangeToken.addEventListener('click', () => {
    setupWizard.classList.remove('hidden');
    appContainer.classList.add('hidden');
    botTokenInput.value = '';
    botTokenInput.focus();
  });

  // Reveal Token display (legacy)
  let tokenRevealed = false;
  if (revealTokenBtn) revealTokenBtn.addEventListener('click', async () => {
    tokenRevealed = !tokenRevealed;
    if (tokenRevealed) {
      try {
        const response = await api('/api/status');
        const status = await response.json();
        // Since we don't return the raw token on client API to prevent leakage, we show we are holding it,
        // but if they click, we can guide them to change token
        if (activeTokenInput) activeTokenInput.value = "Active (Stored in .env)";
        revealTokenBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide';
      } catch (err) {}
    } else {
      if (activeTokenInput) activeTokenInput.value = "••••••••••••••••••••••••••••••••";
      revealTokenBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Show';
    }
  });

  // -------- Connected Groups + per-group rule overrides --------
  const groupsTbody = document.getElementById('groups-tbody');
  const groupsCountBadge = document.getElementById('groups-count-badge');
  const menuGroupsCount = document.getElementById('menu-groups-count');
  const statGroups = document.getElementById('stat-groups');
  const groupEditor = document.getElementById('group-editor');
  const groupEditorTitle = document.getElementById('group-editor-title');
  let editingChatId = null;
  let chatsCache = [];

  const SCRIPT_LABELS = {
    blockCJK: '中日', blockKorean: '한', blockCyrillic: 'Кир', blockArabic: 'عر', blockThai: 'ไทย'
  };

  async function loadChats() {
    if (!groupsTbody) return;
    try {
      const r = await api('/api/chats');
      const data = await r.json();
      chatsCache = data.chats || [];
      const n = data.count || 0;
      if (groupsCountBadge) groupsCountBadge.textContent = n;
      if (menuGroupsCount) menuGroupsCount.textContent = n;
      if (statGroups) statGroups.textContent = n;

      if (!chatsCache.length) {
        groupsTbody.innerHTML = `<tr><td colspan="6" class="center-text text-muted">No groups yet — add the bot to a group and promote it to admin.</td></tr>`;
        return;
      }
      groupsTbody.innerHTML = chatsCache.map(c => {
        const lang = (c.overrides && c.overrides.languageFilter) || {};
        const blocked = Object.keys(SCRIPT_LABELS).filter(k => lang[k]).map(k => SCRIPT_LABELS[k]);
        let langCell;
        if (lang.enabled === false) {
          langCell = '<span class="item-badge neutral-bg">Filter off</span>';
        } else if (blocked.length) {
          langCell = blocked.map(b => `<span class="item-badge purple-bg">${b}</span>`).join(' ');
        } else {
          langCell = '<span class="text-muted">Global</span>';
        }
        // Permission health — the #1 reason moderation silently does nothing.
        let permCell;
        if (c.botIsAdmin === null || c.botIsAdmin === undefined) {
          permCell = '<span class="text-muted">Unknown — hit Refresh</span>';
        } else if (!c.botIsAdmin) {
          permCell = '<span class="item-badge red-bg" title="The bot is only a member here. It can read messages but cannot delete or ban. Promote it to admin.">⚠ NOT ADMIN — can\'t delete/ban</span>';
        } else if (!c.canDelete || !c.canBan) {
          permCell = `<span class="item-badge yellow-bg" title="Admin, but missing rights.">⚠ missing: ${!c.canDelete ? 'Delete Messages' : ''}${(!c.canDelete && !c.canBan) ? ' + ' : ''}${!c.canBan ? 'Ban Users' : ''}</span>`;
        } else {
          permCell = '<span class="item-badge green-bg">✓ Admin — full rights</span>';
        }
        return `<tr>
          <td><strong>${escapeHtml(c.title || 'Untitled')}</strong><br><code class="text-muted">${c.id}</code></td>
          <td>${c.memberCount !== null && c.memberCount !== undefined ? c.memberCount : '—'}</td>
          <td>${permCell}</td>
          <td>${c.actionsTaken || 0}</td>
          <td>${langCell}${c.hasOverrides ? ' <span class="item-badge yellow-bg" title="This group has custom rules">custom</span>' : ''}</td>
          <td><button class="btn btn-secondary btn-small group-edit-btn" data-id="${c.id}"><i class="fa-solid fa-sliders"></i> Rules</button></td>
        </tr>`;
      }).join('');

      document.querySelectorAll('.group-edit-btn').forEach(b =>
        b.addEventListener('click', () => openGroupEditor(b.dataset.id)));
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Could not load groups.', 'error');
    }
  }

  const triState = (v) => (v === undefined || v === null) ? '' : String(!!v);

  function openGroupEditor(chatId) {
    const c = chatsCache.find(x => String(x.id) === String(chatId));
    if (!c || !groupEditor) return;
    editingChatId = chatId;
    groupEditorTitle.textContent = c.title || chatId;
    const ov = c.overrides || {};
    const lang = ov.languageFilter || {};
    document.getElementById('go-lang-enabled').value = triState(lang.enabled);
    document.getElementById('go-lang-action').value = lang.action || '';
    document.getElementById('go-block-cjk').checked = !!lang.blockCJK;
    document.getElementById('go-block-korean').checked = !!lang.blockKorean;
    document.getElementById('go-block-cyrillic').checked = !!lang.blockCyrillic;
    document.getElementById('go-block-arabic').checked = !!lang.blockArabic;
    document.getElementById('go-block-thai').checked = !!lang.blockThai;
    document.getElementById('go-silent').value = triState(ov.silentMode && ov.silentMode.enabled);
    document.getElementById('go-captcha').value = triState(ov.captcha && ov.captcha.enabled);
    document.getElementById('go-links').value = triState(ov.antiLink && ov.antiLink.enabled);
    groupEditor.classList.remove('hidden');
    groupEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function saveGroupOverrides() {
    if (!editingChatId) return;
    const langEnabled = document.getElementById('go-lang-enabled').value;
    const langAction = document.getElementById('go-lang-action').value;
    const overrides = {};

    const lang = {};
    if (langEnabled !== '') lang.enabled = langEnabled === 'true';
    if (langAction) lang.action = langAction;
    // Script toggles are only meaningful when the filter isn't turned off here.
    ['blockCJK:go-block-cjk', 'blockKorean:go-block-korean', 'blockCyrillic:go-block-cyrillic',
     'blockArabic:go-block-arabic', 'blockThai:go-block-thai'].forEach(pair => {
      const [key, id] = pair.split(':');
      const el = document.getElementById(id);
      if (el && el.checked) lang[key] = true;
      else if (el) lang[key] = false;
    });
    if (Object.keys(lang).length) overrides.languageFilter = lang;

    const silent = document.getElementById('go-silent').value;
    if (silent !== '') overrides.silentMode = { enabled: silent === 'true' };
    const captcha = document.getElementById('go-captcha').value;
    if (captcha !== '') overrides.captcha = { enabled: captcha === 'true' };
    const links = document.getElementById('go-links').value;
    if (links !== '') overrides.antiLink = { enabled: links === 'true' };

    try {
      const r = await api(`/api/chats/${editingChatId}/overrides`, { method: 'POST', body: { overrides } });
      const j = await r.json();
      if (j.success) {
        showToast('Group rules saved.', 'success');
        loadChats();
      } else showToast(j.error || 'Failed to save.', 'error');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  }

  const btnSaveGroup = document.getElementById('btn-save-group-overrides');
  if (btnSaveGroup) btnSaveGroup.addEventListener('click', saveGroupOverrides);

  const btnClearGroup = document.getElementById('btn-clear-group-overrides');
  if (btnClearGroup) btnClearGroup.addEventListener('click', async () => {
    if (!editingChatId) return;
    try {
      await api(`/api/chats/${editingChatId}/overrides`, { method: 'DELETE' });
      showToast('Group now follows global rules.', 'success');
      groupEditor.classList.add('hidden');
      editingChatId = null;
      loadChats();
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  });

  const btnCloseGroup = document.getElementById('btn-close-group-editor');
  if (btnCloseGroup) btnCloseGroup.addEventListener('click', () => {
    groupEditor.classList.add('hidden');
    editingChatId = null;
  });

  const btnRefreshChats = document.getElementById('btn-refresh-chats');
  if (btnRefreshChats) btnRefreshChats.addEventListener('click', async () => {
    btnRefreshChats.disabled = true;
    const original = btnRefreshChats.innerHTML;
    btnRefreshChats.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Refreshing…';
    try {
      const r = await api('/api/chats/refresh', { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        showToast('Groups refreshed from Telegram.', 'success');
        loadChats();
      } else showToast(j.error || 'Refresh failed.', 'error');
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    } finally {
      btnRefreshChats.disabled = false;
      btnRefreshChats.innerHTML = original;
    }
  });

  // -------- Multi-bot manager --------
  async function loadBots() {
    if (!botsTbody) return;
    try {
      const r = await api('/api/bots');
      const list = await r.json();
      if (!Array.isArray(list) || list.length === 0) {
        botsTbody.innerHTML = `<tr><td colspan="6" class="center-text text-muted">No bots configured yet. Add one below.</td></tr>`;
        return;
      }
      botsTbody.innerHTML = '';
      for (const b of list) {
        const tr = document.createElement('tr');
        const addedAt = b.addedAt ? new Date(b.addedAt).toLocaleString() : '—';
        const statusBadge = b.online
          ? '<span class="item-badge green-bg">Online</span>'
          : '<span class="item-badge yellow-bg">Offline</span>';
        const handle = b.username ? `@${b.username}` : (b.first_name || '(awaiting…)') ;
        // Privacy Mode ON means Telegram hides most group messages from the bot —
        // the single biggest reason moderation appears to "do nothing".
        const privacyWarn = (b.online && b.canReadAllMessages === false)
          ? ` <span class="item-badge red-bg" title="Privacy Mode is ON: Telegram hides most group messages from this bot. Fix in @BotFather → Bot Settings → Group Privacy → Turn OFF, then remove and re-add the bot to your groups.">⚠ privacy mode</span>`
          : '';
        tr.innerHTML = `
          <td><code>${b.id}</code></td>
          <td><strong>${handle}</strong>${privacyWarn}</td>
          <td>${b.name || '<span class="text-muted">—</span>'}</td>
          <td>${statusBadge}</td>
          <td>${addedAt}</td>
          <td>
            <button class="btn btn-secondary btn-small bot-restart-btn" data-id="${b.id}" title="Restart this bot">
              <i class="fa-solid fa-arrow-rotate-right"></i>
            </button>
            <button class="btn btn-outline btn-small bot-stop-btn" data-id="${b.id}" title="Stop this bot">
              <i class="fa-solid fa-circle-stop"></i>
            </button>
            <button class="btn btn-danger btn-small bot-remove-btn" data-id="${b.id}" title="Remove this bot (deletes token)">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>`;
        botsTbody.appendChild(tr);
      }
      document.querySelectorAll('.bot-restart-btn').forEach(btn => btn.addEventListener('click', () => botAction(btn.dataset.id, 'restart')));
      document.querySelectorAll('.bot-stop-btn').forEach(btn => btn.addEventListener('click', () => botAction(btn.dataset.id, 'stop')));
      document.querySelectorAll('.bot-remove-btn').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Remove this bot? Its token will be deleted from disk.')) botAction(btn.dataset.id, 'remove');
      }));
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Could not load bots list.', 'error');
    }
  }

  async function botAction(id, action) {
    try {
      let r;
      if (action === 'remove') r = await api(`/api/bots/${id}`, { method: 'DELETE' });
      else r = await api(`/api/bots/${id}/${action}`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        showToast(`Bot ${id}: ${action} ok.`, 'success');
        setTimeout(loadBots, 1500); // give the bot a moment to come up
      } else {
        showToast(j.error || `Failed to ${action} bot.`, 'error');
      }
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  }

  if (addBotForm) addBotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = newBotTokenInput.value.trim();
    const name = (newBotNameInput.value || '').trim();
    if (!token) return;
    try {
      const r = await api('/api/bots', { method: 'POST', body: { token, name } });
      const j = await r.json();
      if (j.success) {
        showToast('Bot added. Starting…', 'success');
        newBotTokenInput.value = '';
        newBotNameInput.value = '';
        setTimeout(loadBots, 1500);
      } else {
        showToast(j.error || 'Failed to add bot.', 'error');
      }
    } catch (e) {
      if (e.message !== 'unauthorized') showToast('Network error.', 'error');
    }
  });
  // Helper functions for preset state updates
  function setFieldChecked(element, checked) {
    if (element) {
      if (element.checked !== checked) {
        element.checked = checked;
        element.dispatchEvent(new Event('change'));
      }
    }
  }

  function setFieldValue(element, value) {
    if (element) {
      element.value = value;
    }
  }

  // Preset selector buttons
  const btnPresetCasual = document.getElementById('preset-casual');
  const btnPresetStandard = document.getElementById('preset-standard');
  const btnPresetStrict = document.getElementById('preset-strict');

  if (btnPresetCasual) {
    btnPresetCasual.addEventListener('click', () => {
      setFieldChecked(ruleSilentEnabled, false);
      setFieldChecked(ruleSilentWelcome, false);
      setFieldChecked(ruleSilentAnnouncements, false);
      setFieldChecked(ruleSilentActionNotices, false);
      setFieldChecked(ruleSilentCaptcha, false);

      setFieldChecked(ruleWelcomeEnabled, true);
      setFieldValue(ruleWelcomeText, "Welcome to the group, {username}! 👋 Please read the guidelines.");
      setFieldValue(ruleWelcomeDelete, 30);

      setFieldChecked(ruleSpamEnabled, true);
      setFieldValue(ruleSpamMax, 8);
      setFieldValue(ruleSpamInterval, 3000);
      setFieldValue(ruleSpamDuplicate, 4);
      setFieldValue(ruleSpamAction, "warn");

      setFieldChecked(ruleLinkEnabled, true);

      setFieldChecked(ruleLinkStrict, false);
      setFieldChecked(ruleLinkEnforceAdmins, false);
      setFieldValue(ruleLinkAction, "delete");

      setFieldChecked(ruleProfanityEnabled, true);
      setFieldChecked(ruleProfanityEnforceAdmins, false);
      setFieldValue(ruleProfanityAction, "delete");

      setFieldChecked(ruleForwardEnabled, false);
      setFieldChecked(ruleMentionEnabled, false);

      setFieldChecked(ruleMediaEnabled, true);
      setFieldChecked(ruleMediaCaptions, true);
      setFieldChecked(ruleMediaFilenames, true);
      setFieldChecked(ruleMediaStickerEmoji, true);
      setFieldChecked(ruleMediaBlockStickers, false);
      setFieldChecked(ruleMediaBlockGifs, false);
      setFieldChecked(ruleMediaBlockVideoNotes, false);
      setFieldChecked(ruleMediaBlockPhotos, false);
      setFieldChecked(ruleMediaBlockVideos, false);
      setFieldChecked(ruleMediaBlockDocuments, false);
      setFieldChecked(ruleMediaBlockVoice, false);
      setFieldChecked(ruleMediaRequireCaption, false);
      setFieldValue(ruleMediaMinCaption, 0);
      setFieldValue(ruleMediaAction, "delete");

      setFieldChecked(rulePremiumEnabled, false);

      setFieldChecked(ruleAdultEmojiEnabled, true);
      setFieldValue(ruleAdultEmojiThreshold, 4);
      setFieldValue(ruleAdultEmojiDensity, 0.6);
      setFieldChecked(ruleAdultEmojiSticker, true);
      setFieldChecked(ruleAdultEmojiCaptions, true);
      setFieldValue(ruleAdultEmojiAction, "delete");

      setFieldChecked(ruleButtonEnabled, false);
      setFieldChecked(rulePreviewEnabled, false);
      setFieldChecked(ruleRaidEnabled, false);
      setFieldChecked(ruleCaptchaEnabled, false);

      setFieldChecked(ruleCasEnabled, true);
      setFieldValue(ruleCasAction, "restrict");

      setFieldChecked(ruleNameFilterEnabled, true);
      setFieldValue(ruleNameFilterAction, "kick");

      setFieldChecked(ruleSenderChatEnabled, true);
      setFieldValue(ruleSenderChatAction, "delete");

      setFieldChecked(ruleZalgoEnabled, true);
      setFieldValue(ruleZalgoMax, 40);
      setFieldChecked(ruleZalgoRtl, true);
      setFieldValue(ruleZalgoAction, "delete");

      showToast("Applied Casual Guard settings profile. Review rules below, then click Save All Rules.", "success");
    });
  }

  if (btnPresetStandard) {
    btnPresetStandard.addEventListener('click', () => {
      setFieldChecked(ruleSilentEnabled, false);
      setFieldChecked(ruleSilentWelcome, false);
      setFieldChecked(ruleSilentAnnouncements, false);
      setFieldChecked(ruleSilentActionNotices, false);
      setFieldChecked(ruleSilentCaptcha, false);

      setFieldChecked(ruleWelcomeEnabled, true);
      setFieldValue(ruleWelcomeText, "Welcome to the group, {username}! 👋 Please make sure to follow the guidelines.");
      setFieldValue(ruleWelcomeDelete, 30);

      setFieldChecked(ruleSpamEnabled, true);
      setFieldValue(ruleSpamMax, 5);
      setFieldValue(ruleSpamInterval, 3000);
      setFieldValue(ruleSpamDuplicate, 3);
      setFieldValue(ruleSpamAction, "warn");

      setFieldChecked(ruleLinkEnabled, true);

      setFieldChecked(ruleLinkStrict, true);
      setFieldChecked(ruleLinkEnforceAdmins, true);
      setFieldValue(ruleLinkAction, "delete_and_warn");

      setFieldChecked(ruleProfanityEnabled, true);
      setFieldChecked(ruleProfanityEnforceAdmins, true);
      setFieldValue(ruleProfanityAction, "delete_and_warn");

      setFieldChecked(ruleForwardEnabled, true);
      setFieldChecked(ruleForwardChannels, true);
      setFieldChecked(ruleForwardUsers, false);
      setFieldChecked(ruleForwardHidden, true);
      setFieldValue(ruleForwardAction, "delete_and_warn");

      setFieldChecked(ruleMentionEnabled, true);
      setFieldChecked(ruleMentionChannels, true);
      setFieldChecked(ruleMentionUsers, false);
      setFieldValue(ruleMentionAction, "delete_and_warn");

      setFieldChecked(ruleMediaEnabled, true);
      setFieldChecked(ruleMediaCaptions, true);
      setFieldChecked(ruleMediaFilenames, true);
      setFieldChecked(ruleMediaStickerEmoji, true);
      setFieldChecked(ruleMediaBlockStickers, false);
      setFieldChecked(ruleMediaBlockGifs, false);
      setFieldChecked(ruleMediaBlockVideoNotes, false);
      setFieldChecked(ruleMediaBlockPhotos, false);
      setFieldChecked(ruleMediaBlockVideos, false);
      setFieldChecked(ruleMediaBlockDocuments, false);
      setFieldChecked(ruleMediaBlockVoice, false);
      setFieldChecked(ruleMediaRequireCaption, false);
      setFieldValue(ruleMediaMinCaption, 0);
      setFieldValue(ruleMediaAction, "delete_and_warn");

      setFieldChecked(rulePremiumEnabled, true);
      setFieldChecked(rulePremiumEnforceAdmins, true);
      setFieldChecked(rulePremiumAll, true);
      setFieldChecked(rulePremiumVideo, true);
      setFieldChecked(rulePremiumAnimated, false);
      setFieldValue(rulePremiumAction, "delete_and_warn");

      setFieldChecked(ruleAdultEmojiEnabled, true);
      setFieldValue(ruleAdultEmojiThreshold, 2);
      setFieldValue(ruleAdultEmojiDensity, 0.4);
      setFieldChecked(ruleAdultEmojiSticker, true);
      setFieldChecked(ruleAdultEmojiCaptions, true);
      setFieldValue(ruleAdultEmojiAction, "delete_and_warn");

      setFieldChecked(ruleButtonEnabled, true);
      setFieldChecked(ruleButtonInline, true);
      setFieldChecked(ruleButtonViaBot, true);
      setFieldChecked(ruleButtonText, true);
      setFieldValue(ruleButtonAction, "delete_and_warn");

      setFieldChecked(rulePreviewEnabled, true);
      setFieldChecked(rulePreviewWeb, true);
      setFieldValue(rulePreviewAction, "delete_and_warn");

      setFieldChecked(ruleRaidEnabled, true);
      setFieldValue(ruleRaidLimit, 10);
      setFieldValue(ruleRaidInterval, 10);
      setFieldValue(ruleRaidAction, "restrict");

      setFieldChecked(ruleCaptchaEnabled, true);
      setFieldValue(ruleCaptchaTimeout, 90);
      setFieldValue(ruleCaptchaAttempts, 2);
      setFieldChecked(ruleCaptchaKick, true);

      setFieldChecked(ruleCasEnabled, true);
      setFieldValue(ruleCasAction, "ban");

      setFieldChecked(ruleNameFilterEnabled, true);
      setFieldValue(ruleNameFilterAction, "ban");

      setFieldChecked(ruleSenderChatEnabled, true);
      setFieldValue(ruleSenderChatAction, "delete_and_warn");

      setFieldChecked(ruleZalgoEnabled, true);
      setFieldValue(ruleZalgoMax, 30);
      setFieldChecked(ruleZalgoRtl, true);
      setFieldValue(ruleZalgoAction, "delete_and_warn");

      showToast("Applied Balanced Guard preset. Review rules below, then click Save All Rules.", "success");
    });
  }

  if (btnPresetStrict) {
    btnPresetStrict.addEventListener('click', () => {
      setFieldChecked(ruleSilentEnabled, false);
      setFieldChecked(ruleSilentWelcome, false);
      setFieldChecked(ruleSilentAnnouncements, false);
      setFieldChecked(ruleSilentActionNotices, false);
      setFieldChecked(ruleSilentCaptcha, false);

      setFieldChecked(ruleWelcomeEnabled, true);
      setFieldValue(ruleWelcomeText, "Welcome to our group, {username}! 🔒 Solve the captcha or be kicked.");
      setFieldValue(ruleWelcomeDelete, 15);

      setFieldChecked(ruleSpamEnabled, true);
      setFieldValue(ruleSpamMax, 3);
      setFieldValue(ruleSpamInterval, 4000);
      setFieldValue(ruleSpamDuplicate, 2);
      setFieldValue(ruleSpamAction, "mute");

      setFieldChecked(ruleLinkEnabled, true);

      setFieldChecked(ruleLinkStrict, true);
      setFieldChecked(ruleLinkEnforceAdmins, true);
      setFieldValue(ruleLinkAction, "ban");

      setFieldChecked(ruleProfanityEnabled, true);
      setFieldChecked(ruleProfanityEnforceAdmins, true);
      setFieldValue(ruleProfanityAction, "ban");

      setFieldChecked(ruleForwardEnabled, true);
      setFieldChecked(ruleForwardChannels, true);
      setFieldChecked(ruleForwardUsers, true);
      setFieldChecked(ruleForwardHidden, true);
      setFieldValue(ruleForwardAction, "ban");

      setFieldChecked(ruleMentionEnabled, true);
      setFieldChecked(ruleMentionChannels, true);
      setFieldChecked(ruleMentionUsers, true);
      setFieldValue(ruleMentionAction, "ban");

      setFieldChecked(ruleMediaEnabled, true);
      setFieldChecked(ruleMediaCaptions, true);
      setFieldChecked(ruleMediaFilenames, true);
      setFieldChecked(ruleMediaStickerEmoji, true);
      setFieldChecked(ruleMediaBlockStickers, true);
      setFieldChecked(ruleMediaBlockGifs, true);
      setFieldChecked(ruleMediaBlockVideoNotes, true);
      setFieldChecked(ruleMediaBlockPhotos, true);
      setFieldChecked(ruleMediaBlockVideos, true);
      setFieldChecked(ruleMediaBlockDocuments, true);
      setFieldChecked(ruleMediaBlockVoice, true);
      setFieldChecked(ruleMediaRequireCaption, true);
      setFieldValue(ruleMediaMinCaption, 10);
      setFieldValue(ruleMediaAction, "ban");

      setFieldChecked(rulePremiumEnabled, true);
      setFieldChecked(rulePremiumEnforceAdmins, true);
      setFieldChecked(rulePremiumAll, true);
      setFieldChecked(rulePremiumVideo, true);
      setFieldChecked(rulePremiumAnimated, true);
      setFieldValue(rulePremiumAction, "ban");

      setFieldChecked(ruleAdultEmojiEnabled, true);
      setFieldValue(ruleAdultEmojiThreshold, 1);
      setFieldValue(ruleAdultEmojiDensity, 0.2);
      setFieldChecked(ruleAdultEmojiSticker, true);
      setFieldChecked(ruleAdultEmojiCaptions, true);
      setFieldValue(ruleAdultEmojiAction, "ban");

      setFieldChecked(ruleButtonEnabled, true);
      setFieldChecked(ruleButtonInline, true);
      setFieldChecked(ruleButtonViaBot, true);
      setFieldChecked(ruleButtonText, true);
      setFieldValue(ruleButtonAction, "ban");

      setFieldChecked(rulePreviewEnabled, true);
      setFieldChecked(rulePreviewWeb, true);
      setFieldValue(rulePreviewAction, "ban");

      setFieldChecked(ruleRaidEnabled, true);
      setFieldValue(ruleRaidLimit, 5);
      setFieldValue(ruleRaidInterval, 10);
      setFieldValue(ruleRaidAction, "restrict");

      setFieldChecked(ruleCaptchaEnabled, true);
      setFieldValue(ruleCaptchaTimeout, 60);
      setFieldValue(ruleCaptchaAttempts, 1);
      setFieldChecked(ruleCaptchaKick, true);

      setFieldChecked(ruleCasEnabled, true);
      setFieldValue(ruleCasAction, "ban");

      setFieldChecked(ruleNameFilterEnabled, true);
      setFieldValue(ruleNameFilterAction, "ban");

      setFieldChecked(ruleSenderChatEnabled, true);
      setFieldValue(ruleSenderChatAction, "ban");

      setFieldChecked(ruleZalgoEnabled, true);
      setFieldValue(ruleZalgoMax, 15);
      setFieldChecked(ruleZalgoRtl, true);
      setFieldValue(ruleZalgoAction, "ban");

      showToast("Applied Strict Guard preset. Review rules below, then click Save All Rules.", "success");
    });
  }
  // Category tabs filtering inside Moderation Rules
  const categoryButtons = document.querySelectorAll('.category-btn');
  const rulesCards = document.querySelectorAll('.rules-card');

  function filterRulesByCategory(category) {
    rulesCards.forEach(card => {
      if (card.getAttribute('data-rule-category') === category) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  categoryButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.getAttribute('data-category');
      filterRulesByCategory(category);
    });
  });

  // Initialize display with the default category ('welcome')
  filterRulesByCategory('welcome');

  // Auto trigger check (auth first, then bot status)
  bootstrap();
});
