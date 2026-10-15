// PM2 process definition. Reuses the existing PM2 infrastructure alongside the
// whatsapp-service and CRM processes.
//
//   pm2 start ecosystem.config.js
//   pm2 save
module.exports = {
  apps: [
    {
      name: 'catalygn-content-service',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      // One instance only: a second would double-arm the cron. Idempotency in
      // publisher.ts would still prevent a duplicate send, but 1 is correct.
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
