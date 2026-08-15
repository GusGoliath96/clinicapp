// PM2 de PRODUÇÃO da VM — sobe os dois sistemas num só lugar.
//
//   pm2 start deploy/ecosystem.prod.cjs
//   pm2 save && pm2 startup      # persistir entre reboots (rode o comando que o startup imprimir)
//   pm2 status | pm2 logs
//
// Diferenças para os ecosystems de desenvolvimento de cada repo:
//   - NÃO sobe o Vite dev server do ClinicaApp: o Caddy serve o frontend/dist estático.
//   - O painel do motor roda `next start` (build de produção), não `next dev`.
//   - Tudo escuta em localhost; quem fala com a internet é só o Caddy.
//
// Pré-requisitos (ver deploy/README.md): `npm run build` nos dois frontends e os .env
// de produção preenchidos.

const path = require('path');

// Raiz do repositório (este arquivo mora em <repo>/deploy/), resolvida em tempo de
// execução: funciona igual em /home/gus/... no dev e em /opt/... na VM.
const SISTEMA = path.resolve(__dirname, '..');
const AI_AGENT = process.env.AI_AGENT_DIR || '/home/gus/Documentos/ai_agent';

module.exports = {
  apps: [
    {
      name: 'clinicapp-api',
      cwd: path.join(SISTEMA, 'backend'),
      script: 'src/index.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '400M',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
      },
    },
    {
      name: 'motor-api',
      cwd: path.join(AI_AGENT, 'apps/api'),
      script: 'src/server.js',
      time: true,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'motor-worker',
      cwd: path.join(AI_AGENT, 'apps/api'),
      script: 'src/worker/index.js',
      time: true,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
    {
      // Telegram (long-poll) e sessões open-wa. O login por QR do WhatsApp não-oficial
      // aparece em `pm2 logs motor-channels`.
      name: 'motor-channels',
      cwd: path.join(AI_AGENT, 'apps/api'),
      script: 'src/channels/index.js',
      time: true,
      max_memory_restart: '800M',
      env: { NODE_ENV: 'production', WHATSAPP_LIB_LOG: 'warn' },
    },
    {
      // Painel de administração do motor. Escuta em 127.0.0.1 de propósito: não é publicado
      // pelo Caddy, o acesso é pela VPN (Tailscale) ou pela rede local.
      name: 'motor-web',
      cwd: path.join(AI_AGENT, 'apps/web'),
      script: path.join(AI_AGENT, 'node_modules/next/dist/bin/next'),
      args: 'start -p 3000 -H 127.0.0.1',
      time: true,
      env: {
        NODE_ENV: 'production',
        API_URL: 'http://localhost:4000',
      },
    },
  ],
};
