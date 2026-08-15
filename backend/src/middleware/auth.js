import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Verifica o JWT e injeta req.user = { id, tenantId, papel }.
// Todas as queries devem escopar por req.user.tenantId.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = { id: payload.sub, tenantId: payload.tenantId, papel: payload.papel };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, papel: user.papel },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}
