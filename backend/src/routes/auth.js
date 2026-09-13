import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { verifyPassword, hashPassword, validatePolicy, DUMMY_HASH } from '../config/password.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { checkLockout, recordAttempt } from '../middleware/rateLimit.js';
import { sendTwoFactorCode, sendResetLink } from '../integrations/mailer.js';

// Todas as rotas daqui respondem 200, 400 ou 429 — nunca 401. O interceptor do axios
// redireciona para /login em qualquer 401, o que jogaria o usuário para fora da tela do
// código de verificação bem no meio do login.

const router = Router();

const DEVICE_COOKIE = 'cd_trust';
const DEVICE_DAYS = 30;
const TWO_FACTOR_MINUTES = 10;
const RESET_MINUTES = 30;
const MAX_ATTEMPTS = 5;

const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// O id da linha entra no hash: sem ele, duas linhas com o mesmo código de 6 dígitos teriam
// o mesmo hash, e uma tabela pré-calculada dos 10^6 códigos possíveis quebraria todos de
// uma só vez.
const hashSecret = (id, secret) => crypto.createHash('sha256').update(`${id}:${secret}`).digest('hex');

// Mesmo padrão de serviceAuth.js: confere o comprimento antes, depois compara sem revelar
// em que byte a diferença apareceu.
function matches(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

// O id é gerado aqui, e não pelo banco, porque ele precisa entrar no hash do segredo.
async function createChallenge({ kind, user, secret, minutes, ip }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO auth_challenges (id, tenant_id, user_id, kind, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6), $7)`,
    [id, user.tenant_id, user.id, kind, hashSecret(id, secret), minutes, ip],
  );
  return id;
}

// Incrementa e valida na mesma instrução: sem isso, várias requisições simultâneas leriam
// o mesmo contador e o limite de tentativas seria contornável.
async function consumeChallenge(id, kind) {
  if (!isUuid(id)) return null;
  const { rows } = await query(
    `UPDATE auth_challenges SET attempts = attempts + 1
      WHERE id = $1 AND kind = $2 AND used_at IS NULL
        AND expires_at > now() AND attempts < $3
      RETURNING *`,
    [id, kind, MAX_ATTEMPTS],
  );
  return rows[0] || null;
}

async function rememberDevice(req, res, user) {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const label = String(req.headers['user-agent'] || '').slice(0, 120) || null;

  await query(
    `INSERT INTO trusted_devices (id, tenant_id, user_id, token_hash, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [id, user.tenant_id, user.id, hashSecret(id, secret), label, DEVICE_DAYS],
  );

  res.cookie(DEVICE_COOKIE, `${id}.${secret}`, {
    httpOnly: true,
    secure: env.production,
    sameSite: 'lax',
    path: '/auth',
    maxAge: DEVICE_DAYS * 86_400_000,
  });
}

// A amarração com user_id é o que impede que o cookie de um usuário sirva para pular o
// segundo fator de outro.
async function isTrustedDevice(req, userId) {
  const [id, secret] = String(req.cookies?.[DEVICE_COOKIE] || '').split('.');
  if (!isUuid(id) || !secret) return false;

  const { rows } = await query(
    `SELECT token_hash FROM trusted_devices
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
    [id, userId],
  );
  if (!rows[0] || !matches(rows[0].token_hash, hashSecret(id, secret))) return false;

  await query('UPDATE trusted_devices SET last_used_at = now() WHERE id = $1', [id]);
  return true;
}

function findByEmail(email) {
  return query(
    'SELECT * FROM users WHERE lower(email) = $1 AND active = true ORDER BY created_at LIMIT 1',
    [email],
  );
}

async function completeLogin(res, user, ip) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  recordAttempt({
    email: user.email.toLowerCase(), ip, success: true, userId: user.id, tenantId: user.tenant_id,
  });
  res.json({
    status: 'ok',
    token: signToken(user),
    user: {
      id: user.id, nome: user.name, email: user.email,
      papel: user.role, professional_id: user.professional_id,
    },
  });
}

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.senha;
  const ip = req.ip || 'desconhecido';

  if (!email || !password) return res.status(400).json({ error: 'email e senha são obrigatórios' });

  const lockout = await checkLockout(email, ip);
  if (lockout.locked) {
    recordAttempt({ email, ip, reason: 'bloqueado' });
    res.set('Retry-After', String(lockout.minutes * 60));
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${lockout.minutes} minuto(s).`,
    });
  }

  const { rows } = await findByEmail(email);
  const user = rows[0];

  // O bcrypt roda mesmo quando o e-mail não existe: se só rodasse para usuários reais, a
  // diferença no tempo de resposta diria quais e-mails estão cadastrados.
  const passwordOk = await verifyPassword(String(password), user?.password_hash || DUMMY_HASH);
  if (!user || !passwordOk) {
    recordAttempt({
      email, ip, reason: user ? 'senha' : 'usuario', userId: user?.id, tenantId: user?.tenant_id,
    });
    return res.status(400).json({ error: 'Credenciais inválidas' });
  }

  if (!env.twoFactor || (await isTrustedDevice(req, user.id))) {
    return completeLogin(res, user, ip);
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = await createChallenge({
    kind: '2fa', user, secret: code, minutes: TWO_FACTOR_MINUTES, ip,
  });

  // Sem await de propósito: o envio leva centenas de milissegundos e o tempo de resposta
  // do login não deve depender do provedor de e-mail.
  sendTwoFactorCode(user.email, code)
    .catch((e) => console.error('[auth.login] envio do código falhou:', e.message));

  res.json({
    status: '2fa',
    challengeId,
    emailMascarado: maskEmail(user.email),
    expiraEm: new Date(Date.now() + TWO_FACTOR_MINUTES * 60_000).toISOString(),
  });
});

