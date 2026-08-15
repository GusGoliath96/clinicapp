<script setup>
import { reactive, ref, onMounted } from 'vue';
import { api } from '../../api/client.js';

const FUSOS = ['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Rio_Branco', 'America/Noronha'];

const f = reactive({ nome: '', fuso: 'America/Sao_Paulo', abertura: '08:00', fechamento: '18:00', telefone: '', endereco: '' });
const salvo = ref(false);
const erro = ref('');
const salvando = ref(false);

async function carregar() {
  const { data } = await api.get('/tenant');
  f.nome = data.nome || '';
  const c = data.config || {};
  f.fuso = c.fuso || 'America/Sao_Paulo';
  f.abertura = c.abertura || '08:00';
  f.fechamento = c.fechamento || '18:00';
  f.telefone = c.telefone || '';
  f.endereco = c.endereco || '';
}

async function salvar() {
  salvando.value = true; erro.value = ''; salvo.value = false;
  try {
    await api.put('/tenant', {
      nome: f.nome,
      config: { fuso: f.fuso, abertura: f.abertura, fechamento: f.fechamento, telefone: f.telefone, endereco: f.endereco },
    });
    salvo.value = true;
    setTimeout(() => { salvo.value = false; }, 2500);
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível salvar.';
  } finally {
    salvando.value = false;
  }
}

onMounted(carregar);
</script>

<template>
  <div class="card" style="max-width:620px;">
    <div v-if="erro" class="form-erro">{{ erro }}</div>
    <div class="form-row">
      <label class="form-label">Nome da clínica <span class="required">*</span></label>
      <input class="form-input" v-model="f.nome" />
    </div>
    <div class="row-2">
      <div class="form-row">
        <label class="form-label">Fuso horário</label>
        <select class="form-input" v-model="f.fuso">
          <option v-for="tz in FUSOS" :key="tz" :value="tz">{{ tz.replace('America/', '') }}</option>
        </select>
      </div>
      <div class="form-row">
        <label class="form-label">Telefone</label>
        <input class="form-input" v-model="f.telefone" placeholder="(11) 0000-0000" />
      </div>
    </div>
    <div class="row-2">
      <div class="form-row"><label class="form-label">Abertura</label><input type="time" class="form-input" v-model="f.abertura" /></div>
      <div class="form-row"><label class="form-label">Fechamento</label><input type="time" class="form-input" v-model="f.fechamento" /></div>
    </div>
    <div class="form-row">
      <label class="form-label">Endereço</label>
      <input class="form-input" v-model="f.endereco" placeholder="Rua, número, bairro, cidade" />
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:6px;">
      <button class="btn btn-primary" :disabled="salvando" @click="salvar">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
      <span v-if="salvo" style="color:var(--success);font-size:12px;font-weight:600;">✓ Salvo</span>
    </div>
  </div>
</template>
