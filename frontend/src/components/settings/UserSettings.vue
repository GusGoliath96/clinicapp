<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';

// O form espelha o payload da API, que segue em português (nome, papel, ativo, senha).

const auth = useAuth();
const ROLE_LABEL = { admin: 'Administrador', recepcao: 'Recepção', medico: 'Médico' };

const users = ref([]);
const professionals = ref([]);
const error = ref('');
const form = ref(null); // objeto de edição/criação
const editing = computed(() => Boolean(form.value?.id));

async function load() {
  try {
    const [u, p] = await Promise.all([api.get('/users'), api.get('/professionals')]);
    users.value = u.data;
    professionals.value = p.data;
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível carregar os usuários.';
  }
}

function create() {
  error.value = '';
  form.value = { nome: '', email: '', papel: 'recepcao', senha: '', ativo: true, professional_id: '' };
}

function edit(u) {
  error.value = '';
  form.value = {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel,
    senha: '', ativo: u.ativo, professional_id: u.professional_id || '',
  };
}

async function save() {
  const f = form.value;
  if (!f.nome || !f.email || (!editing.value && !f.senha)) {
    error.value = 'Nome, e-mail e senha são obrigatórios.';
    return;
  }
  const payload = {
    nome: f.nome, email: f.email, papel: f.papel, ativo: f.ativo,
    professional_id: f.professional_id || null,
  };
  if (f.senha) payload.senha = f.senha;
  try {
    if (editing.value) await api.put(`/users/${f.id}`, payload);
    else await api.post('/users', payload);
    form.value = null;
    load();
  } catch (e) {
    error.value = e.response?.data?.error || 'Não foi possível salvar.';
  }
}

async function remove(u) {
  error.value = '';
  if (!confirm(`Excluir o usuário ${u.nome}?`)) return;
  try { await api.delete(`/users/${u.id}`); load(); }
  catch (e) { error.value = e.response?.data?.error || 'Não foi possível excluir.'; }
}

onMounted(load);
</script>

<template>
  <div v-if="error" class="form-erro" style="margin-bottom:12px;">{{ error }}</div>
  <div class="pac-toolbar">
    <span style="color:var(--gray-500);font-size:12px;">{{ users.length }} usuário(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="create">＋ Novo usuário</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td><strong>{{ u.nome }}</strong><span v-if="u.id === auth.user?.id" style="font-size:10px;color:var(--gray-500);"> (você)</span></td>
          <td>{{ u.email }}</td>
          <td>{{ ROLE_LABEL[u.papel] || u.papel }}<div v-if="u.profissional_nome" style="font-size:10px;color:var(--gray-500);">🔗 {{ u.profissional_nome }}</div></td>
          <td><span class="badge" :class="u.ativo ? 'badge-green' : 'badge-gray'">{{ u.ativo ? 'Ativo' : 'Inativo' }}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" @click="edit(u)">✏️ Editar</button>
            <button class="btn btn-danger btn-sm" :disabled="u.id === auth.user?.id" @click="remove(u)">Excluir</button>
          </td>
        </tr>
        <tr v-if="!users.length"><td colspan="5" class="empty">Nenhum usuário.</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="form" class="modal-backdrop active" @click.self="form = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">{{ editing ? '✏️ Editar usuário' : '＋ Novo usuário' }}</div>
        <button class="modal-close" @click="form = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="error" class="form-erro">{{ error }}</div>
        <div class="form-row"><label class="form-label">Nome <span class="required">*</span></label><input class="form-input" v-model="form.nome" /></div>
        <div class="form-row"><label class="form-label">E-mail <span class="required">*</span></label><input class="form-input" v-model="form.email" /></div>
        <div class="row-2">
          <div class="form-row">
            <label class="form-label">Papel</label>
            <select class="form-input" v-model="form.papel"><option value="recepcao">Recepção</option><option value="medico">Médico</option><option value="admin">Administrador</option></select>
          </div>
          <div class="form-row">
            <label class="form-label">Status</label>
            <select class="form-input" v-model="form.ativo"><option :value="true">Ativo</option><option :value="false">Inativo</option></select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">Profissional vinculado <span style="font-weight:400;color:var(--gray-500);">(médico cai direto na própria fila)</span></label>
          <select class="form-input" v-model="form.professional_id">
            <option value="">Nenhum</option>
            <option v-for="p in professionals" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.especialidade }}</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">Senha {{ editing ? '(deixe em branco para manter)' : '*' }}</label>
          <input type="password" class="form-input" v-model="form.senha" autocomplete="new-password" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="form = null">Cancelar</button>
        <button class="btn btn-primary" @click="save">{{ editing ? 'Salvar' : 'Cadastrar' }}</button>
      </div>
    </div>
  </div>
</template>
