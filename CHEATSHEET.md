# OctoGod — Quick Reference

Your bot runs on an Oracle Cloud VM, 24/7. This card covers everyday tasks.

| Thing | Value |
|---|---|
| VM address | `68.233.98.16` |
| SSH user | `ubuntu` |
| Key file | `ssh-key-2026-08-17.key` (in this folder — **back it up!**) |
| Dashboard login | `saroj` |

**Use PowerShell, not CMD.** Open it inside this folder: Shift + right-click in
File Explorer → *Open PowerShell window here*.

---

## The two commands you'll actually use

### Open the dashboard
```powershell
ssh -i .\ssh-key-2026-08-17.key -L 3000:127.0.0.1:3000 ubuntu@68.233.98.16
```
Leave the window open, then browse to <http://127.0.0.1:3000>.
Closing the window closes the dashboard.

### Log in to the server
```powershell
ssh -i .\ssh-key-2026-08-17.key ubuntu@68.233.98.16
```
Type `exit` to return to your PC.

> **Which machine am I on?**
> `PS C:\...>` = your PC.  `ubuntu@octogod:~$` = the VM.

---

## Commands to run ON THE VM (after connecting)

| Task | Command |
|---|---|
| Is the bot running? | `pm2 status` |
| Watch live activity | `pm2 logs octogod` (`Ctrl+C` to stop watching) |
| Last 50 log lines | `pm2 logs octogod --lines 50 --nostream` |
| Restart the bot | `pm2 restart octogod` |
| Stop the bot | `pm2 stop octogod` |
| Start it again | `pm2 start octogod` |
| Deploy code updates | `cd ~/octogod && git pull && npm install --omit=dev && pm2 restart octogod` |
| Free memory / disk | `free -m` / `df -h` |
| Back up your data | `cd ~ && tar czf backup-$(date +%F).tgz octogod/db octogod/.env` |

---

## Telegram admin commands (typed in your groups)

| Command | Effect |
|---|---|
| `/nuke` (reply) | Bans the user **and deletes every message they ever posted** — use this for spam the bot missed |
| `/ban` (reply) | Ban this user |
| `/unban` (reply) | Unban |
| `/del` (reply) | Delete just that one message |
| `/purge` (reply) | Delete everything from that message down to your command |
| `/stats` | Moderation counters |
| `/status` | Which rules are enabled |
| `/help` | Full command list |

---

## Rules of thumb

1. **Never run the bot on your PC again.** Telegram allows one connection per bot
   token — a second copy causes `409 Conflict` and neither works.
2. **Guard the key file.** It's the only way into the VM; Oracle cannot reissue it.
   It is excluded from git on purpose.
3. **Quote paths with spaces:** `cd "C:\Users\-CEO-\Downloads\Telegram Bot"`
4. **Linux is case-sensitive**, Windows isn't. On the VM `PM2` ≠ `pm2`.

---

## If something looks wrong

| Symptom | Fix |
|---|---|
| Dashboard won't load | The SSH tunnel window must stay open. |
| `UNPROTECTED PRIVATE KEY FILE` | `icacls .\ssh-key-2026-08-17.key /inheritance:r /grant:r "$($env:USERNAME):(R)"` |
| `409 Conflict` in logs | A second copy is running somewhere — stop it. |
| Bot sees no messages | Privacy Mode got re-enabled: @BotFather → Bot Settings → Group Privacy → Turn **off**, then remove & re-add the bot to each group. |
| "Could not delete/ban" | The bot isn't an admin in that group, or lacks *Delete Messages* / *Ban Users*. |
| Bot seems dead | `pm2 status`; if stopped, `pm2 restart octogod` and check `pm2 logs octogod`. |
