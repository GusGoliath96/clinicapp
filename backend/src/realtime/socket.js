import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';

let io = null;

// Cada tenant tem sua "sala"; eventos são emitidos só para os clientes daquela clínica.
export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.corsOrigin } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      const payload = jwt.verify(token, env.jwtSecret);

      // Mesma revogação do requireAuth. Sem isto o socket seria a porta de trás: um token
      // já derrubado continuaria recebendo mensagens e agenda do tenant em tempo real.
      const { rows } = await query(
        'SELECT token_version, active FROM users WHERE id = $1',
        [payload.sub],
      );
      const user = rows[0];
      if (!user || !user.active || user.token_version !== payload.tv) {
        return next(new Error('unauthorized'));
      }

      socket.data.tenantId = payload.tenantId;
      socket.join(`tenant:${payload.tenantId}`);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  return io;
}

// Emite um evento para todos os clientes de um tenant.
export function emitToTenant(tenantId, event, payload) {
  if (io) io.to(`tenant:${tenantId}`).emit(event, payload);
}
