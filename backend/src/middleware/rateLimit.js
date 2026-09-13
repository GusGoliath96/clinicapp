import rateLimit from 'express-rate-limit';
import { query } from '../config/db.js';

// Camada 1 — por IP, em memória. Barata e imediata: corta varredura automatizada antes de
// qualquer bcrypt. Um restart do processo zera a contagem, e é justamente por isso que as
// camadas 2 e 3 vivem no banco.
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um minuto e tente de novo.' },
});

const PAIR_MAX = 5;        // falhas por (e-mail, IP)
const PAIR_WINDOW = 15;    // minutos
const EMAIL_MAX = 30;      // falhas no mesmo e-mail, de qualquer IP
const EMAIL_WINDOW = 60;   // minutos

const minutesUntil = (since, windowMinutes) =>
  Math.max(1, Math.ceil((new Date(since).getTime() + windowMinutes * 60_000 - Date.now()) / 60_000));

// Camadas 2 e 3 — contagem persistente, só das falhas posteriores ao último login bem
// sucedido (entrar de verdade limpa o histórico).
//
// A chave principal é o par (e-mail, IP), não o e-mail sozinho: se bastasse o e-mail,
// qualquer um poderia trancar a conta do admin de fora, e o bloqueio viraria o ataque.
// O limite só por e-mail existe para o caso distribuído, e por isso é bem mais folgado.
export async function checkLockout(email, ip) {
  const { rows } = await query(
    `WITH last_success AS (
       SELECT COALESCE(MAX(created_at), 'epoch'::timestamptz) AS at
         FROM login_attempts WHERE email = $1 AND success
     ),
     failures AS (
       SELECT a.created_at, a.ip
         FROM login_attempts a, last_success s
        WHERE a.email = $1 AND NOT a.success AND a.created_at > s.at
     )
     SELECT
       count(*) FILTER (WHERE ip = $2 AND created_at > now() - interval '15 minutes') AS pair_count,
       min(created_at) FILTER (WHERE ip = $2 AND created_at > now() - interval '15 minutes') AS pair_since,
       count(*) FILTER (WHERE created_at > now() - interval '60 minutes') AS email_count,
       min(created_at) FILTER (WHERE created_at > now() - interval '60 minutes') AS email_since
       FROM failures`,
    [email, ip],
  );

  const r = rows[0];
  if (Number(r.pair_count) >= PAIR_MAX) {
    return { locked: true, minutes: minutesUntil(r.pair_since, PAIR_WINDOW) };
  }
  if (Number(r.email_count) >= EMAIL_MAX) {
    return { locked: true, minutes: minutesUntil(r.email_since, EMAIL_WINDOW) };
  }
  return { locked: false };
}

// Falha ao gravar o histórico não pode derrubar o login, então o erro morre aqui.
export function recordAttempt({ email, ip, success = false, reason = null, userId = null, tenantId = null }) {
  return query(
    `INSERT INTO login_attempts (email, ip, success, reason, user_id, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email, ip, success, reason, userId, tenantId],
  ).catch((e) => console.error('[rateLimit] não registrou a tentativa:', e.message));
}

// Chamado periodicamente pelo index.js. login_attempts cresce sem parar e auth_challenges
// acumula códigos mortos.
export async function purgeExpired() {
  try {
    await query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'");
    await query("DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'");
    await query("DELETE FROM trusted_devices WHERE expires_at < now() - interval '1 day'");
  } catch (e) {
    console.error('[limpeza] falhou:', e.message);
  }
}
