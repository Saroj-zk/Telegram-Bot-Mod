# One-command deploy: push local changes to GitHub, then update the VM.
#
#   .\deploy.ps1 "what I changed"
#
# Pushing to GitHub alone does NOT update the bot - the VM keeps running its own
# copy of the code until it pulls. This script does both halves.
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI,
# and accented/dash characters break string parsing.

param(
  [string]$Message = "Update bot"
)

$KEY = ".\octogod.key"
$VM  = "ubuntu@68.233.98.16"

Write-Host ""
Write-Host "=== 1/3  Pushing to GitHub ===" -ForegroundColor Cyan

git add -A

# Refuse to continue if secrets somehow got staged.
$staged = git diff --cached --name-only
if ($staged -match '^\.env$' -or $staged -match '^db/') {
  Write-Host "ABORT: .env or db/ is staged - those hold your bot token and password." -ForegroundColor Red
  git reset | Out-Null
  exit 1
}

if (-not $staged) {
  Write-Host "No local changes to commit - will still refresh the VM." -ForegroundColor Yellow
} else {
  git commit -q -m $Message
  Write-Host "Committed: $Message"
}

git push -q
Write-Host "Pushed to GitHub." -ForegroundColor Green

Write-Host ""
Write-Host "=== 2/3  Updating the VM ===" -ForegroundColor Cyan
ssh -i $KEY -o StrictHostKeyChecking=no $VM 'cd ~/octogod && git pull -q && npm install --omit=dev --no-audit --no-fund --silent && pm2 restart octogod --update-env'
if ($LASTEXITCODE -ne 0) {
  Write-Host "VM update failed - check the output above." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== 3/3  Verifying ===" -ForegroundColor Cyan
Start-Sleep -Seconds 6
ssh -i $KEY -o StrictHostKeyChecking=no $VM 'pm2 logs octogod --lines 12 --nostream 2>/dev/null | grep -v "^$" | tail -12'

Write-Host ""
Write-Host "Done. If you see 'is online and watching', the new code is live." -ForegroundColor Green