router.post('/2fa/verificar', async (req, res) => {
  const { challengeId, codigo: code, lembrarDispositivo: remember } = req.body || {};
  const ip = req.ip || 'desconhecido';
  const rejection = { error: 'Código inválido ou expirado. Solicite um novo.' };

  const challenge = await consumeChallenge(challengeId, '2fa');
  if (!challenge) return res.status(400).json(rejection);

  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND active = true', [challenge.user_id]);
  const user = rows[0];

  if (!user || !matches(challenge.code_hash, hashSecret(challenge.id, String(code || '')))) {
    if (user) {
      recordAttempt({
        email: user.email.toLowerCase(), ip, reason: '2fa', userId: user.id, tenantId: user.tenant_id,
      });
    }
    return res.status(400).json(rejection);
  }

  await query('UPDATE auth_challenges SET used_at = now() WHERE id = $1', [challenge.id]);
  if (remember) await rememberDevice(req, res, user);

  return completeLogin(res, user, ip);
});

router.post('/2fa/reenviar', async (req, res) => {
  const { challengeId } = req.body || {};
  const expired = { error: 'Sessão expirada. Faça o login novamente.' };
  if (!isUuid(challengeId)) return res.status(400).json(expired);

  const { rows } = await query(
    `SELECT * FROM auth_challenges
      WHERE id = $1 AND kind = '2fa' AND created_at > now() - interval '30 minutes'`,
    [challengeId],
  );
  const challenge = rows[0];
  if (!challenge) return res.status(400).json(expired);

  const { rows: [limit] } = await query(
    `SELECT count(*) AS total, max(created_at) AS last_at
       FROM auth_challenges
      WHERE user_id = $1 AND kind = '2fa' AND created_at > now() - interval '15 minutes'`,
    [challenge.user_id],
  );
  if (Number(limit.total) >= 4) {
    return res.status(429).json({ error: 'Muitos reenvios. Faça o login novamente em alguns minutos.' });
  }
  if (Date.now() - new Date(limit.last_at).getTime() < 60_000) {
    return res.status(429).json({ error: 'Aguarde um minuto para pedir outro código.' });
  }

  const { rows: [user] } = await query('SELECT * FROM users WHERE id = $1 AND active = true', [challenge.user_id]);
  if (!user) return res.status(400).json(expired);

  await query('UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL', [challenge.id]);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const newId = await createChallenge({
    kind: '2fa', user, secret: code, minutes: TWO_FACTOR_MINUTES, ip: req.ip || 'desconhecido',
  });
  sendTwoFactorCode(user.email, code)
    .catch((e) => console.error('[auth.resend] envio do código falhou:', e.message));

  res.json({
    status: '2fa',
    challengeId: newId,
    emailMascarado: maskEmail(user.email),
    expiraEm: new Date(Date.now() + TWO_FACTOR_MINUTES * 60_000).toISOString(),
  });
});

router.post('/esqueci-senha', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  // Responde antes de fazer qualquer trabalho: se a resposta viesse depois da busca e do
  // envio, o tempo até ela revelaria se o e-mail existe.
  res.json({ ok: true });
  if (!email) return;

  try {
    const { rows } = await findByEmail(email);
    const user = rows[0];
    if (!user) return;

    const secret = crypto.randomBytes(32).toString('base64url');
    const id = await createChallenge({
      kind: 'reset', user, secret, minutes: RESET_MINUTES, ip: req.ip || 'desconhecido',
    });
    await sendResetLink(user.email, `${env.appUrl}/redefinir-senha?token=${id}.${secret}`);
  } catch (e) {
    console.error('[auth.forgot-password]', e.message);
  }
});

// Valida sem consumir, para a tela avisar "link expirado" antes de o usuário digitar.
async function findResetChallenge(token) {
  const [id, secret] = String(token || '').split('.');
  if (!isUuid(id) || !secret) return null;

  const { rows } = await query(
    `SELECT * FROM auth_challenges
      WHERE id = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now()`,
    [id],
  );
  const challenge = rows[0];
  if (!challenge || !matches(challenge.code_hash, hashSecret(id, secret))) return null;
  return challenge;
}

router.get('/redefinir-senha/validar', async (req, res) => {
  res.json({ valido: Boolean(await findResetChallenge(req.query.token)) });
});

router.post('/redefinir-senha', async (req, res) => {
  const { token, senha: password } = req.body || {};
  const rejection = { error: 'Link inválido ou expirado. Peça outro.' };

  const challenge = await findResetChallenge(token);
  if (!challenge) return res.status(400).json(rejection);

  const { rows } = await query('SELECT email FROM users WHERE id = $1', [challenge.user_id]);
  const weak = validatePolicy(password, { email: rows[0]?.email });
  if (weak) return res.status(400).json({ error: weak });

  // Marca o uso primeiro: se o mesmo link for enviado duas vezes ao mesmo tempo, só uma
  // das requisições encontra a linha ainda não usada.
  const { rowCount } = await query(
    'UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [challenge.id],
  );
  if (!rowCount) return res.status(400).json(rejection);

  await query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(),
            token_version = token_version + 1, updated_at = now()
      WHERE id = $1`,
    [challenge.user_id, await hashPassword(password)],
  );

  // Quem redefine a senha costuma estar reagindo a um acesso indevido: derrubar as sessões
  // e os dispositivos lembrados é o que efetivamente expulsa quem já estava dentro.
  await query('UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [challenge.user_id]);
  await query('UPDATE auth_challenges SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [challenge.user_id]);

  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name AS nome, email, role AS papel, professional_id
       FROM users WHERE id = $1`,
    [req.user.id],
  );
  res.json(rows[0] || null);
});

export default router;
