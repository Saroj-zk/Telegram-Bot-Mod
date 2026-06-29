# 🛡️ OctoGod - Telegram Group Moderation Bot

OctoGod is a premium, self-contained Telegram group moderation bot coupled with a beautiful, real-time, glassmorphic web dashboard. It helps you keep your Telegram community clean, safe, and engaging by automating welcome messages, rate limiting spammers, blockading unauthorized external link drops, filtering profanity/scams, and detecting mass-joining raid attacks.

---

## 🌟 Key Features

1. **🚀 Visual Setup Wizard**: Don't edit text configuration files! If the bot boots up without a token, the dashboard redirects you to a beautiful web setup screen to input your Bot Token.
2. **👋 Welcome Message Automator**: Send customizable welcome messages replacing placeholders like `{username}`, `{firstname}`, and `{groupname}`. Delete greetings automatically after $X$ seconds to keep the group history clean.
3. **⚡ Anti-Spam (Rate Limiter)**: Constrain message frequency per user. Automatically delete bursts and apply warnings, temporary 30-minute mutes, kicks, or bans.
4. **🔗 Link Moderation**: Automatically delete external links or Telegram group invites sent by non-administrators, and warn or ban offenders.
5. **🚫 Profanity & Scam Filter**: Scan messages against a configurable keyword blacklist. Match and purge scam triggers or offensive content immediately.
6. **🚨 Anti-Raid Mode**: Actively monitor join patterns. If join volume exceeds limits (e.g. 10 joins in 10 seconds), lock chat features and restrict new members to read-only mode to prevent flood raids.
7. **📊 Real-time Dashboard Panel**: Clean dark-mode metrics dashboard showing messages processed, spam blocked, warnings issued, and logs streamed live via WebSockets.

---

## 🛠️ Prerequisites

- **Node.js** (v18 or higher recommended; tested on v24)
- **npm** (v9 or higher; tested on v11)

---

## 📦 Installation & Setup

1. **Extract or Clone** this repository to your computer.
2. Open a terminal in the project directory and install the packages:
   ```bash
   npm install
   ```

---

## 🚀 Running OctoGod

Start the web server and the bot engine:
```bash
npm run dev
```

Once launched, the console will log:
```
[INFO] Dashboard server listening on http://127.0.0.1:3000
[WARN] No TELEGRAM_BOT_TOKEN found. Booting in Setup Mode.
```

1. Open **[http://127.0.0.1:3000](http://127.0.0.1:3000)** in your browser.
2. You will be greeted by the **Create Admin Account** screen on first run. Pick a strong username + password (min 8 chars). This is the only login that can configure the bot.
3. On every subsequent launch you'll see the **Sign In** screen. Sessions last 7 days of inactivity, or until the server is restarted.
4. After login, paste your Telegram Bot Token (generate one via [@BotFather](https://t.me/BotFather)) and click **Save & Initialize**.
5. The dashboard will then show the live monitor console.

### Optional environment variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port for the dashboard. |
| `DASHBOARD_HOST` | `127.0.0.1` | Bind interface. Keep `127.0.0.1` so the dashboard is **only reachable from this machine**. Set to `0.0.0.0` only if you have a TLS reverse proxy in front. |
| `TELEGRAM_OWNER_ID` | _(unset)_ | Telegram user id that may DM the bot. Without this, the bot ignores **all** private chats. Group admins are always handled normally. |
| `TRUSTED_PROXY` | `false` | Set `true` if running behind HTTPS proxy (enables `Secure` cookie flag). |
| `DASHBOARD_ORIGIN` | _(unset)_ | Allow CORS from this origin. Leave unset for same-origin only. |

---

## 👮 Admin Group Commands

Add the bot to your Telegram group and promote it to **Administrator** with **Delete Messages** and **Ban Users** permissions. Admins can then run these commands inside the group:

| Command | Action |
| :--- | :--- |
| `/warn <reply\|@username>` | Warns a user. After 3 warnings, the user is banned. |
| `/clearwarns <reply\|@username>` | Resets a user's warnings back to 0. |
| `/mute <reply\|@username> [mins]` | Restricts a user from typing. Defaults to 60 minutes. |
| `/unmute <reply\|@username>` | Restores writing permissions to a muted user. |
| `/kick <reply\|@username>` | Removes a user from the group (they can rejoin via links). |
| `/ban <reply\|@username>` | Bans a user permanently from the group. |
| `/status` | Returns active security rules and raid status in the chat. |
| `/unraid` | Manually deactivates active Raid Restrict Mode. |

*Note: The bot indexes username-to-ID mappings. Users must send at least one message while the bot is active to enable banning by `@username`. Replying directly to a user's message always works immediately.*

---

## ⚙️ Configuration Customization

On the **Moderation Rules** tab on the Web Dashboard, you can customize:
- Welcome message greeting templates & delete times.
- Spam burst levels (e.g., 5 messages in 3 seconds) and the action penalty.
- Custom profanity word lists separated by commas (e.g. `scam, crypto, porn`).
- Anti-raid join thresholds.
- Save settings instantly; no restart is required.
