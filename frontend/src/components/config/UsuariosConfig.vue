<script setup>
import { reactive, ref, computed, onMounted } from 'vue';
import { api } from '../../api/client.js';
import { useAuth } from '../../stores/auth.js';

const auth = useAuth();
const PAPEIS_LABEL = { admin: 'Administrador', recepcao: 'Recepção', medico: 'Médico' };

const usuarios = ref([]);
const profissionais = ref([]);
const erro = ref('');
const form = ref(null); // objeto de edição/criação
const editando = computed(() => Boolean(form.value?.id));

async function carregar() {
  const [u, p] = await Promise.all([api.get('/users'), api.get('/professionals')]);
  usuarios.value = u.data;
  profissionais.value = p.data;
}

function novo() { erro.value = ''; form.value = { nome: '', email: '', papel: 'recepcao', senha: '', ativo: true, professional_id: '' }; }
function editar(u) { erro.value = ''; form.value = { id: u.id, nome: u.nome, email: u.email, papel: u.papel, senha: '', ativo: u.ativo, professional_id: u.professional_id || '' }; }

async function salvar() {
  const b = form.value;
  if (!b.nome || !b.email || (!editando.value && !b.senha)) { erro.value = 'Nome, e-mail e senha são obrigatórios.'; return; }
  const payload = { nome: b.nome, email: b.email, papel: b.papel, ativo: b.ativo, professional_id: b.professional_id || null };
  if (b.senha) payload.senha = b.senha;
  try {
    if (editando.value) await api.put(`/users/${b.id}`, payload);
    else await api.post('/users', payload);
    form.value = null;
    carregar();
  } catch (e) { erro.value = e.response?.data?.error || 'Não foi possível salvar.'; }
}

async function excluir(u) {
  erro.value = '';
  if (!confirm(`Excluir o usuário ${u.nome}?`)) return;
  try { await api.delete(`/users/${u.id}`); carregar(); }
  catch (e) { erro.value = e.response?.data?.error || 'Não foi possível excluir.'; }
}

onMounted(carregar);
</script>

<template>
  <div v-if="erro" class="form-erro" style="margin-bottom:12px;">{{ erro }}</div>
  <div class="pac-toolbar">
    <span style="color:var(--gray-500);font-size:12px;">{{ usuarios.length }} usuário(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="novo">＋ Novo usuário</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="u in usuarios" :key="u.id">
          <td><strong>{{ u.nome }}</strong><span v-if="u.id === auth.user?.id" style="font-size:10px;color:var(--gray-500);"> (você)</span></td>
          <td>{{ u.email }}</td>
          <td>{{ PAPEIS_LABEL[u.papel] || u.papel }}<div v-if="u.profissional_nome" style="font-size:10px;color:var(--gray-500);">🔗 {{ u.profissional_nome }}</div></td>
          <td><span class="badge" :class="u.ativo ? 'badge-green' : 'badge-gray'">{{ u.ativo ? 'Ativo' : 'Inativo' }}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" @click="editar(u)">✏️ Editar</button>
            <button class="btn btn-danger btn-sm" :disabled="u.id === auth.user?.id" @click="excluir(u)">Excluir</button>
          </td>
        </tr>
        <tr v-if="!usuarios.length"><td colspan="5" class="empty">Nenhum usuário.</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="form" class="modal-backdrop active" @click.self="form = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">{{ editando ? '✏️ Editar usuário' : '＋ Novo usuário' }}</div>
        <button class="modal-close" @click="form = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>
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
            <option v-for="p in profissionais" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.especialidade }}</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">Senha {{ editando ? '(deixe em branco para manter)' : '*' }}</label>
          <input type="password" class="form-input" v-model="form.senha" autocomplete="new-password" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="form = null">Cancelar</button>
        <button class="btn btn-primary" @click="salvar">{{ editando ? 'Salvar' : 'Cadastrar' }}</button>
      </div>
    </div>
  </div>
</template>
