import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { conferirSenha, hashSenha, validarPolitica, HASH_FALSO } from '../config/senha.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { checarBloqueio, registrarTentativa } from '../middleware/rateLimit.js';
import { enviarCodigo2fa, enviarLinkReset } from '../integrations/mailer.js';

// Todas as rotas daqui respondem 200, 400 ou 429 — nunca 401. O interceptor do axios
// redireciona para /login em qualquer 401, o que jogaria o usuário para fora da tela do
// código de verificação bem no meio do login.

const router = Router();

const COOKIE_DISPOSITIVO = 'cd_trust';
const DIAS_DISPOSITIVO = 30;
const MINUTOS_2FA = 10;
const MINUTOS_RESET = 30;
const MAX_TENTATIVAS = 5;

const normalizarEmail = (v) => String(v || '').trim().toLowerCase();

const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// O id da linha entra no hash: sem ele, duas linhas com o mesmo código de 6 dígitos teriam
// o mesmo hash, e uma tabela pré-calculada dos 10^6 códigos possíveis quebraria todos de
// uma só vez.
const hashSegredo = (id, segredo) => crypto.createHash('sha256').update(`${id}:${segredo}`).digest('hex');

// Mesmo padrão de serviceAuth.js: confere o comprimento antes, depois compara sem revelar
// em que byte a diferença apareceu.
function confere(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function mascarar(email) {
  const [local, dominio] = String(email).split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${dominio}`;
}

// O id é gerado aqui, e não pelo banco, porque ele precisa entrar no hash do segredo.
async function criarChallenge({ tipo, user, segredo, minutos, ip }) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO auth_challenges (id, tenant_id, user_id, tipo, codigo_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6), $7)`,
    [id, user.tenant_id, user.id, tipo, hashSegredo(id, segredo), minutos, ip],
  );
  return id;
}

// Incrementa e valida na mesma instrução: sem isso, várias requisições simultâneas leriam
// o mesmo contador e o limite de tentativas seria contornável.
async function consumirChallenge(id, tipo) {
  if (!ehUuid(id)) return null;
  const { rows } = await query(
    `UPDATE auth_challenges SET tentativas = tentativas + 1
      WHERE id = $1 AND tipo = $2 AND used_at IS NULL
        AND expires_at > now() AND tentativas < $3
      RETURNING *`,
    [id, tipo, MAX_TENTATIVAS],
  );
  return rows[0] || null;
}

async function lembrarDispositivo(req, res, user) {
  const id = crypto.randomUUID();
  const segredo = crypto.randomBytes(32).toString('base64url');
  const rotulo = String(req.headers['user-agent'] || '').slice(0, 120) || null;

  await query(
    `INSERT INTO trusted_devices (id, tenant_id, user_id, token_hash, rotulo, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [id, user.tenant_id, user.id, hashSegredo(id, segredo), rotulo, DIAS_DISPOSITIVO],
  );

  res.cookie(COOKIE_DISPOSITIVO, `${id}.${segredo}`, {
    httpOnly: true,
    secure: env.producao,
    sameSite: 'lax',
    path: '/auth',
    maxAge: DIAS_DISPOSITIVO * 86_400_000,
  });
}

// A amarração com user_id é o que impede que o cookie de um usuário sirva para pular o
// segundo fator de outro.
async function dispositivoConfiavel(req, userId) {
  const [id, segredo] = String(req.cookies?.[COOKIE_DISPOSITIVO] || '').split('.');
  if (!ehUuid(id) || !segredo) return false;

  const { rows } = await query(
    `SELECT token_hash FROM trusted_devices
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
    [id, userId],
  );
  if (!rows[0] || !confere(rows[0].token_hash, hashSegredo(id, segredo))) return false;

  await query('UPDATE trusted_devices SET last_used_at = now() WHERE id = $1', [id]);
  return true;
}

function buscarPorEmail(email) {
  return query(
    'SELECT * FROM users WHERE lower(email) = $1 AND ativo = true ORDER BY created_at LIMIT 1',
    [email],
  );
}

