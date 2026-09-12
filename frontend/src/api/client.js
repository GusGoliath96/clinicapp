import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  // O cookie de dispositivo confiável do 2FA é HttpOnly e mora na API, que em produção
  // fica noutro subdomínio. Sem isto o navegador não o envia e o código seria pedido
  // a cada login.
  withCredentials: true,
});

// Injeta o token JWT em toda requisição.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redireciona ao login quando a sessão morre.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // As rotas de /auth são o próprio processo de entrar: um 401 ali significa "essas
    // credenciais não servem", não "sua sessão acabou". Redirecionar jogaria o usuário
    // para fora da tela de código ou de redefinição no meio do fluxo.
    const doLogin = (err.config?.url || '').startsWith('/auth');

    if (err.response?.status === 401 && !doLogin) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  },
);
