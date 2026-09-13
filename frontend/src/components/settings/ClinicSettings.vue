<script setup>
import { reactive, ref, onMounted } from 'vue';
import { api } from '../../api/client.js';

// As chaves de tenant.config seguem em português: são conteúdo da coluna jsonb.

const TIMEZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'];

const form = reactive({ nome: '', fuso: 'America/Sao_Paulo', abertura: '08:00', fechamento: '18:00', telefone: '', endereco: '' });
const saved = ref(false);
const error = ref('');
const saving = ref(false);

async function load() {
  const { data } = await api.get('/tenant');
  form.nome = data.nome || '';
  const config = data.config || {};
  form.fuso = config.fuso || 'America/Sao_Paulo';
  form.abertura = config.abertura || '08:00';
  form.fechamento = config.fechamento || '18:00';
  form.telefone = config.telefone || '';
  form.endereco = config.endereco || '';
}

async function save() {
  saving.value = true; error.value = ''; saved.value = false;
  try {
    await api.put('/tenant', {
      nome: form.nome,
      config: {
        fuso: form.fuso, abertura: form.abertura, fechamento: form.fechamento,
        telefone: form.telefone, endereco: form.endereco,
      },
    });
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2500);
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível salvar.';
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="card" style="max-width:620px;">
    <div v-if="error" class="form-erro">{{ error }}</div>
    <div class="form-row">
      <label class="form-label">Nome da clínica <span class="required">*</span></label>
      <input class="form-input" v-model="form.nome" />
    </div>
    <div class="row-2">
      <div class="form-row">
        <label class="form-label">Fuso horário</label>
        <select class="form-input" v-model="form.fuso">
          <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz.replace('America/', '') }}</option>
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">Telefone</label>
        <input class="form-input" v-model="form.telefone" placeholder="(11) 0000-0000" />
      </div>
    </div>
    <div class="row-2">
      <div class="form-row"><label class="form-label">Abertura</label><input type="time" class="form-input" v-model="form.abertura" /></div>
      <div class="form-row"><label class="form-label">Fechamento</label><input type="time" class="form-input" v-model="form.fechamento" /></div>
    </div>
    <div class="form-row">
      <label class="form-label">Endereço</label>
      <input class="form-input" v-model="form.endereco" placeholder="Rua, número, bairro, cidade" />
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:6px;">
      <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? 'Salvando…' : 'Salvar' }}</button>
      <span v-if="saved" style="color:var(--success);font-size:12px;font-weight:600;">✓ Salvo</span>
    </div>
  </div>
</template>
