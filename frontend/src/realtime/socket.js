import { io } from 'socket.io-client';

let socket = null;

// Conecta ao Socket.IO autenticando com o JWT. Recria se o token mudou.
export function getSocket() {
  const token = localStorage.getItem('token');
  if (!socket) {
    // A API pode estar num host próprio ("https://api.exemplo.com") ou atrás de um prefixo
    // de caminho ("https://host/api") quando tudo entra por um hostname só. O socket.io-client
    // NÃO aceita a segunda forma direto: ele leria "/api" como *namespace* e continuaria
    // procurando o handshake em "/socket.io" na raiz. Por isso o prefixo é separado à mão e
    // entregue como `path`.
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const url = new URL(base, window.location.origin);
    const prefixo = url.pathname.replace(/\/+$/, '');

    socket = io(url.origin, {
      path: `${prefixo}/socket.io`,
      auth: { token },
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
