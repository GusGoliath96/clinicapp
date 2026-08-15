import { io } from 'socket.io-client';

let socket = null;

// Conecta ao Socket.IO autenticando com o JWT. Recria se o token mudou.
export function getSocket() {
  const token = localStorage.getItem('token');
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3000', {
      auth: { token },
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