async function concluirLogin(res, user, ip) {
  await query('UPDATE users SET ultimo_login_em = now() WHERE id = $1', [user.id]);
  registrarTentativa({
    email: user.email.toLowerCase(), ip, sucesso: true, userId: user.id, tenantId: user.tenant_id,
  });
  res.json({
    status: 'ok',
    token: signToken(user),
    user: {
      id: user.id, nome: user.nome, email: user.email,
      papel: user.papel, professional_id: user.professional_id,
    },
  });
}

router.post('/login', async (req, res) => {
  const email = normalizarEmail(req.body?.email);
  const senha = req.body?.senha;
  const ip = req.ip || 'desconhecido';

  if (!email || !senha) return res.status(400).json({ error: 'email e senha são obrigatórios' });

  const bloqueio = await checarBloqueio(email, ip);
  if (bloqueio.bloqueado) {
    registrarTentativa({ email, ip, motivo: 'bloqueado' });
    res.set('Retry-After', String(bloqueio.minutos * 60));
    return res.status(429).json({
      error: `Muitas tentativas. Tente novamente em ${bloqueio.minutos} minuto(s).`,
    });
  }

  const { rows } = await buscarPorEmail(email);
  const user = rows[0];

  // O bcrypt roda mesmo quando o e-mail não existe: se só rodasse para usuários reais, a
  // diferença no tempo de resposta diria quais e-mails estão cadastrados.
  const senhaOk = await conferirSenha(String(senha), user?.senha_hash || HASH_FALSO);
  if (!user || !senhaOk) {
    registrarTentativa({
      email, ip, motivo: user ? 'senha' : 'usuario', userId: user?.id, tenantId: user?.tenant_id,
    });
    return res.status(400).json({ error: 'Credenciais inválidas' });
  }

  if (!env.twoFactor || (await dispositivoConfiavel(req, user.id))) {
    return concluirLogin(res, user, ip);
  }

  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const challengeId = await criarChallenge({ tipo: '2fa', user, segredo: codigo, minutos: MINUTOS_2FA, ip });

  // Sem await de propósito: o envio leva centenas de milissegundos e o tempo de resposta
  // do login não deve depender do provedor de e-mail.
  enviarCodigo2fa(user.email, codigo)
    .catch((e) => console.error('[auth.login] envio do código falhou:', e.message));

  res.json({
    status: '2fa',
    challengeId,
    emailMascarado: mascarar(user.email),
    expiraEm: new Date(Date.now() + MINUTOS_2FA * 60_000).toISOString(),
  });
});

router.post('/2fa/verificar', async (req, res) => {
  const { challengeId, codigo, lembrarDispositivo: lembrar } = req.body || {};
  const ip = req.ip || 'desconhecido';
  const recusa = { error: 'Código inválido ou expirado. Solicite um novo.' };

  const ch = await consumirChallenge(challengeId, '2fa');
  if (!ch) return res.status(400).json(recusa);

  const { rows } = await query('SELECT * FROM users WHERE id = $1 AND ativo = true', [ch.user_id]);
  const user = rows[0];

  if (!user || !confere(ch.codigo_hash, hashSegredo(ch.id, String(codigo || '')))) {
    if (user) {
      registrarTentativa({
        email: user.email.toLowerCase(), ip, motivo: '2fa', userId: user.id, tenantId: user.tenant_id,
      });
    }
    return res.status(400).json(recusa);
  }

  await query('UPDATE auth_challenges SET used_at = now() WHERE id = $1', [ch.id]);
  if (lembrar) await lembrarDispositivo(req, res, user);

  return concluirLogin(res, user, ip);
});

