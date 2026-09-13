<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import ProfessionalForm from '../components/ProfessionalForm.vue';
import ClinicSettings from '../components/settings/ClinicSettings.vue';
import UserSettings from '../components/settings/UserSettings.vue';
import InsurancePlanSettings from '../components/settings/InsurancePlanSettings.vue';

// Os campos vindos da API seguem em português (p.nome, p.agenda, p.ativo): é o contrato,
// que não muda. Os identificadores locais é que estão em inglês.

const auth = useAuth();

const TABS = [
  { id: 'clinica', icon: '🏢', label: 'Clínica' },
  { id: 'profissionais', icon: '👤', label: 'Profissionais' },
  { id: 'usuarios', icon: '🔑', label: 'Usuários', adminOnly: true },
  { id: 'convenios', icon: '💳', label: 'Convênios' },
];

// /users passou a exigir papel admin. Mostrar a aba para os demais só renderizaria uma
// tela que responde 403 — quem não pode gerenciar usuários não precisa nem vê-la.
const tabs = computed(() => TABS.filter((t) => !t.adminOnly || auth.user?.papel === 'admin'));

const tab = ref('clinica');

const professionals = ref([]);
const form = ref(null);          // { professional } quando o modal está aberto
const confirming = ref(null);    // profissional a excluir
const error = ref('');

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

async function load() { professionals.value = (await api.get('/professionals')).data; }

function scheduleSummary(p) {
  const perDay = p.agenda?.horarios;
  if (perDay) {
    const active = WEEKDAYS.filter((d) => perDay[d]?.ativo);
    if (!active.length) return 'Sem dias configurados';
    return active.map((d) => `${d} ${perDay[d].inicio}–${perDay[d].fim}`).join(' · ');
  }
  const legacy = p.agenda || {};
  if (legacy.dias?.length) return `${legacy.dias.join(', ')} · ${legacy.inicio}–${legacy.fim}`;
  return 'Sem horário configurado';
}

function create() { error.value = ''; form.value = { professional: null }; }
function edit(p) { error.value = ''; form.value = { professional: p }; }
function onSaved() { form.value = null; load(); }

async function toggleActive(p) {
  await api.put(`/professionals/${p.id}`, { ativo: !p.ativo });
  load();
}

async function remove() {
  error.value = '';
  try {
    await api.delete(`/professionals/${confirming.value.id}`);
    confirming.value = null;
    load();
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível excluir.';
    confirming.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div class="conf-tabs">
    <button v-for="t in tabs" :key="t.id" class="conf-tab" :class="{ active: tab === t.id }" @click="tab = t.id">
      {{ t.icon }} {{ t.label }}
    </button>
  </div>

  <div v-if="error" class="form-erro" style="margin-bottom:12px;">{{ error }}</div>

  <ClinicSettings v-if="tab === 'clinica'" />
  <UserSettings v-else-if="tab === 'usuarios'" />
  <InsurancePlanSettings v-else-if="tab === 'convenios'" />

  <!-- Profissionais -->
  <div v-if="tab === 'profissionais'">
    <div class="pac-toolbar">
      <span style="color:var(--gray-500);font-size:12px;">{{ professionals.length }} profissional(is)</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="create">＋ Novo profissional</button>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead>
          <tr><th></th><th>Nome</th><th>Especialidade</th><th>Conselho</th><th>Horário</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in professionals" :key="p.id">
            <td style="width:24px;"><span class="cor-dot" :style="{ background: p.cor }"></span></td>
            <td><strong>{{ p.nome }}</strong></td>
            <td>{{ p.especialidade || '—' }}</td>
            <td>{{ p.conselho || '—' }}</td>
            <td style="font-size:11px;color:var(--gray-600);max-width:280px;">{{ scheduleSummary(p) }}</td>
            <td>
              <span class="badge" :class="p.ativo !== false ? 'badge-green' : 'badge-gray'">{{ p.ativo !== false ? 'Ativo' : 'Inativo' }}</span>
            </td>
            <td style="white-space:nowrap;">
              <button class="btn btn-secondary btn-sm" @click="edit(p)">✏️ Editar</button>
              <button class="btn btn-secondary btn-sm" @click="toggleActive(p)">{{ p.ativo !== false ? 'Desativar' : 'Ativar' }}</button>
              <button class="btn btn-danger btn-sm" @click="confirming = p">Excluir</button>
            </td>
          </tr>
          <tr v-if="!professionals.length"><td colspan="7" class="empty">Nenhum profissional cadastrado.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <ProfessionalForm v-if="form" :professional="form.professional" @close="form = null" @saved="onSaved" />

  <!-- Confirmar exclusão -->
  <div v-if="confirming" class="modal-backdrop active" @click.self="confirming = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Excluir profissional</div>
        <button class="modal-close" @click="confirming = null">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;">Tem certeza que deseja excluir <strong>{{ confirming.nome }}</strong>? Esta ação não pode ser desfeita.</p>
        <p style="font-size:12px;color:var(--gray-500);margin-top:8px;">Se o profissional já tiver consultas no histórico, o sistema vai sugerir desativá-lo em vez de excluir.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="confirming = null">Cancelar</button>
        <button class="btn btn-danger" @click="remove">Excluir</button>
      </div>
    </div>
  </div>
</template>
