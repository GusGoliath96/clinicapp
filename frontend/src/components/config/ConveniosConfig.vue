<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../../api/client.js';

const convenios = ref([]);
const erro = ref('');
const form = ref(null);
const editando = computed(() => Boolean(form.value?.id));

async function carregar() { convenios.value = (await api.get('/convenios')).data; }

function novo() { erro.value = ''; form.value = { nome: '', codigo_ans: '', prazo_pgto: 0, repasse_default: null, ativo: true }; }
function editar(c) { erro.value = ''; form.value = { ...c }; }

async function salvar() {
  const b = form.value;
  if (!b.nome) { erro.value = 'O nome é obrigatório.'; return; }
  const payload = {
    nome: b.nome, codigo_ans: b.codigo_ans || null,
    prazo_pgto: Number(b.prazo_pgto) || 0,
    repasse_default: b.repasse_default === '' || b.repasse_default == null ? null : Number(b.repasse_default),
    ativo: b.ativo,
  };
  try {
    if (editando.value) await api.put(`/convenios/${b.id}`, payload);
    else await api.post('/convenios', payload);
    form.value = null;
    carregar();
  } catch (e) { erro.value = e.response?.data?.error || 'Não foi possível salvar.'; }
}

async function excluir(c) {
  if (!confirm(`Excluir o convênio ${c.nome}?`)) return;
  try { await api.delete(`/convenios/${c.id}`); carregar(); }
  catch (e) { erro.value = e.response?.data?.error || 'Não foi possível excluir.'; }
}

onMounted(carregar);
</script>

<template>
  <div v-if="erro" class="form-erro" style="margin-bottom:12px;">{{ erro }}</div>
  <div class="pac-toolbar">
    <span style="color:var(--gray-500);font-size:12px;">{{ convenios.length }} convênio(s)</span>
    <button class="btn btn-primary btn-sm" style="margin-left:auto;" @click="novo">＋ Novo convênio</button>
  </div>

  <div class="card" style="padding:0;overflow:hidden;">
    <table>
      <thead><tr><th>Nome</th><th>Código ANS</th><th>Prazo pgto</th><th>Repasse</th><th>Status</th><th></th></tr></thead>
      <tbody>
        <tr v-for="c in convenios" :key="c.id">
          <td><strong>{{ c.nome }}</strong></td>
          <td>{{ c.codigo_ans || '—' }}</td>
          <td>{{ c.prazo_pgto ? c.prazo_pgto + ' dias' : 'À vista' }}</td>
          <td>{{ c.repasse_default != null ? c.repasse_default + '%' : '—' }}</td>
          <td><span class="badge" :class="c.ativo ? 'badge-green' : 'badge-gray'">{{ c.ativo ? 'Ativo' : 'Inativo' }}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" @click="editar(c)">✏️ Editar</button>
            <button class="btn btn-danger btn-sm" @click="excluir(c)">Excluir</button>
          </td>
        </tr>
        <tr v-if="!convenios.length"><td colspan="6" class="empty">Nenhum convênio.</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="form" class="modal-backdrop active" @click.self="form = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">{{ editando ? '✏️ Editar convênio' : '＋ Novo convênio' }}</div>
        <button class="modal-close" @click="form = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>
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
        <button class="btn btn-primary" @click="salvar">{{ editando ? 'Salvar' : 'Cadastrar' }}</button>
      </div>
    </div>
  </div>
</template>
