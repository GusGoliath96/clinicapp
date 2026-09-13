<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth.js';

const email = ref('');
const password = ref('');
const error = ref('');
const signingIn = ref(false);
const auth = useAuth();
const router = useRouter();

async function signIn() {
  error.value = '';
  signingIn.value = true;
  try {
    const result = await auth.login(email.value, password.value);
    router.push(result === '2fa' ? '/verificar-codigo' : '/recepcao');
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível entrar. Tente de novo.';
  } finally {
    signingIn.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="signIn">
      <h1 class="auth-logo">ClinicaApp</h1>
      <p class="auth-sub">Entre com seu e-mail e senha.</p>

      <div v-if="error" class="form-erro">{{ error }}</div>

      <div class="form-row">
        <label class="form-label" for="email">E-mail</label>
        <input id="email" v-model="email" class="form-input" type="email"
               autocomplete="username" required />
      </div>

      <div class="form-row">
        <label class="form-label" for="senha">Senha</label>
        <input id="senha" v-model="password" class="form-input" type="password"
               autocomplete="current-password" required />
      </div>

      <button class="btn btn-primary auth-btn" type="submit" :disabled="signingIn">
        {{ signingIn ? 'Entrando…' : 'Entrar' }}
      </button>

      <p class="auth-rodape">
        <router-link to="/esqueci-senha" class="auth-link">Esqueci minha senha</router-link>
      </p>
    </form>
  </div>
</template>
