// PM2 process definition — keeps OctoGod running 24/7.
//
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup      # survive reboots
//   pm2 logs octogod             # live logs
//
// Only ONE instance may ever run: Telegram allows a single polling connection
// per bot token, so a second copy causes 409 Conflict errors. Hence no cluster
// mode and no `instances: > 1`.
module.exports = {
  apps: [{
    name: 'octogod',
    script: 'server.js',
    cwd: __dirname,

    instances: 1,
    exec_mode: 'fork',        // NOT cluster — see note above
    autorestart: true,
    watch: false,             // don't restart on file writes (db/ changes constantly)
    max_memory_restart: '400M',

    // Back off instead of hot-looping if it crashes on boot (e.g. bad token).
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    min_uptime: '30s',
    max_restarts: 20,

    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // Bind to loopback only. The dashboard is reached through an SSH tunnel,
      // so nothing is exposed to the public internet.
      DASHBOARD_HOST: '127.0.0.1'
    },

    // Logs (rotate with: pm2 install pm2-logrotate)
    output: './logs/pm2-out.log',
    error: './logs/pm2-error.log',
    merge_logs: true,
    time: true
  }]
};