router.post('/2fa/reenviar', async (req, res) => {
  const { challengeId } = req.body || {};
  const expirada = { error: 'Sessão expirada. Faça o login novamente.' };
  if (!ehUuid(challengeId)) return res.status(400).json(expirada);

  const { rows } = await query(
    `SELECT * FROM auth_challenges
      WHERE id = $1 AND tipo = '2fa' AND created_at > now() - interval '30 minutes'`,
    [challengeId],
  );
  const ch = rows[0];
  if (!ch) return res.status(400).json(expirada);

  const { rows: [limite] } = await query(
    `SELECT count(*) AS total, max(created_at) AS ultimo
       FROM auth_challenges
      WHERE user_id = $1 AND tipo = '2fa' AND created_at > now() - interval '15 minutes'`,
    [ch.user_id],
  );
  if (Number(limite.total) >= 4) {
    return res.status(429).json({ error: 'Muitos reenvios. Faça o login novamente em alguns minutos.' });
  }
  if (Date.now() - new Date(limite.ultimo).getTime() < 60_000) {
    return res.status(429).json({ error: 'Aguarde um minuto para pedir outro código.' });
  }

  const { rows: [user] } = await query('SELECT * FROM users WHERE id = $1 AND ativo = true', [ch.user_id]);
  if (!user) return res.status(400).json(expirada);

  await query('UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL', [ch.id]);

  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const novoId = await criarChallenge({
    tipo: '2fa', user, segredo: codigo, minutos: MINUTOS_2FA, ip: req.ip || 'desconhecido',
  });
  enviarCodigo2fa(user.email, codigo)
    .catch((e) => console.error('[auth.reenviar] envio do código falhou:', e.message));

  res.json({
    status: '2fa',
    challengeId: novoId,
    emailMascarado: mascarar(user.email),
    expiraEm: new Date(Date.now() + MINUTOS_2FA * 60_000).toISOString(),
  });
});

router.post('/esqueci-senha', async (req, res) => {
  const email = normalizarEmail(req.body?.email);

  // Responde antes de fazer qualquer trabalho: se a resposta viesse depois da busca e do
  // envio, o tempo até ela revelaria se o e-mail existe.
  res.json({ ok: true });
  if (!email) return;

  try {
    const { rows } = await buscarPorEmail(email);
    const user = rows[0];
    if (!user) return;

    const segredo = crypto.randomBytes(32).toString('base64url');
    const id = await criarChallenge({
      tipo: 'reset', user, segredo, minutos: MINUTOS_RESET, ip: req.ip || 'desconhecido',
    });
    await enviarLinkReset(user.email, `${env.appUrl}/redefinir-senha?token=${id}.${segredo}`);
  } catch (e) {
    console.error('[auth.esqueci-senha]', e.message);
  }
});

// Valida sem consumir, para a tela avisar "link expirado" antes de o usuário digitar.
async function acharReset(token) {
  const [id, segredo] = String(token || '').split('.');
  if (!ehUuid(id) || !segredo) return null;

  const { rows } = await query(
    `SELECT * FROM auth_challenges
      WHERE id = $1 AND tipo = 'reset' AND used_at IS NULL AND expires_at > now()`,
    [id],
  );
  const ch = rows[0];
  if (!ch || !confere(ch.codigo_hash, hashSegredo(id, segredo))) return null;
  return ch;
}

router.get('/redefinir-senha/validar', async (req, res) => {
  res.json({ valido: Boolean(await acharReset(req.query.token)) });
});

router.post('/redefinir-senha', async (req, res) => {
  const { token, senha } = req.body || {};
  const recusa = { error: 'Link inválido ou expirado. Peça outro.' };

  const ch = await acharReset(token);
  if (!ch) return res.status(400).json(recusa);

  const { rows } = await query('SELECT email FROM users WHERE id = $1', [ch.user_id]);
  const erro = validarPolitica(senha, { email: rows[0]?.email });
  if (erro) return res.status(400).json({ error: erro });

  // Marca o uso primeiro: se o mesmo link for enviado duas vezes ao mesmo tempo, só uma
  // das requisições encontra a linha ainda não usada.
  const { rowCount } = await query(
    'UPDATE auth_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [ch.id],
  );
  if (!rowCount) return res.status(400).json(recusa);

  await query(
    `UPDATE users SET senha_hash = $2, senha_alterada_em = now(),
            token_version = token_version + 1, updated_at = now()
      WHERE id = $1`,
    [ch.user_id, await hashSenha(senha)],
  );

  // Quem redefine a senha costuma estar reagindo a um acesso indevido: derrubar as sessões
  // e os dispositivos lembrados é o que efetivamente expulsa quem já estava dentro.
  await query('UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [ch.user_id]);
  await query("UPDATE auth_challenges SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [ch.user_id]);

  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, nome, email, papel, professional_id FROM users WHERE id = $1',
    [req.user.id],
  );
  res.json(rows[0] || null);
});

export default router;
