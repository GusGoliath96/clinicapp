import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';

// Verifica o JWT e injeta req.user = { id, tenantId, role }.
// Todas as queries devem escopar por req.user.tenantId.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }

  // A assinatura sozinha não basta: um JWT vale 7 dias e continuaria válido depois de
  // trocar a senha ou desativar o usuário. token_version é o que permite derrubar sessões.
  const { rows } = await query(
    'SELECT token_version, active FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.active || user.token_version !== payload.tv) {
    return res.status(401).json({ error: 'Sessão expirada' });
  }

  req.user = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
  next();
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, role: user.role, tv: user.token_version },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}
