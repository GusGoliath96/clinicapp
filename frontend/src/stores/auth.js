import { defineStore } from 'pinia';
import { api } from '../api/client.js';
import { disconnectSocket } from '../realtime/socket.js';

export const useAuth = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || null,
    user: JSON.parse(localStorage.getItem('user') || 'null'),
  }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
  },
  actions: {
    async login(email, senha) {
      const { data } = await api.post('/auth/login', { email, senha });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    },
    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      disconnectSocket();
    },
  },
});
