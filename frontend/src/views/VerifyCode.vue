<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth.js';

const code = ref('');
const remember = ref(true);
const error = ref('');
const notice = ref('');
const verifying = ref(false);
const resending = ref(false);
const auth = useAuth();
const router = useRouter();

// O desafio vive só em memória: um reload nesta tela perde a referência e não há o que
// verificar. Voltar ao login é o caminho, não mostrar um formulário que nunca funcionaria.
onMounted(() => {
  if (!auth.challenge) router.replace('/login');
});

function onDigit(e) {
  code.value = e.target.value.replace(/\D/g, '').slice(0, 6);
}

async function confirm() {
  error.value = '';
  notice.value = '';
  verifying.value = true;
  try {
    await auth.verifyTwoFactor(code.value, remember.value);
    router.push('/recepcao');
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível validar o código.';
    code.value = '';
  } finally {
    verifying.value = false;
  }
}

async function resend() {
  error.value = '';
  notice.value = '';
  resending.value = true;
  try {
    await auth.resendTwoFactor();
    notice.value = 'Enviamos um código novo.';
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível reenviar o código.';
  } finally {
    resending.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="confirm">
      <h1 class="auth-logo">Confirme que é você</h1>
      <p class="auth-sub">
        Enviamos um código de 6 dígitos para <strong>{{ auth.challenge?.email }}</strong>.
        Ele vale por 10 minutos.
      </p>

      <div v-if="error" class="form-erro">{{ error }}</div>
      <div v-if="notice" class="auth-ok">{{ notice }}</div>

      <div class="form-row">
        <label class="form-label" for="codigo">Código</label>
        <input id="codigo" class="auth-codigo" :value="code" @input="onDigit"
               inputmode="numeric" autocomplete="one-time-code" placeholder="000000"
               maxlength="6" autofocus />
      </div>

      <label class="auth-check">
        <input type="checkbox" v-model="remember" />
        Confiar neste dispositivo por 30 dias
      </label>

      <button class="btn btn-primary auth-btn" type="submit"
              :disabled="verifying || code.length < 6">
        {{ verifying ? 'Verificando…' : 'Entrar' }}
      </button>

      <p class="auth-rodape">
        <button type="button" class="auth-link" @click="resend" :disabled="resending">
          {{ resending ? 'Reenviando…' : 'Reenviar código' }}
        </button>
      </p>
    </form>
  </div>
</template>
