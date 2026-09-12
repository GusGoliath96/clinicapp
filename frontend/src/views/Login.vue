<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth.js';

const email = ref('');
const senha = ref('');
const erro = ref('');
const entrando = ref(false);
const auth = useAuth();
const router = useRouter();

async function entrar() {
  erro.value = '';
  entrando.value = true;
  try {
    const resultado = await auth.login(email.value, senha.value);
    router.push(resultado === '2fa' ? '/verificar-codigo' : '/recepcao');
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível entrar. Tente de novo.';
  } finally {
    entrando.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="entrar">
      <h1 class="auth-logo">ClinicaApp</h1>
      <p class="auth-sub">Entre com seu e-mail e senha.</p>

      <div v-if="erro" class="form-erro">{{ erro }}</div>

      <div class="form-row">
        <label class="form-label" for="email">E-mail</label>
        <input id="email" v-model="email" class="form-input" type="email"
               autocomplete="username" required />
      </div>

      <div class="form-row">
        <label class="form-label" for="senha">Senha</label>
        <input id="senha" v-model="senha" class="form-input" type="password"
               autocomplete="current-password" required />
      </div>

      <button class="btn btn-primary auth-btn" type="submit" :disabled="entrando">
        {{ entrando ? 'Entrando…' : 'Entrar' }}
      </button>

      <p class="auth-rodape">
        <router-link to="/esqueci-senha" class="auth-link">Esqueci minha senha</router-link>
      </p>
    </form>
  </div>
</template>
