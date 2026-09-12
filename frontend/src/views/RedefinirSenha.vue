<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api/client.js';

const route = useRoute();
const token = String(route.query.token || '');

const senha = ref('');
const confirmacao = ref('');
const erro = ref('');
const estado = ref('checando'); // checando | valido | invalido | pronto
const salvando = ref(false);

// Valida antes de mostrar o formulário: descobrir que o link expirou só depois de escolher
// a senha é a pior hora de descobrir.
onMounted(async () => {
  if (!token) return (estado.value = 'invalido');
  try {
    const { data } = await api.get('/auth/redefinir-senha/validar', { params: { token } });
    estado.value = data.valido ? 'valido' : 'invalido';
  } catch {
    estado.value = 'invalido';
  }
});

async function salvar() {
  erro.value = '';
  if (senha.value !== confirmacao.value) {
    erro.value = 'As duas senhas não são iguais.';
    return;
  }
  salvando.value = true;
  try {
    await api.post('/auth/redefinir-senha', { token, senha: senha.value });
    estado.value = 'pronto';
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível redefinir a senha.';
  } finally {
    salvando.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div v-if="estado === 'checando'" class="auth-card">
      <p class="auth-sub" style="margin:0">Verificando o link…</p>
    </div>

    <div v-else-if="estado === 'invalido'" class="auth-card">
      <h1 class="auth-logo">Link expirado</h1>
      <p class="auth-sub">
        Este link não vale mais — ele dura 30 minutos e só pode ser usado uma vez.
        Peça um novo para continuar.
      </p>
      <router-link to="/esqueci-senha" class="btn btn-primary auth-btn">
        Pedir um link novo
      </router-link>
    </div>

    <div v-else-if="estado === 'pronto'" class="auth-card">
      <h1 class="auth-logo">Senha alterada</h1>
      <div class="auth-ok">
        Pronto. Por segurança, encerramos as sessões abertas em outros dispositivos.
      </div>
      <router-link to="/login" class="btn btn-primary auth-btn">Entrar</router-link>
    </div>

    <form v-else class="auth-card" @submit.prevent="salvar">
      <h1 class="auth-logo">Criar senha nova</h1>
      <p class="auth-sub">Use pelo menos 10 caracteres, e nada que seja fácil de adivinhar.</p>

      <div v-if="erro" class="form-erro">{{ erro }}</div>

      <div class="form-row">
        <label class="form-label" for="senha">Senha nova</label>
        <input id="senha" v-model="senha" class="form-input" type="password"
               autocomplete="new-password" required autofocus />
      </div>

      <div class="form-row">
        <label class="form-label" for="confirmacao">Repita a senha</label>
        <input id="confirmacao" v-model="confirmacao" class="form-input" type="password"
               autocomplete="new-password" required />
      </div>

      <button class="btn btn-primary auth-btn" type="submit" :disabled="salvando">
        {{ salvando ? 'Salvando…' : 'Salvar senha' }}
      </button>
    </form>
  </div>
</template>
