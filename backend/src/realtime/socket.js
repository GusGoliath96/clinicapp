import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let io = null;

// Cada tenant tem sua "sala"; eventos são emitidos só para os clientes daquela clínica.
export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.corsOrigin } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      const payload = jwt.verify(token, env.jwtSecret);
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
