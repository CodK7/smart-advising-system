/**
 * PM2 configuration for the single-process local stack.
 *
 * Express serves the API and mounts Vite as middleware, so there is one app
 * process rather than separate frontend and backend services. The embedded
 * SQLite database is prepared by `npm run db:ensure` before PM2 is started.
 */
module.exports = {
  apps: [
    {
      name: 'advising-app',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server.ts',
      cwd: __dirname,
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 1000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'development',
        PORT: '5173',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '5173',
      },
      error_file: 'logs/advising-error.log',
      out_file: 'logs/advising-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
