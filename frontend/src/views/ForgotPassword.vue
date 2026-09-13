<script setup>
import { ref } from 'vue';
import { api } from '../api/client.js';

const email = ref('');
const sent = ref(false);
const sending = ref(false);
const error = ref('');

async function submit() {
  error.value = '';
  sending.value = true;
  try {
    await api.post('/auth/esqueci-senha', { email: email.value });
    // A resposta é a mesma exista ou não a conta — e a tela precisa refletir isso, senão
    // ela viraria justamente o oráculo que o backend evita ser.
    sent.value = true;
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível enviar o e-mail agora.';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div v-if="sent" class="auth-card">
      <h1 class="auth-logo">Verifique seu e-mail</h1>
      <div class="auth-ok">
        Se houver uma conta para <strong>{{ email }}</strong>, o link de redefinição já está
        a caminho. Ele vale por 30 minutos.
      </div>
      <p class="auth-sub">Não chegou? Confira a caixa de spam antes de pedir outro.</p>
      <router-link to="/login" class="btn btn-secondary auth-btn">Voltar ao login</router-link>
    </div>

    <form v-else class="auth-card" @submit.prevent="submit">
      <h1 class="auth-logo">Esqueci minha senha</h1>
      <p class="auth-sub">
        Informe o e-mail da sua conta. Enviaremos um link para você criar uma senha nova.
      </p>

      <div v-if="error" class="form-erro">{{ error }}</div>

      <div class="form-row">
        <label class="form-label" for="email">E-mail</label>
        <input id="email" v-model="email" class="form-input" type="email"
               autocomplete="username" required autofocus />
      </div>

      <button class="btn btn-primary auth-btn" type="submit" :disabled="sending">
        {{ sending ? 'Enviando…' : 'Enviar link' }}
      </button>

      <p class="auth-rodape">
        <router-link to="/login" class="auth-link">Voltar ao login</router-link>
      </p>
    </form>
  </div>
</template>
