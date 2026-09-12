<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/client.js';
import { useAuth } from '../stores/auth.js';
import ProfessionalForm from '../components/ProfessionalForm.vue';
import ClinicaConfig from '../components/config/ClinicaConfig.vue';
import UsuariosConfig from '../components/config/UsuariosConfig.vue';
import ConveniosConfig from '../components/config/ConveniosConfig.vue';

const auth = useAuth();

const ABAS = [
  { id: 'clinica', icon: '🏢', label: 'Clínica' },
  { id: 'profissionais', icon: '👤', label: 'Profissionais' },
  { id: 'usuarios', icon: '🔑', label: 'Usuários', somenteAdmin: true },
  { id: 'convenios', icon: '💳', label: 'Convênios' },
];

// /users passou a exigir papel admin. Mostrar a aba para os demais só renderizaria uma
// tela que responde 403 — quem não pode gerenciar usuários não precisa nem vê-la.
const abas = computed(() => ABAS.filter((a) => !a.somenteAdmin || auth.user?.papel === 'admin'));

const aba = ref('clinica');

const profissionais = ref([]);
const form = ref(null);          // { professional } quando o modal está aberto
const confirmar = ref(null);     // { prof } para excluir
const erro = ref('');

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

async function carregar() { profissionais.value = (await api.get('/professionals')).data; }

function resumoHorario(p) {
  const h = p.agenda?.horarios;
  if (h) {
    const ativos = DIAS.filter((d) => h[d]?.ativo);
    if (!ativos.length) return 'Sem dias configurados';
    return ativos.map((d) => `${d} ${h[d].inicio}–${h[d].fim}`).join(' · ');
  }
  const a = p.agenda || {};
  if (a.dias?.length) return `${a.dias.join(', ')} · ${a.inicio}–${a.fim}`;
  return 'Sem horário configurado';
}

function novo() { erro.value = ''; form.value = { professional: null }; }
function editar(p) { erro.value = ''; form.value = { professional: p }; }
function onSaved() { form.value = null; carregar(); }

async function toggleAtivo(p) {
  await api.put(`/professionals/${p.id}`, { ativo: !p.ativo });
  carregar();
}

async function excluir() {
  erro.value = '';
  try {
    await api.delete(`/professionals/${confirmar.value.id}`);
    confirmar.value = null;
    carregar();
  } catch (e) {
    erro.value = e.response?.data?.error || 'Não foi possível excluir.';
    confirmar.value = null;
  }
}

onMounted(carregar);
</script>

<template>
  <div class="conf-tabs">
    <button v-for="a in abas" :key="a.id" class="conf-tab" :class="{ active: aba === a.id }" @click="aba = a.id">
      {{ a.icon }} {{ a.label }}
    </button>
  </div>

  <div v-if="erro" class="form-erro" style="margin-bottom:12px;">{{ erro }}</div>

  <ClinicaConfig v-if="aba === 'clinica'" />
  <UsuariosConfig v-else-if="aba === 'usuarios'" />
  <ConveniosConfig v-else-if="aba === 'convenios'" />

  <!-- Profissionais -->
  <div v-if="aba === 'profissionais'">
    <div class="pac-toolbar">
      <span style="color:var(--gray-500);font-size:12px;">{{ profissionais.length }} profissional(is)</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="novo">＋ Novo profissional</button>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table>
        <thead>
          <tr><th></th><th>Nome</th><th>Especialidade</th><th>Conselho</th><th>Horário</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in profissionais" :key="p.id">
            <td style="width:24px;"><span class="cor-dot" :style="{ background: p.cor }"></span></td>
            <td><strong>{{ p.nome }}</strong></td>
            <td>{{ p.especialidade || '—' }}</td>
            <td>{{ p.conselho || '—' }}</td>
            <td style="font-size:11px;color:var(--gray-600);max-width:280px;">{{ resumoHorario(p) }}</td>
            <td>
              <span class="badge" :class="p.ativo !== false ? 'badge-green' : 'badge-gray'">{{ p.ativo !== false ? 'Ativo' : 'Inativo' }}</span>
            </td>
            <td style="white-space:nowrap;">
              <button class="btn btn-secondary btn-sm" @click="editar(p)">✏️ Editar</button>
              <button class="btn btn-secondary btn-sm" @click="toggleAtivo(p)">{{ p.ativo !== false ? 'Desativar' : 'Ativar' }}</button>
              <button class="btn btn-danger btn-sm" @click="confirmar = p">Excluir</button>
            </td>
          </tr>
          <tr v-if="!profissionais.length"><td colspan="7" class="empty">Nenhum profissional cadastrado.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <ProfessionalForm v-if="form" :professional="form.professional" @close="form = null" @saved="onSaved" />

  <!-- Confirmar exclusão -->
  <div v-if="confirmar" class="modal-backdrop active" @click.self="confirmar = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Excluir profissional</div>
        <button class="modal-close" @click="confirmar = null">×</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;">Tem certeza que deseja excluir <strong>{{ confirmar.nome }}</strong>? Esta ação não pode ser desfeita.</p>
        <p style="font-size:12px;color:var(--gray-500);margin-top:8px;">Se o profissional já tiver consultas no histórico, o sistema vai sugerir desativá-lo em vez de excluir.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="confirmar = null">Cancelar</button>
        <button class="btn btn-danger" @click="excluir">Excluir</button>
      </div>
    </div>
  </div>
</template>
