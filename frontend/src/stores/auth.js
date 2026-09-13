import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { disconnectSocket } from '../realtime/socket.js';

// O payload da API segue em português (senha, codigo, papel): é contrato com o backend e
// com o motor de IA. Só os identificadores daqui estão em inglês.

export const useAuth = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || null,
    user: JSON.parse(localStorage.getItem('user') || 'null'),
    // Desafio de 2FA em andamento. Fica só em memória de propósito: é de vida curta e
    // não deve sobreviver a um reload nem ficar legível para scripts da página.
    challenge: null,
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
  },
  actions: {
    // Devolve 'ok' (entrou) ou '2fa' (falta o código). Quem chama decide para onde ir.
    async login(email, password) {
      const { data } = await api.post('/auth/login', { email, senha: password });
      if (data.status === '2fa') {
        this.challenge = { id: data.challengeId, email: data.emailMascarado };
        return '2fa';
      }
      this.saveSession(data);
      return 'ok';
    },

    async verifyTwoFactor(code, rememberDevice) {
      const { data } = await api.post('/auth/2fa/verificar', {
        challengeId: this.challenge?.id,
        codigo: code,
        lembrarDispositivo: rememberDevice,
      });
      this.saveSession(data);
      this.challenge = null;
    },

    async resendTwoFactor() {
      const { data } = await api.post('/auth/2fa/reenviar', { challengeId: this.challenge?.id });
      this.challenge = { id: data.challengeId, email: data.emailMascarado };
    },

    saveSession(data) {
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
      this.challenge = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      disconnectSocket();
    },
  },
});
