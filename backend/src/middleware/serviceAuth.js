import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAuth } from './auth.js';

// Autenticação de SERVIÇO (máquina-a-máquina). As tools do fluxo do motor de IA chamam
// rotas de negócio do ClinicaApp (/patients, /appointments) sem um login humano: apresentam
// um token fixo (SERVICE_API_KEY) e recebem escopo de tenant.
//
// Como hoje o sistema é single-clinic, o tenant é resolvido como o primeiro (o mesmo critério
// do webhook). req.user fica sem id de usuário (role 'service'); as colunas sent_by e
// assignee_id são NULLABLE, então os inserts continuam válidos.

function serviceToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function matchesServiceKey(token) {
  const expected = env.serviceApiKey;
  if (!expected || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function resolveTenant() {
  const { rows } = await query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
  return rows[0]?.id || null;
}

// Aceita o token de serviço; se não bater, cai no JWT de usuário normal (requireAuth).
export async function authOrService(req, res, next) {
  const token = serviceToken(req);
  if (matchesServiceKey(token)) {
    const tenantId = await resolveTenant();
    if (!tenantId) return res.status(503).json({ error: 'Nenhum tenant configurado' });
    req.user = { id: null, tenantId, role: 'service' };
    return next();
  }
  return requireAuth(req, res, next);
}
