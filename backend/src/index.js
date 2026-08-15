import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { uploadsDir } from './config/paths.js';
import { requireAuth } from './middleware/auth.js';
import { authOrService } from './middleware/serviceAuth.js';
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
app.use(cors({ origin: env.corsOrigin }));

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
app.use('/auth', authRoutes);

// Rotas protegidas por JWT + escopo de tenant.
// /professionals, /patients e /appointments aceitam o token de serviço do motor
// (tools do fluxo: listar profissionais, achar paciente, ver disponibilidade, marcar) OU o JWT.
app.use('/professionals', authOrService, professionalsRoutes);
app.use('/patients', authOrService, patientsRoutes);
app.use('/tenant', requireAuth, tenantRoutes);
app.use('/users', requireAuth, usersRoutes);
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

// Handler de erro genérico.
app.use((err, _req, res, _next) => {
  console.error('[erro]', err);
  res.status(500).json({ error: 'Erro interno' });
});

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  console.log(`[clinicapp] backend em http://localhost:${env.port}`);
});
