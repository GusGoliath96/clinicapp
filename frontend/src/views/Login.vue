<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth.js';

const email = ref('admin@macs.com.br');
const senha = ref('123456');
const erro = ref('');
const auth = useAuth();
const router = useRouter();

async function entrar() {
  erro.value = '';
  try {
    await auth.login(email.value, senha.value);
    router.push('/recepcao');
  } catch (e) {
    erro.value = e.response?.data?.error || 'Falha no login';
  }
}
</script>

<template>
  <div class="wrap">
    <form class="card" @submit.prevent="entrar">
      <h2>ClinicaApp</h2>
      <label>E-mail<input v-model="email" type="email" /></label>
      <label>Senha<input v-model="senha" type="password" /></label>
      <p v-if="erro" class="erro">{{ erro }}</p>
      <button class="btn" type="submit">Entrar</button>
    </form>
  </div>
</template>

<style scoped>
.wrap { display: grid; place-items: center; min-height: 100vh; }
.card {
  background: #fff; padding: 32px; border-radius: 12px; width: 320px;
  display: flex; flex-direction: column; gap: 14px; box-shadow: 0 4px 20px rgba(0,0,0,.06);
}
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--cinza); }
.erro { color: #dc2626; font-size: 14px; margin: 0; }
</style>
