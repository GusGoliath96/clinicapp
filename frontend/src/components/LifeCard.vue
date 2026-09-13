<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '../api/client.js';
import { initials, colorFor } from '../utils/ui.js';
import PatientForm from './PatientForm.vue';

const props = defineProps({ patientId: { type: String, required: true } });
const emit = defineEmits(['close', 'edited']);

const editing = ref(false);
const novaTag = ref('');

function onEditado(data) {
  paciente.value = data;
  editing.value = false;
  emit('edited');
}

async function saveTags(tags) {
  const { data } = await api.put(`/patients/${props.patientId}`, { tags });
  paciente.value.tags = data.tags;
  emit('edited');
}
function addTag() {
  const t = novaTag.value.trim();
  novaTag.value = '';
  if (!t) return;
  const atual = paciente.value.tags || [];
  if (atual.includes(t)) return;
  saveTags([...atual, t]);
}
function removeTag(t) { saveTags((paciente.value.tags || []).filter((x) => x !== t)); }

const TABS = [
  { slug: 'identificacao', icon: '📇', label: 'Identificação' },
  { slug: 'contato', icon: '📞', label: 'Contato' },
  { slug: 'convenio', icon: '💳', label: 'Convênio' },
  { slug: 'etiquetas', icon: '🏷️', label: 'Etiquetas' },
  { slug: 'consultas', icon: '📅', label: 'Consultas' },
  { slug: 'exames', icon: '🔬', label: 'Exames' },
  { slug: 'tratamentos', icon: '🎁', label: 'Tratamentos' },
  { slug: 'documentos', icon: '📄', label: 'Documentos' },
  { slug: 'prontuario', icon: '📝', label: 'Prontuário' },
  { slug: 'timeline', icon: '🕐', label: 'Timeline' },
  { slug: 'lgpd', icon: '🔒', label: 'LGPD' },
];
const STATUS_APPT = { agendado: 'Agendado', confirmado: 'Confirmado', em_atendimento: 'Em atend.', realizado: 'Realizado', cancelado: 'Cancelado', falta: 'Falta' };
const STATUS_EXAME = { solicitado: 'Solicitado', coletado: 'Coletado', resultado_disponivel: 'Resultado disponível' };
const TIPO_NOTA = { anamnese: '📝 Anamnese', evolucao: '🩺 Evolução', atestado: '📄 Atestado', receita: '💊 Receita' };
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const paciente = ref(null);
const activeTab = ref('identificacao');
const consultas = ref(null);
const exames = ref(null);
const tratamentos = ref(null);
const documentos = ref(null);
const notas = ref(null);
const timeline = ref(null);

const idadeTxt = computed(() => {
  const n = paciente.value?.nascimento;
  if (!n) return '—';
  const anos = Math.floor((Date.now() - new Date(n).getTime()) / (365.25 * 864e5));
  return `${anos} anos`;
});
const ehVip = computed(() => (paciente.value?.tags || []).includes('VIP'));

