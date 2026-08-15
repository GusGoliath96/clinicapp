// PM2 — gerencia a API (backend) e o frontend do ClinicaApp num só lugar.
//
//   pm2 start ecosystem.config.cjs      # sobe os dois
//   pm2 status                          # ver estado
//   pm2 logs                            # logs ao vivo (ou: pm2 logs clinicapp-api)
//   pm2 restart all | pm2 stop all
//   pm2 save && pm2 startup             # persistir entre reboots
//
// Requer PM2 global:  npm install -g pm2

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'clinicapp-api',
      cwd: path.join(__dirname, 'backend'),
      script: 'src/index.js',          // Node ESM; config lida do backend/.env (dotenv)
      exec_mode: 'fork',
      instances: 1,
      watch: false,                    // p/ hot-reload em dev use: npm run dev
      max_memory_restart: '300M',
      time: true,                      // timestamp nos logs
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
    },
    {
      name: 'clinicapp-web',
      cwd: path.join(__dirname, 'frontend'),
      // Chama o binário do Vite diretamente (evita processo órfão do 'npm run').
      script: 'node_modules/vite/bin/vite.js',
      args: '--host --port 5173',
      watch: false,
      time: true,
      env: {
        NODE_ENV: 'development',        // servidor de dev do Vite
      },
    },
  ],
};

// Produção do frontend: em vez do dev server, gere o build estático
//   cd frontend && npm run build
// e sirva o dist/ (ex.: `pm2 serve frontend/dist 5173 --spa --name clinicapp-web`)
// ou por um Nginx/Caddy na frente.
