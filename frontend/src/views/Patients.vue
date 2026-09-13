<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../api/client.js';
import { useApp } from '../stores/app.js';
import { initials, colorFor } from '../utils/ui.js';
import LifeCard from '../components/LifeCard.vue';
import PatientForm from '../components/PatientForm.vue';

const app = useApp();
const patients = ref([]);
const search = ref('');
const cardId = ref(null);
const form = ref(null); // { patient: null } quando o modal de cadastro está aberto

async function load() {
  const params = search.value ? { q: search.value } : {};
  patients.value = (await api.get('/patients', { params })).data;
}
function open(p) { cardId.value = p.id; }
function create() { form.value = { patient: null }; }
function onSaved(p) { form.value = null; load(); cardId.value = p.id; }

onMounted(async () => {
  await load();
  if (app.openNewPatient) { app.openNewPatient = false; create(); }
});
watch(() => app.openNewPatient, (v) => { if (v) { app.openNewPatient = false; create(); } });
</script>

<template>
  <div class="pac-toolbar">
    <input v-model="search" class="form-input" style="max-width:280px;" placeholder="Buscar paciente por nome…" @input="load" />
    <span style="color:var(--gray-500);font-size:12px;">{{ patients.length }} paciente(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="create">＋ Cadastrar paciente</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead>
        <tr><th></th><th>Nome</th><th>Telefone</th><th>Convênio</th><th>Etiquetas</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="p in patients" :key="p.id" style="cursor:pointer;" @click="open(p)">
          <td style="width:44px;">
            <div class="pac-avatar" :style="{ background: colorFor(p.nome) }">{{ initials(p.nome) }}</div>
          </td>
          <td><strong>{{ p.nome }}</strong></td>
          <td>{{ p.telefone || '—' }}</td>
          <td>{{ p.convenio || 'Particular' }}</td>
          <td>
            <span v-for="t in (p.tags || [])" :key="t" class="badge badge-blue" style="margin-right:3px;">{{ t }}</span>
          </td>
          <td><button class="btn btn-secondary btn-sm" @click.stop="open(p)">📂 Card de Vida</button></td>
        </tr>
        <tr v-if="!patients.length"><td colspan="6" class="empty">Nenhum paciente encontrado.</td></tr>
      </tbody>
    </table>
  </div>

  <PatientForm v-if="form" :patient="form.patient" @close="form = null" @saved="onSaved" />
  <LifeCard v-if="cardId" :patient-id="cardId" @close="cardId = null" @edited="load" />
</template>
