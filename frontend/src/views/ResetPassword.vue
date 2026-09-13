<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';

const route = useRoute();
const token = String(route.query.token || '');

const password = ref('');
const confirmation = ref('');
const error = ref('');
const state = ref('checking'); // checking | valid | invalid | done
const saving = ref(false);

// Valida antes de mostrar o formulário: descobrir que o link expirou só depois de escolher
// a senha é a pior hora de descobrir.
onMounted(async () => {
  if (!token) return (state.value = 'invalid');
  try {
    const { data } = await api.get('/auth/redefinir-senha/validar', { params: { token } });
    state.value = data.valido ? 'valid' : 'invalid';
  } catch {
    state.value = 'invalid';
  }
});

async function save() {
  error.value = '';
  if (password.value !== confirmation.value) {
    error.value = 'As duas senhas não são iguais.';
    return;
  }
  saving.value = true;
  try {
    await api.post('/auth/redefinir-senha', { token, senha: password.value });
    state.value = 'done';
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível redefinir a senha.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div v-if="state === 'checking'" class="auth-card">
      <p class="auth-sub" style="margin:0">Verificando o link…</p>
    </div>

    <div v-else-if="state === 'invalid'" class="auth-card">
      <h1 class="auth-logo">Link expirado</h1>
      <p class="auth-sub">
        Este link não vale mais — ele dura 30 minutos e só pode ser usado uma vez.
        Peça um novo para continuar.
      </p>
      <router-link to="/esqueci-senha" class="btn btn-primary auth-btn">
        Pedir um link novo
      </router-link>
    </div>

    <div v-else-if="state === 'done'" class="auth-card">
      <h1 class="auth-logo">Senha alterada</h1>
      <div class="auth-ok">
        Pronto. Por segurança, encerramos as sessões abertas em outros dispositivos.
      </div>
      <router-link to="/login" class="btn btn-primary auth-btn">Entrar</router-link>
    </div>

    <form v-else class="auth-card" @submit.prevent="save">
      <h1 class="auth-logo">Criar senha nova</h1>
      <p class="auth-sub">Use pelo menos 10 caracteres, e nada que seja fácil de adivinhar.</p>

      <div v-if="error" class="form-erro">{{ error }}</div>

      <div class="form-row">
        <label class="form-label" for="senha">Senha nova</label>
        <input id="senha" v-model="password" class="form-input" type="password"
               autocomplete="new-password" required autofocus />
      </div>

      <div class="form-row">
        <label class="form-label" for="confirmacao">Repita a senha</label>
        <input id="confirmacao" v-model="confirmation" class="form-input" type="password"
               autocomplete="new-password" required />
      </div>

      <button class="btn btn-primary auth-btn" type="submit" :disabled="saving">
        {{ saving ? 'Salvando…' : 'Salvar senha' }}
      </button>
    </form>
  </div>
</template>
