<script setup>
import { ref, onMounted, watch } from 'vue';
import { api } from '../api/client.js';
import { useApp } from '../stores/app.js';
import { iniciais, corDe } from '../utils/ui.js';
import CardVida from '../components/CardVida.vue';
import PatientForm from '../components/PatientForm.vue';

const app = useApp();
const pacientes = ref([]);
const busca = ref('');
const cardId = ref(null);
const form = ref(null); // { patient: null } quando o modal de cadastro está aberto

async function carregar() {
  const params = busca.value ? { q: busca.value } : {};
  pacientes.value = (await api.get('/patients', { params })).data;
}
function abrir(p) { cardId.value = p.id; }
function novo() { form.value = { patient: null }; }
function onSaved(p) { form.value = null; carregar(); cardId.value = p.id; }

onMounted(async () => {
  await carregar();
  if (app.abrirNovoPaciente) { app.abrirNovoPaciente = false; novo(); }
});
watch(() => app.abrirNovoPaciente, (v) => { if (v) { app.abrirNovoPaciente = false; novo(); } });
</script>

<template>
  <div class="pac-toolbar">
    <input v-model="busca" class="form-input" style="max-width:280px;" placeholder="Buscar paciente por nome…" @input="carregar" />
    <span style="color:var(--gray-500);font-size:12px;">{{ pacientes.length }} paciente(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="novo">＋ Cadastrar paciente</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead>
        <tr><th></th><th>Nome</th><th>Telefone</th><th>Convênio</th><th>Etiquetas</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="p in pacientes" :key="p.id" style="cursor:pointer;" @click="abrir(p)">
          <td style="width:44px;">
            <div class="pac-avatar" :style="{ background: corDe(p.nome) }">{{ iniciais(p.nome) }}</div>
          </td>
          <td><strong>{{ p.nome }}</strong></td>
          <td>{{ p.telefone || '—' }}</td>
          <td>{{ p.convenio || 'Particular' }}</td>
          <td>
            <span v-for="t in (p.tags || [])" :key="t" class="badge badge-blue" style="margin-right:3px;">{{ t }}</span>
          </td>
          <td><button class="btn btn-secondary btn-sm" @click.stop="abrir(p)">📂 Card de Vida</button></td>
        </tr>
        <tr v-if="!pacientes.length"><td colspan="6" class="empty">Nenhum paciente encontrado.</td></tr>
      </tbody>
    </table>
  </div>

  <PatientForm v-if="form" :patient="form.patient" @close="form = null" @saved="onSaved" />
  <CardVida v-if="cardId" :patient-id="cardId" @close="cardId = null" @edited="carregar" />
</template>
