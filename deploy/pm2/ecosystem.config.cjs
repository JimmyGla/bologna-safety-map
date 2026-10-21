// pm2 alternative to the systemd unit (any OS with Node 20+).
//
//   npm i -g pm2
//   pm2 start deploy/pm2/ecosystem.config.cjs
//   pm2 logs bsm-worker          # JSON logs (pino)
//   pm2 save && pm2 startup      # restart on boot (prints the command to run once)
//
// Secrets are read from .env.local in the repo root, as in development.

module.exports = {
  apps: [
    {
      name: "bsm-worker",
      // Repo root (this file lives in deploy/pm2/).
      cwd: `${__dirname}/../..`,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/index.ts",
      interpreter: "node",
      autorestart: true,
      restart_delay: 10_000,
      max_memory_restart: "700M",
      kill_timeout: 20_000,
      time: true,
      env: { NODE_ENV: "production" },
    },
  ],
};
