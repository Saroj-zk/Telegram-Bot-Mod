# Deploying OctoGod to an Oracle Cloud Always-Free VM

Runs the bot 24/7 for **$0/month**, so it never misses spam while your PC is off.

> **Why this matters:** Telegram only stores ~24h of missed messages. Anything
> posted while the bot is down longer than that can never be auto-deleted.

---

## 1. Create the free VM (~10 min)

1. Sign up at <https://cloud.oracle.com> → choose **Always Free** eligible region.
   *A card is required for identity verification; the Always Free resources are not charged.*
2. **Compute → Instances → Create Instance**
3. Settings:
   - **Image:** Canonical **Ubuntu 22.04** (or 24.04)
   - **Shape:** `VM.Standard.A1.Flex` (ARM) — set **1 OCPU / 6 GB RAM**
     *(Always Free allows up to 4 OCPU / 24 GB. If ARM capacity is unavailable in
     your region, use `VM.Standard.E2.1.Micro` (AMD) instead — plenty for this bot.)*
   - **SSH keys:** choose **Generate a key pair** and **download the private key**
4. Click **Create**, then copy the instance's **Public IP address**.

> **No inbound ports are needed.** The bot only makes outbound calls to Telegram,
> and the dashboard stays on `127.0.0.1`, reached via an SSH tunnel (step 6).
> Leave Oracle's default security rules alone — that's the safest setup.

---

## 2. Connect over SSH

On Windows (PowerShell), from the folder holding the downloaded key:

```powershell
# Lock down key permissions (SSH refuses world-readable keys)
icacls .\ssh-key.key /inheritance:r /grant:r "$($env:USERNAME):(R)"

ssh -i .\ssh-key.key ubuntu@YOUR_PUBLIC_IP
```

---

## 3. Install Node.js + PM2 (on the VM)

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm install -g pm2
node -v          # expect v22.x
```

---

## 4. Get the code onto the VM

```bash
git clone https://github.com/Saroj-zk/Telegram-Bot-Mod.git ~/octogod
cd ~/octogod
npm install --omit=dev
mkdir -p logs
```

---

## 5. Move your secrets & data across ⚠️

`db/` and `.env` are **deliberately excluded from git** (they hold your bot token,
admin password hash and ban history). Copy them directly.

**From your Windows PC** (new PowerShell window, in the project folder):

```powershell
scp -i .\ssh-key.key -r ".\db" ubuntu@YOUR_PUBLIC_IP:~/octogod/
scp -i .\ssh-key.key ".\.env"  ubuntu@YOUR_PUBLIC_IP:~/octogod/
```

Then **back on the VM**, tighten permissions and clear stale runtime state:

```bash
cd ~/octogod
chmod 600 .env db/admin.json db/bots.json db/sessions.json
rm -f db/.octogod.lock          # lock from the old machine
rm -f db/heartbeat.json         # avoids a false "offline for N days" warning
```

---

## 6. ⛔ Stop the bot on your PC first

Two copies polling one token causes `409 Conflict` and neither works reliably.

On Windows:

```powershell
taskkill /IM node.exe /F
```

Then confirm it stays off — don't run `npm start` locally any more.

---

## 7. Start it under PM2

```bash
cd ~/octogod
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd      # prints a `sudo env PATH=...` line — run that line
```

Verify:

```bash
pm2 status
pm2 logs octogod --lines 30
```

Expect to see:

```
✅ @God_Raaka_Bot is online and watching the group.
🔓 Privacy mode is off — @God_Raaka_Bot can see all group messages.
```

---

## 8. Open the dashboard (SSH tunnel — no public exposure)

From your Windows PC:

```powershell
ssh -i .\ssh-key.key -L 3000:127.0.0.1:3000 ubuntu@YOUR_PUBLIC_IP
```

Leave that window open, then browse to <http://127.0.0.1:3000>.
Your existing admin username/password still work (they came over in `db/admin.json`).

---

## Day-to-day commands

| Task | Command (on the VM) |
|---|---|
| Status | `pm2 status` |
| Live logs | `pm2 logs octogod` |
| Restart | `pm2 restart octogod` |
| Stop | `pm2 stop octogod` |
| Update code | `cd ~/octogod && git pull && npm install --omit=dev && pm2 restart octogod` |
| Log rotation | `pm2 install pm2-logrotate` *(recommended, once)* |

### Back up your data

```bash
cd ~ && tar czf octogod-backup-$(date +%F).tgz octogod/db octogod/.env
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `409 Conflict` in logs | Another copy is polling the same token — stop the bot on your PC. |
| `OctoGod is already running (PID …)` | Stale lock: `rm ~/octogod/db/.octogod.lock` then `pm2 restart octogod` |
| Dashboard won't load | The SSH tunnel (step 8) must stay open. |
| Bot sees no messages | Privacy Mode is back on — @BotFather → Bot Settings → Group Privacy → **Turn off**, then remove & re-add the bot to each group. |
| "Could not delete/ban" | Bot isn't admin in that group, or lacks *Delete Messages* / *Ban Users*. |
| ARM shape unavailable | Try another Always-Free region, or use `VM.Standard.E2.1.Micro`. |
