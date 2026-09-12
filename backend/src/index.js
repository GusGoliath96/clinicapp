// Faz rejeições de handlers async chegarem ao handler de erro. Sem isto, no Express 4,
// uma falha de banco dentro de uma rota async não vira 500: a requisição fica pendurada
// até o cliente desistir. Precisa vir antes de qualquer rota.
import 'express-async-errors';

import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { uploadsDir } from './config/paths.js';
import { requireAuth } from './middleware/auth.js';
import { requirePapel } from './middleware/requirePapel.js';
import { authOrService } from './middleware/serviceAuth.js';
import { limiteAuth, limparAntigos } from './middleware/rateLimit.js';
import { initSocket } from './realtime/socket.js';

import authRoutes from './routes/auth.js';
import professionalsRoutes from './routes/professionals.js';
import patientsRoutes from './routes/patients.js';
import tenantRoutes from './routes/tenant.js';
import usersRoutes from './routes/users.js';
import conveniosRoutes from './routes/convenios.js';
import appointmentsRoutes from './routes/appointments.js';
import blocksRoutes from './routes/blocks.js';
import documentsRoutes from './routes/documents.js';
import examsRoutes from './routes/exams.js';
import treatmentsRoutes from './routes/treatments.js';
import clinicalNotesRoutes from './routes/clinical-notes.js';
import catalogRoutes from './routes/catalog.js';
import conversationsRoutes from './routes/conversations.js';
import messagesRoutes from './routes/messages.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();

// Atrás do Caddy todo request chega de 127.0.0.1. Sem isto, req.ip é sempre o proxy e o
// limite por IP contaria a clínica inteira como um só cliente. É 1 (confia só no salto
// imediato) e não true, que aceitaria qualquer X-Forwarded-For forjado.
app.set('trust proxy', 1);

app.use(helmet({
  // A API não serve HTML; o CSP padrão do helmet só atrapalharia os PDFs de /uploads.
  contentSecurityPolicy: false,
  hsts: env.producao ? { maxAge: 15_552_000, includeSubDomains: true } : false,
}));

// credentials: o cookie de dispositivo confiável do 2FA só é enviado numa requisição
// cross-origin (app.dominio -> api.dominio) se ambos os lados o permitirem.
app.use(cors({ origin: env.corsOrigin, credentials: true }));

// Webhook do motor de IA é público (sem JWT) e valida o corpo BRUTO (assinatura HMAC).
// Montado ANTES do express.json global para o express.raw da rota ver o body intacto.
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '20mb' })); // limite maior p/ upload de PDF (base64)

// Arquivos enviados (PDFs de exames etc.). Nomes são UUID não-adivinháveis.
// LGPD: em produção, servir atrás de autenticação/URL assinada.
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Auth (login público; /me protegido internamente).
// cookie-parser só aqui: o cookie de dispositivo tem Path=/auth e não existe no resto da API.
app.use('/auth', limiteAuth, cookieParser(), authRoutes);

// Rotas protegidas por JWT + escopo de tenant.
// /professionals, /patients e /appointments aceitam o token de serviço do motor
// (tools do fluxo: listar profissionais, achar paciente, ver disponibilidade, marcar) OU o JWT.
app.use('/professionals', authOrService, professionalsRoutes);
app.use('/patients', authOrService, patientsRoutes);
app.use('/tenant', requireAuth, tenantRoutes);
// Só admin: estas rotas criam usuários, trocam senhas e atribuem papéis.
app.use('/users', requireAuth, requirePapel('admin'), usersRoutes);
app.use('/convenios', requireAuth, conveniosRoutes);
app.use('/appointments', authOrService, appointmentsRoutes);
app.use('/blocks', requireAuth, blocksRoutes);
app.use('/documents', requireAuth, documentsRoutes);
app.use('/exams', requireAuth, examsRoutes);
app.use('/treatments', requireAuth, treatmentsRoutes);
app.use('/clinical-notes', requireAuth, clinicalNotesRoutes);
app.use('/catalog', requireAuth, catalogRoutes);
app.use('/conversations', requireAuth, conversationsRoutes);
app.use('/messages', requireAuth, messagesRoutes);

// Handler de erro genérico. Middlewares como o body-parser já marcam o próprio status
// (JSON malformado é 400); tratar tudo como 500 escondia do cliente que o erro era dele.
// A mensagem nunca é repassada: ela costuma trazer detalhe interno.
app.use((err, _req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error('[erro]', err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : 'Requisição inválida' });
});

// login_attempts cresce a cada tentativa e os desafios de 2FA/reset viram lixo ao expirar.
limparAntigos();
setInterval(limparAntigos, 6 * 60 * 60 * 1000).unref();

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  console.log(`[clinicapp] backend em http://localhost:${env.port}`);
});
