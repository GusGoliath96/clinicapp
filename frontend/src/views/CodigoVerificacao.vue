<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth.js';

const codigo = ref('');
const lembrar = ref(true);
const erro = ref('');
const aviso = ref('');
const enviando = ref(false);
const reenviando = ref(false);
const auth = useAuth();
const router = useRouter();

// O desafio vive só em memória: um reload nesta tela perde a referência e não há o que
// verificar. Voltar ao login é o caminho, não mostrar um formulário que nunca funcionaria.
onMounted(() => {
  if (!auth.desafio) router.replace('/login');
});

function digitar(e) {
  codigo.value = e.target.value.replace(/\D/g, '').slice(0, 6);
}

async function confirmar() {
  erro.value = '';
  aviso.value = '';
  enviando.value = true;
  try {
    await auth.verificar2fa(codigo.value, lembrar.value);
    router.push('/recepcao');
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível validar o código.';
    codigo.value = '';
  } finally {
    enviando.value = false;
  }
}

async function reenviar() {
  erro.value = '';
  aviso.value = '';
  reenviando.value = true;
  try {
    await auth.reenviar2fa();
    aviso.value = 'Enviamos um código novo.';
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível reenviar o código.';
  } finally {
    reenviando.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="confirmar">
      <h1 class="auth-logo">Confirme que é você</h1>
      <p class="auth-sub">
        Enviamos um código de 6 dígitos para <strong>{{ auth.desafio?.email }}</strong>.
        Ele vale por 10 minutos.
      </p>

      <div v-if="erro" class="form-erro">{{ erro }}</div>
      <div v-if="aviso" class="auth-ok">{{ aviso }}</div>

      <div class="form-row">
        <label class="form-label" for="codigo">Código</label>
        <input id="codigo" class="auth-codigo" :value="codigo" @input="digitar"
               inputmode="numeric" autocomplete="one-time-code" placeholder="000000"
               maxlength="6" autofocus />
      </div>

      <label class="auth-check">
        <input type="checkbox" v-model="lembrar" />
        Confiar neste dispositivo por 30 dias
      </label>

      <button class="btn btn-primary auth-btn" type="submit"
              :disabled="enviando || codigo.length < 6">
        {{ enviando ? 'Verificando…' : 'Entrar' }}
      </button>

      <p class="auth-rodape">
        <button type="button" class="auth-link" @click="reenviar" :disabled="reenviando">
          {{ reenviando ? 'Reenviando…' : 'Reenviar código' }}
        </button>
      </p>
    </form>
  </div>
</template>
