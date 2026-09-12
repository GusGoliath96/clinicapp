import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { disconnectSocket } from '../realtime/socket.js';

export const useAuth = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || null,
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    // Desafio de 2FA em andamento. Fica só em memória de propósito: é de vida curta e
    // não deve sobreviver a um reload nem ficar legível para scripts da página.
    desafio: null,
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
  },
  actions: {
    // Devolve 'ok' (entrou) ou '2fa' (falta o código). Quem chama decide para onde ir.
    async login(email, senha) {
      const { data } = await api.post('/auth/login', { email, senha });
      if (data.status === '2fa') {
        this.desafio = { id: data.challengeId, email: data.emailMascarado };
        return '2fa';
      }
      this.guardarSessao(data);
      return 'ok';
    },

    async verificar2fa(codigo, lembrarDispositivo) {
      const { data } = await api.post('/auth/2fa/verificar', {
        challengeId: this.desafio?.id,
        codigo,
        lembrarDispositivo,
      });
      this.guardarSessao(data);
      this.desafio = null;
    },

    async reenviar2fa() {
      const { data } = await api.post('/auth/2fa/reenviar', { challengeId: this.desafio?.id });
      this.desafio = { id: data.challengeId, email: data.emailMascarado };
    },

    guardarSessao(data) {
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      // O socket é criado uma vez e guarda o token do handshake; sem desconectar, ele
      // continuaria autenticado com o token da sessão anterior.
      disconnectSocket();
    },

    logout() {
      this.token = null;
      this.user = null;
      this.desafio = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      disconnectSocket();
    },
  },
});
