<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../../api/client.js';

// A rota segue /convenios e o payload em português — contrato de API preservado.

const plans = ref([]);
const error = ref('');
const form = ref(null);
const editing = computed(() => Boolean(form.value?.id));

async function load() { plans.value = (await api.get('/convenios')).data; }

function create() {
  error.value = '';
  form.value = { nome: '', codigo_ans: '', prazo_pgto: 0, repasse_default: null, ativo: true };
}
function edit(c) { error.value = ''; form.value = { ...c }; }

async function save() {
  const f = form.value;
  if (!f.nome) { error.value = 'O nome é obrigatório.'; return; }
  const payload = {
    nome: f.nome, codigo_ans: f.codigo_ans || null,
    prazo_pgto: Number(f.prazo_pgto) || 0,
    repasse_default: f.repasse_default === '' || f.repasse_default == null ? null : Number(f.repasse_default),
    ativo: f.ativo,
  };
  try {
    if (editing.value) await api.put(`/convenios/${f.id}`, payload);
    else await api.post('/convenios', payload);
    form.value = null;
    load();
  } catch (e) { error.value = e.response?.data?.error || 'Não foi possível salvar.'; }
}

async function remove(c) {
  if (!confirm(`Excluir o convênio ${c.nome}?`)) return;
  try { await api.delete(`/convenios/${c.id}`); load(); }
  catch (e) { error.value = e.response?.data?.error || 'Não foi possível excluir.'; }
}

onMounted(load);
</script>

<template>
  <div v-if="error" class="form-erro" style="margin-bottom:12px;">{{ error }}</div>
  <div class="pac-toolbar">
    <span style="color:var(--gray-500);font-size:12px;">{{ plans.length }} convênio(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="create">＋ Novo convênio</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead><tr><th>Nome</th><th>Código ANS</th><th>Prazo pgto</th><th>Repasse</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="c in plans" :key="c.id">
          <td><strong>{{ c.nome }}</strong></td>
          <td>{{ c.codigo_ans || '—' }}</td>
          <td>{{ c.prazo_pgto ? c.prazo_pgto + ' dias' : 'À vista' }}</td>
          <td>{{ c.repasse_default != null ? c.repasse_default + '%' : '—' }}</td>
          <td><span class="badge" :class="c.ativo ? 'badge-green' : 'badge-gray'">{{ c.ativo ? 'Ativo' : 'Inativo' }}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" @click="edit(c)">✏️ Editar</button>
            <button class="btn btn-danger btn-sm" @click="remove(c)">Excluir</button>
          </td>
        </tr>
        <tr v-if="!plans.length"><td colspan="6" class="empty">Nenhum convênio.</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="form" class="modal-backdrop active" @click.self="form = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">{{ editing ? '✏️ Editar convênio' : '＋ Novo convênio' }}</div>
        <button class="modal-close" @click="form = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="error" class="form-erro">{{ error }}</div>
        <div class="form-row"><label class="form-label">Nome <span class="required">*</span></label><input class="form-input" v-model="form.nome" placeholder="Unimed, Particular..." /></div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Código ANS</label><input class="form-input" v-model="form.codigo_ans" placeholder="339679" /></div>
          <div class="form-row">
            <label class="form-label">Status</label>
            <select class="form-input" v-model="form.ativo"><option :value="true">Ativo</option><option :value="false">Inativo</option></select>
          </div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Prazo de pagamento (dias)</label><input type="number" class="form-input" v-model="form.prazo_pgto" min="0" /></div>
          <div class="form-row"><label class="form-label">Repasse padrão (%)</label><input type="number" class="form-input" v-model="form.repasse_default" min="0" max="100" step="1" /></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="form = null">Cancelar</button>
        <button class="btn btn-primary" @click="save">{{ editing ? 'Salvar' : 'Cadastrar' }}</button>
      </div>
    </div>
  </div>
</template>