function fmtDia(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'; }
function fmtDataHora(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

async function loadPatient() {
  consultas.value = exames.value = tratamentos.value = documentos.value = notas.value = timeline.value = null;
  paciente.value = (await api.get(`/patients/${props.patientId}`)).data;
  activeTab.value = 'identificacao';
}

async function openTab(slug) {
  activeTab.value = slug;
  const pid = props.patientId;
  const params = { patientId: pid };
  if (slug === 'consultas' && !consultas.value) consultas.value = (await api.get('/appointments', { params })).data;
  if (slug === 'exames' && !exames.value) exames.value = (await api.get('/exams', { params })).data;
  if (slug === 'tratamentos' && !tratamentos.value) tratamentos.value = (await api.get('/treatments', { params })).data;
  if (slug === 'documentos' && !documentos.value) documentos.value = (await api.get('/documents', { params })).data;
  if (slug === 'prontuario' && !notas.value) notas.value = (await api.get('/clinical-notes', { params })).data;
  if (slug === 'timeline' && !timeline.value) timeline.value = (await api.get(`/patients/${pid}/timeline`)).data;
}

onMounted(loadPatient);
watch(() => props.patientId, loadPatient);
</script>

<template>
  <div class="cv-modal" @click.self="emit('close')">
    <div class="cv-panel" v-if="paciente">
      <!-- Header -->
      <div class="cv-header">
        <div class="cv-avatar" :style="{ background: colorFor(paciente.nome) }">{{ initials(paciente.nome) }}</div>
        <div class="cv-header-info">
          <div class="cv-nome">{{ paciente.nome }}</div>
          <div class="cv-meta">
            <span class="cv-meta-item">🧬 {{ paciente.sexo || '—' }} · {{ idadeTxt }}</span>
            <span class="cv-meta-item">💳 {{ paciente.convenio || 'Particular' }}</span>
            <span class="cv-meta-item">📞 {{ paciente.telefone || '—' }}</span>
            <span v-if="ehVip" class="cv-badge vip">⭐ VIP</span>
            <span v-if="paciente.consentimento_lgpd" class="cv-badge">🔒 LGPD ✓</span>
          </div>
        </div>
        <button class="cv-edit" @click="editing = true">✏️ Editar</button>
        <button class="cv-close" @click="emit('close')">×</button>
      </div>

      <!-- Tabs -->
      <div class="cv-tabs">
        <button v-for="t in TABS" :key="t.slug" class="cv-tab" :class="{ active: activeTab === t.slug }" @click="openTab(t.slug)">
          {{ t.icon }} {{ t.label }}
        </button>
      </div>

      <!-- Body -->
      <div class="cv-body">
        <!-- Identificação -->
        <div v-if="activeTab === 'identificacao'" class="cv-tab-content">
          <div class="cv-grid-3">
            <div class="cv-field"><div class="cv-field-label">Nome</div><div class="cv-field-val">{{ paciente.nome }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Nome social</div><div class="cv-field-val">{{ paciente.nome_social || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Nascimento</div><div class="cv-field-val">{{ fmtDia(paciente.nascimento) }} ({{ idadeTxt }})</div></div>
            <div class="cv-field"><div class="cv-field-label">Sexo</div><div class="cv-field-val">{{ paciente.sexo || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">CPF</div><div class="cv-field-val">{{ paciente.cpf || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">RG</div><div class="cv-field-val">{{ paciente.rg || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Origem</div><div class="cv-field-val">{{ paciente.origem || '—' }}</div></div>
          </div>
        </div>

        <!-- Contato -->
        <div v-else-if="activeTab === 'contato'" class="cv-tab-content">
          <div class="cv-section">
            <div class="cv-section-title">📞 Contato</div>
            <div class="cv-grid-2">
              <div class="cv-field"><div class="cv-field-label">Telefone</div><div class="cv-field-val">{{ paciente.telefone || '—' }}</div></div>
              <div class="cv-field"><div class="cv-field-label">E-mail</div><div class="cv-field-val">{{ paciente.email || '—' }}</div></div>
            </div>
          </div>
          <div class="cv-section">
            <div class="cv-section-title">📍 Endereço</div>
            <div class="cv-field-val" v-if="paciente.endereco && paciente.endereco.rua">
              {{ paciente.endereco.rua }}, {{ paciente.endereco.numero }}{{ paciente.endereco.complemento ? ' · ' + paciente.endereco.complemento : '' }}<br />
              {{ paciente.endereco.bairro }} — {{ paciente.endereco.cidade }}/{{ paciente.endereco.uf }} · {{ paciente.endereco.cep }}
            </div>
            <div v-else class="cv-empty">Sem endereço cadastrado</div>
          </div>
          <div class="cv-section">
            <div class="cv-section-title">🆘 Contato de emergência</div>
            <div class="cv-field-val" v-if="paciente.contato_emergencia && paciente.contato_emergencia.nome">
              {{ paciente.contato_emergencia.nome }} ({{ paciente.contato_emergencia.parentesco }}) · {{ paciente.contato_emergencia.tel }}
            </div>
            <div v-else class="cv-empty">Não informado</div>
          </div>
        </div>

        <!-- Convênio -->
        <div v-else-if="activeTab === 'convenio'" class="cv-tab-content">
          <div class="cv-grid-2">
            <div class="cv-field"><div class="cv-field-label">Operadora</div><div class="cv-field-val">{{ paciente.convenio_detalhe?.operadora || paciente.convenio || 'Particular' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Plano</div><div class="cv-field-val">{{ paciente.convenio_detalhe?.plano || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Matrícula</div><div class="cv-field-val">{{ paciente.convenio_detalhe?.matricula || '—' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Validade</div><div class="cv-field-val">{{ paciente.convenio_detalhe?.validade || '—' }}</div></div>
          </div>
        </div>

        <!-- Etiquetas -->
        <div v-else-if="activeTab === 'etiquetas'" class="cv-tab-content">
          <div v-if="(paciente.tags || []).length" style="margin-bottom:14px;">
            <span v-for="t in paciente.tags" :key="t" class="cv-tag cv-tag-edit">
              {{ t }}<button class="cv-tag-x" @click="removeTag(t)">×</button>
            </span>
          </div>
          <div v-else class="cv-empty" style="padding:16px;">Sem etiquetas</div>
          <div style="display:flex;gap:6px;max-width:340px;">
            <input class="form-input" v-model="novaTag" placeholder="Nova etiqueta (ex.: VIP)" @keydown.enter.prevent="addTag" />
            <button class="btn btn-primary btn-sm" @click="addTag">Adicionar</button>
          </div>
        </div>

        <!-- Consultas -->
        <div v-else-if="activeTab === 'consultas'" class="cv-tab-content">
          <table v-if="consultas && consultas.length" class="cv-table">
            <thead><tr><th>Data</th><th>Profissional</th><th>Tipo</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="a in consultas" :key="a.id">
                <td>{{ fmtDataHora(a.inicio) }}</td>
                <td>{{ a.profissional_nome }}</td>
                <td>{{ a.tipo || '—' }}</td>
                <td>{{ STATUS_APPT[a.status] || a.status }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="consultas" class="cv-empty">Nenhuma consulta registrada</div>
          <div v-else class="cv-empty">Carregando…</div>
        </div>

        <!-- Exames -->
        <div v-else-if="activeTab === 'exames'" class="cv-tab-content">
          <table v-if="exames && exames.length" class="cv-table">
            <thead><tr><th>Exame</th><th>Solicitante</th><th>Solicitado</th><th>Resultado</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="e in exames" :key="e.id">
                <td><strong>{{ e.nome }}</strong><div style="font-size:10px;color:var(--gray-500);">{{ e.tipo }}</div></td>
                <td>{{ e.profissional_nome || '—' }}</td>
                <td>{{ fmtDia(e.data_solicitacao) }}</td>
                <td>{{ e.laudo || (e.data_resultado ? fmtDia(e.data_resultado) : '—') }}</td>
                <td><span class="cv-tag" :class="{ ok: e.status === 'resultado_disponivel', warn: e.status === 'solicitado' }">{{ STATUS_EXAME[e.status] || e.status }}</span></td>
                <td><a v-if="e.arquivo_url" :href="apiBase + e.arquivo_url" target="_blank" class="cv-tag" style="text-decoration:none;">📄 PDF</a></td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="exames" class="cv-empty">Nenhum exame vinculado</div>
          <div v-else class="cv-empty">Carregando…</div>
        </div>

        <!-- Tratamentos -->
        <div v-else-if="activeTab === 'tratamentos'" class="cv-tab-content">
          <template v-if="tratamentos && tratamentos.length">
            <div v-for="t in tratamentos" :key="t.id" class="cv-list-item" style="border-left-color:var(--purple);">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>{{ t.nome }}</strong>
                <span class="cv-tag" :class="{ ok: t.status === 'concluido', warn: t.status === 'ativo' }">{{ t.status }}</span>
              </div>
              <div style="font-size:11px;color:var(--gray-600);margin-top:4px;">
                {{ t.profissional_nome || '—' }} ·
                {{ t.total_sessoes ? `${t.sessoes_feitas}/${t.total_sessoes} sessões` : t.tipo }}
                <span v-if="t.valor"> · R$ {{ Number(t.valor).toLocaleString('pt-BR') }}</span>
              </div>
              <div v-if="t.total_sessoes" class="cv-progress"><div class="cv-progress-bar" :style="{ width: Math.min(100, (t.sessoes_feitas / t.total_sessoes) * 100) + '%' }"></div></div>
            </div>
          </template>
          <div v-else-if="tratamentos" class="cv-empty">Nenhum tratamento ou pacote</div>
          <div v-else class="cv-empty">Carregando…</div>
        </div>

        <!-- Documentos -->
        <div v-else-if="activeTab === 'documentos'" class="cv-tab-content">
          <template v-if="documentos && documentos.length">
            <div v-for="d in documentos" :key="d.id" class="cv-list-item">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span>📄 <strong>{{ d.nome }}</strong> <span style="color:var(--gray-500);font-size:11px;">· {{ d.tipo }}</span></span>
                <span class="cv-tag" :class="d.status === 'validado' ? 'ok' : 'warn'">{{ d.status }}</span>
              </div>
              <div style="font-size:10px;color:var(--gray-500);margin-top:3px;">{{ fmtDia(d.data) }}</div>
            </div>
          </template>
          <div v-else-if="documentos" class="cv-empty">Nenhum documento</div>
          <div v-else class="cv-empty">Carregando…</div>
        </div>

        <!-- Prontuário -->
        <div v-else-if="activeTab === 'prontuario'" class="cv-tab-content">
          <div class="cv-section">
            <div class="cv-section-title">⚠️ Alergias</div>
            <div v-if="(paciente.alergias || []).length"><span v-for="a in paciente.alergias" :key="a" class="cv-tag danger">{{ a }}</span></div>
            <div v-else class="cv-empty">Nenhuma alergia registrada</div>
          </div>
          <div class="cv-section">
            <div class="cv-section-title">🩺 Comorbidades</div>
            <div v-if="(paciente.comorbidades || []).length"><span v-for="c in paciente.comorbidades" :key="c" class="cv-tag warn">{{ c }}</span></div>
            <div v-else class="cv-empty">Nenhuma</div>
          </div>
          <div class="cv-section">
            <div class="cv-section-title">💊 Medicações</div>
            <div v-if="(paciente.medicacoes || []).length"><span v-for="m in paciente.medicacoes" :key="m" class="cv-tag">{{ m }}</span></div>
            <div v-else class="cv-empty">Nenhuma</div>
          </div>
          <div class="cv-section">
            <div class="cv-section-title">📝 Evoluções e notas</div>
            <template v-if="notas && notas.length">
              <div v-for="n in notas" :key="n.id" class="cv-list-item">
                <div style="display:flex;justify-content:space-between;">
                  <strong>{{ TIPO_NOTA[n.tipo] || n.tipo }}</strong>
                  <span style="font-size:10px;color:var(--gray-500);">{{ fmtDataHora(n.data) }} · {{ n.profissional_nome || '—' }}</span>
                </div>
                <div style="font-size:12px;color:var(--gray-700);margin-top:4px;">{{ n.conteudo }}</div>
              </div>
            </template>
            <div v-else-if="notas" class="cv-empty">Sem registros no prontuário</div>
            <div v-else class="cv-empty">Carregando…</div>
          </div>
        </div>

        <!-- Timeline -->
        <div v-else-if="activeTab === 'timeline'" class="cv-tab-content">
          <template v-if="timeline && timeline.length">
            <div v-for="(ev, i) in timeline" :key="i" class="cv-timeline-item">
              <div>
                <div style="font-size:12px;font-weight:600;">{{ ev.titulo }}</div>
                <div style="font-size:11px;color:var(--gray-600);">{{ ev.descricao }}</div>
                <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">{{ fmtDataHora(ev.data) }}</div>
              </div>
            </div>
          </template>
          <div v-else-if="timeline" class="cv-empty">Sem histórico</div>
          <div v-else class="cv-empty">Carregando…</div>
        </div>

        <!-- LGPD -->
        <div v-else-if="activeTab === 'lgpd'" class="cv-tab-content">
          <div class="cv-grid-2">
            <div class="cv-field"><div class="cv-field-label">Consentimento LGPD</div><div class="cv-field-val">{{ paciente.consentimento_lgpd ? '✅ Consentido' : '⚠️ Pendente' }}</div></div>
            <div class="cv-field"><div class="cv-field-label">Data do consentimento</div><div class="cv-field-val">{{ fmtDataHora(paciente.consentimento_em) }}</div></div>
          </div>
        </div>
      </div>
    </div>

    <PatientForm v-if="editing && paciente" :patient="paciente" @close="editing = false" @saved="onEditado" />
  </div>
</template>
