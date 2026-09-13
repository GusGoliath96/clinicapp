<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api } from '../api/client.js';
import { initials, colorFor, time } from '../utils/ui.js';
import LifeCard from '../components/LifeCard.vue';
import AutoComplete from '../components/AutoComplete.vue';

const TABS = [
  { id: 'anamnese', tipo: 'anamnese', icon: '📝', label: 'Anamnese' },
  { id: 'avaliacao', tipo: 'avaliacao', icon: '📊', label: 'Avaliação' },
  { id: 'evolucao', tipo: 'evolucao', icon: '📋', label: 'Evolução' },
  { id: 'receita', tipo: 'receita', icon: '💊', label: 'Receituário', doc: 'Receituário' },
  { id: 'atestado', tipo: 'atestado', icon: '📄', label: 'Atestado', doc: 'Atestado' },
  { id: 'exames', icon: '🔬', label: 'Exames' },
];
const STATUS_FILA = ['agendado', 'confirmado', 'em_atendimento'];
const STATUS_LABEL = { agendado: 'Agendado', confirmado: 'Confirmado', em_atendimento: 'Em atendimento', realizado: 'Realizado' };
// Ciclo de vida do exame: pedido → paciente realiza → laudo chega.
const STATUS_EXAME_OPCOES = [
  { v: 'solicitado', label: 'Solicitado' },
  { v: 'coletado', label: 'Realizado' },
  { v: 'resultado_disponivel', label: 'Resultado disponível' },
];
// Receita estruturada — campos exigidos pela legislação (via, posologia, quantidade).
const VIAS = ['Uso oral', 'Uso sublingual', 'Uso tópico', 'Uso nasal', 'Uso oftálmico', 'Uso otológico', 'Uso inalatório', 'Uso retal', 'Uso vaginal', 'Injetável (IM)', 'Injetável (SC)', 'Injetável (EV)'];
const FREQ_SUGESTOES = ['1x ao dia', '2x ao dia (12/12h)', '3x ao dia (8/8h)', '4x ao dia (6/6h)', 'de 8 em 8 horas', 'de 12 em 12 horas', 'à noite ao deitar', 'pela manhã em jejum', 'se dor', 'dose única'];
const DURACAO_SUGESTOES = ['3 dias', '5 dias', '7 dias', '10 dias', '14 dias', '30 dias', 'uso contínuo', 'enquanto durarem os sintomas'];
// Atestado estruturado
const ATESTADO_TIPOS = [
  { v: 'afastamento', label: 'Afastamento de atividades' },
  { v: 'repouso', label: 'Repouso' },
  { v: 'comparecimento', label: 'Comparecimento' },
  { v: 'aptidao', label: 'Aptidão física' },
  { v: 'outro', label: 'Outro (texto livre)' },
];

const meProfId = ref(null);
const professionals = ref([]);
const profId = ref('');
const fila = ref([]);
const selApt = ref(null);
const paciente = ref(null);
const activeTab = ref('anamnese');
const editor = ref({ noteId: null, conteudo: '', dados: null });
const historico = ref([]);
const exames = ref([]);
const newExam = ref({ nome: '', tipo: '', indicacao: '' });
const savingNote = ref(false);
const salvoFlash = ref(false);
const cardId = ref(null);
const clinica = ref({ nome: 'Clínica', config: {} });
const careStart = ref(null);
const agora = ref(Date.now());
let timerInt;

const profSel = computed(() => professionals.value.find((p) => p.id === profId.value) || null);
const sortedQueue = computed(() => fila.value
  .filter((a) => STATUS_FILA.includes(a.status))
  .sort((a, b) => new Date(a.inicio) - new Date(b.inicio)));
const currentTab = computed(() => TABS.find((t) => t.id === activeTab.value));
const cronometro = computed(() => {
  if (!careStart.value) return '';
  const s = Math.floor((agora.value - careStart.value) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});

function todayRange() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const f = new Date(); f.setHours(23, 59, 59, 999);
  return { de: d.toISOString(), ate: f.toISOString() };
}

async function loadQueue() {
  if (!profId.value) { fila.value = []; return; }
  const { de, ate } = todayRange();
  fila.value = (await api.get('/appointments', { params: { de, ate, professionalId: profId.value } })).data;
}

async function selecionar(apt) {
  selApt.value = apt;
  activeTab.value = 'anamnese';
  careStart.value = apt.status === 'em_atendimento' ? Date.now() : null;
  paciente.value = null;
  if (apt.patient_id) {
    try { paciente.value = (await api.get(`/patients/${apt.patient_id}`)).data; } catch {}
  }
  await loadTab();
}

async function iniciar() {
  const { data } = await api.put(`/appointments/${selApt.value.id}`, { status: 'em_atendimento' });
  selApt.value = { ...selApt.value, ...data };
  careStart.value = Date.now();
  loadQueue();
}
async function finalizar() {
  const { data } = await api.put(`/appointments/${selApt.value.id}`, { status: 'realizado' });
  selApt.value = { ...selApt.value, ...data };
  careStart.value = null;
  loadQueue();
}

async function loadTab() {
  const t = currentTab.value;
  editor.value = { noteId: null, conteudo: '', dados: null };
  historico.value = [];
  exames.value = [];
  if (!selApt.value) return;
  if (t.tipo) {
    const daConsulta = (await api.get('/clinical-notes', { params: { appointmentId: selApt.value.id, tipo: t.tipo } })).data;
    if (daConsulta[0]) editor.value = { noteId: daConsulta[0].id, conteudo: daConsulta[0].conteudo || '', dados: daConsulta[0].dados || null };
    if (t.id === 'receita' && (!editor.value.dados || !Array.isArray(editor.value.dados.itens))) {
      editor.value.dados = { itens: [], observacoes: '' };
    }
    if (t.id === 'atestado' && (!editor.value.dados || editor.value.dados.tipo === undefined)) {
      editor.value.dados = defaultAtestado();
    }
    if (paciente.value) {
      const todas = (await api.get('/clinical-notes', { params: { patientId: paciente.value.id, tipo: t.tipo } })).data;
      historico.value = todas.filter((n) => n.appointment_id !== selApt.value.id);
    }
  } else if (t.id === 'exames' && paciente.value) {
    exames.value = (await api.get('/exams', { params: { patientId: paciente.value.id } })).data;
  }
}

async function saveNote() {
  if (!selApt.value) return;
  savingNote.value = true;
  try {
    const t = currentTab.value;
    const payload = { conteudo: editor.value.conteudo };
    if (t.id === 'receita') { payload.dados = editor.value.dados; payload.conteudo = prescriptionText(editor.value.dados); }
    if (t.id === 'atestado') { payload.dados = editor.value.dados; payload.conteudo = certificateText(editor.value.dados); }
    if (editor.value.noteId) {
      await api.put(`/clinical-notes/${editor.value.noteId}`, payload);
    } else {
      const { data } = await api.post('/clinical-notes', {
        patient_id: paciente.value?.id, professional_id: profId.value,
        appointment_id: selApt.value.id, tipo: t.tipo, ...payload,
      });
      editor.value.noteId = data.id;
    }
    salvoFlash.value = true;
    setTimeout(() => { salvoFlash.value = false; }, 2000);
  } finally {
    savingNote.value = false;
  }
}

// ─── Receita estruturada ──────────────────────────────────────────────────────
function ensureDados() {
  if (!editor.value.dados || !Array.isArray(editor.value.dados.itens)) editor.value.dados = { itens: [], observacoes: '' };
}
function newItem(medicamento = '') {
  return { medicamento, via: 'Uso oral', dose: '', frequencia: '', duracao: '', quantidade: '', orientacao: '' };
}
function addMedItem(nome) { ensureDados(); editor.value.dados.itens.push(newItem(nome)); }
function addManualItem() { ensureDados(); editor.value.dados.itens.push(newItem()); }
function removeRxItem(i) { editor.value.dados.itens.splice(i, 1); }
function prescriptionText(dados) {
  const linhas = (dados?.itens || []).map((it, i) => {
    const posol = [it.dose, it.frequencia, it.duracao].filter(Boolean).join(', ');
    let l = `${i + 1}) ${it.medicamento}`;
    if (it.quantidade) l += `  —  ${it.quantidade}`;
    const l2 = [it.via, posol].filter(Boolean).join(' · ');
    if (l2) l += `\n    ${l2}`;
    if (it.orientacao) l += `\n    Obs.: ${it.orientacao}`;
    return l;
  });
  if (dados?.observacoes) linhas.push(`\nObservações: ${dados.observacoes}`);
  return linhas.join('\n\n');
}

// ─── Atestado estruturado ─────────────────────────────────────────────────────
function defaultAtestado() {
  return { tipo: 'afastamento', dias: 1, inicio: new Date().toISOString().slice(0, 10), horaInicio: '', horaFim: '', incluirCid: false, cid: '', observacoes: '' };
}
function certificateText(d) {
  if (!d) return '';
  const nome = paciente.value?.nome || '[paciente]';
  const dataFmt = d.inicio ? new Date(d.inicio + 'T00:00:00').toLocaleDateString('pt-BR') : '';
  const cid = d.incluirCid && d.cid ? ` (CID: ${d.cid})` : '';
  let txt = '';
  if (d.tipo === 'outro') {
    txt = d.observacoes || '';
    return txt;
  } else if (d.tipo === 'comparecimento') {
    const h = (d.horaInicio || d.horaFim) ? `, no período das ${d.horaInicio || '__:__'} às ${d.horaFim || '__:__'}` : '';
    txt = `Atesto para os devidos fins que ${nome} compareceu a esta consulta médica no dia ${dataFmt}${h}.`;
  } else if (d.tipo === 'aptidao') {
    txt = `Atesto para os devidos fins que ${nome} encontra-se apto(a) para a prática de atividades físicas${cid}.`;
  } else {
    const dias = Number(d.dias) || 1;
    const alvo = d.tipo === 'repouso' ? 'repouso' : 'afastamento de suas atividades';
    txt = `Atesto para os devidos fins que ${nome} esteve sob meus cuidados professionals nesta data, necessitando de ${alvo} pelo período de ${dias} dia(s), a partir de ${dataFmt}${cid}.`;
  }
  if (d.observacoes) txt += `\n\n${d.observacoes}`;
  return txt;
}

const escHtml = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Abre a janela de impressão com cabeçalho da clínica, paciente, corpo e assinatura.
function openPrint(titulo, corpoHtml, extraTopo = '') {
  const p = paciente.value || {};
  const prof = profSel.value || {};
  const dataStr = new Date().toLocaleDateString('pt-BR');
  const win = window.open('', '_blank', 'width=820,height=900');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(titulo)}</title>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:720px;margin:40px auto;padding:0 24px;}
      .cab{text-align:center;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:22px;}
      .cab h1{font-size:20px;margin:0;} .cab div{font-size:12px;color:#555;}
      .tit{font-size:16px;font-weight:700;text-align:center;margin:16px 0;text-transform:uppercase;letter-spacing:1px;}
      .pac{font-size:13px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #ddd;}
      .ind{font-size:13px;margin-bottom:16px;} .corpo{min-height:230px;}
      .rx{margin-bottom:16px;}
      .rx-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:1px dotted #aaa;padding-bottom:3px;}
      .rx-nome{font-size:15px;font-weight:700;} .rx-qtd{font-size:13px;white-space:nowrap;color:#333;}
      .rx-pos{font-size:13px;color:#222;margin-top:5px;} .rx-via{text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:.5px;color:#444;}
      .rx-obs{font-size:12px;color:#555;margin-top:2px;font-style:italic;}
      .rx-geral{margin-top:14px;font-size:12px;color:#444;border-top:1px solid #eee;padding-top:8px;}
      .ex-list{font-size:14px;line-height:1.7;padding-left:24px;margin:0;}
      .ex-list li{padding:4px 0;border-bottom:1px dotted #ccc;}
      .atest{font-size:14px;line-height:1.9;text-align:justify;margin-top:10px;}
      .assin{margin-top:64px;text-align:center;font-size:13px;} .assin .linha{border-top:1px solid #111;width:280px;margin:0 auto 4px;}
      .data{text-align:right;font-size:13px;margin-top:28px;}
    </style></head><body>
    <div class="cab"><h1>${escHtml(clinica.value.nome)}</h1>
      <div>${escHtml(clinica.value.config?.endereco || '')}${clinica.value.config?.telefone ? ' · ' + escHtml(clinica.value.config.telefone) : ''}</div></div>
    <div class="tit">${escHtml(titulo)}</div>
    <div class="pac"><strong>Paciente:</strong> ${escHtml(p.nome || '—')}${p.nascimento ? ' · Nasc. ' + new Date(p.nascimento).toLocaleDateString('pt-BR') : ''}</div>
    ${extraTopo}
    <div class="corpo">${corpoHtml}</div>
    <div class="data">${escHtml(clinica.value.config?.cidade || '')} ${dataStr}</div>
    <div class="assin"><div class="linha"></div>${escHtml(prof.nome || '')}<br>${escHtml(prof.conselho || '')}</div>
    </body></html>`);
  win.document.close(); win.focus(); win.print();
}

function printDoc() {
  const t = currentTab.value;
  let corpo;
  if (t.id === 'receita') {
    const itens = editor.value.dados?.itens || [];
    corpo = itens.map((it, i) => {
      const posol = [it.dose && `Tomar ${escHtml(it.dose)}`, escHtml(it.frequencia), escHtml(it.duracao)].filter(Boolean).join(' · ');
      const via = it.via ? `<span class="rx-via">${escHtml(it.via)}</span>` : '';
      return `<div class="rx">
        <div class="rx-top"><span class="rx-nome">${i + 1}. ${escHtml(it.medicamento)}</span><span class="rx-qtd">${escHtml(it.quantidade || '')}</span></div>
        ${(posol || via) ? `<div class="rx-pos">${via}${posol ? (via ? ' — ' : '') + posol : ''}</div>` : ''}
        ${it.orientacao ? `<div class="rx-obs">Orientação: ${escHtml(it.orientacao)}</div>` : ''}
      </div>`;
    }).join('');
    if (editor.value.dados?.observacoes) corpo += `<div class="rx-geral"><strong>Observações:</strong> ${escHtml(editor.value.dados.observacoes)}</div>`;
    if (!corpo) corpo = '<div style="color:#888;">Nenhum medicamento.</div>';
  } else if (t.id === 'atestado') {
    corpo = `<div class="atest">${escHtml(certificateText(editor.value.dados)).replace(/\n/g, '<br>') || '&nbsp;'}</div>`;
  } else {
    corpo = `<div style="white-space:pre-wrap;line-height:1.7;">${escHtml(editor.value.conteudo) || '&nbsp;'}</div>`;
  }
  openPrint(t.doc, corpo);
}

// Imprime a solicitação de um exame individual (modelo para atendimento particular).
function printExamRequest(e) {
  const corpo = `<ol class="ex-list"><li>${escHtml(e.nome)}${e.tipo ? ` <span style="color:#666;font-size:12px;">(${escHtml(e.tipo)})</span>` : ''}</li></ol>`;
  const extra = e.indicacao ? `<div class="ind"><strong>Indicação clínica / hipótese diagnóstica:</strong> ${escHtml(e.indicacao)}</div>` : '';
  openPrint('Solicitação de Exame', corpo, extra);
}

async function solicitarExame() {
  const n = newExam.value;
  if (!n.nome.trim() || !paciente.value) return;
  const todayISO = new Date().toISOString().slice(0, 10);
  await api.post('/exams', {
    patient_id: paciente.value.id, professional_id: profId.value, appointment_id: selApt.value.id,
    nome: n.nome.trim(), tipo: n.tipo || null, status: 'solicitado', data_solicitacao: todayISO,
    indicacao: n.indicacao || null,
  });
  newExam.value = { nome: '', tipo: '', indicacao: '' };
  loadTab();
}

async function atualizarExame(e, campos) {
  const { data } = await api.put(`/exams/${e.id}`, campos);
  Object.assign(e, data);
}
// Marca que o paciente realizou / que o resultado chegou.
function atualizarStatusExame(e, status) {
  const campos = { status };
  if (status === 'resultado_disponivel' && !e.data_resultado) campos.data_resultado = new Date().toISOString().slice(0, 10);
  atualizarExame(e, campos);
}
function atualizarIndicacao(e, valor) { atualizarExame(e, { indicacao: valor }); }

// Anexa um item do catálogo (medicamento/CID) numa nova linha do editor.
function appendEditor(t) {
  const atual = editor.value.conteudo ? editor.value.conteudo.replace(/\s*$/, '') + '\n' : '';
  editor.value.conteudo = atual + t;
}

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';
async function anexarPdf(exame, event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.type !== 'application/pdf') { alert('Selecione um arquivo PDF.'); return; }
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  try {
    const { data } = await api.post(`/exams/${exame.id}/arquivo`, { dataUrl });
    Object.assign(exame, data);
  } catch (e) {
    alert(e.response?.data?.error || 'Falha ao anexar o PDF.');
  }
}

function fmtDataHora(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }

onMounted(async () => {
  const [me, profs, tenant] = await Promise.all([
    api.get('/auth/me'), api.get('/professionals'), api.get('/tenant').catch(() => ({ data: null })),
  ]);
  meProfId.value = me.data?.professional_id || null;
  professionals.value = profs.data;
  if (tenant.data) clinica.value = tenant.data;
  profId.value = meProfId.value || (profs.data[0]?.id || '');
  await loadQueue();
  timerInt = setInterval(() => { agora.value = Date.now(); }, 1000);
});
onUnmounted(() => clearInterval(timerInt));
watch(profId, () => { selApt.value = null; paciente.value = null; loadQueue(); });
watch(activeTab, loadTab);
</script>

<template>
  <div class="clin-layout">
    <!-- Fila do dia -->
    <aside class="clin-fila">
      <div class="clin-fila-header">
        <strong style="font-size:13px;">Fila do dia</strong>
        <span class="badge badge-blue" style="margin-left:auto;">{{ sortedQueue.length }}</span>
      </div>
      <div style="padding:10px 12px;border-bottom:1px solid var(--gray-100);">
        <template v-if="meProfId">
          <div style="font-size:11px;color:var(--gray-500);">Profissional</div>
          <div style="font-size:13px;font-weight:600;">{{ profSel?.nome }}</div>
        </template>
        <template v-else>
          <label class="form-label">Profissional</label>
          <select class="form-input" v-model="profId">
            <option v-for="p in profissionais" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.especialidade }}</option>
          </select>
        </template>
      </div>
      <div v-if="!sortedQueue.length" class="empty" style="padding:20px;font-size:12px;">Sem patients na fila hoje.</div>
      <div v-for="a in sortedQueue" :key="a.id" class="clin-fila-item" :class="{ active: selApt && a.id === selApt.id }" @click="selecionar(a)">
        <div style="font-weight:600;font-size:12px;">{{ time(a.inicio) }} · {{ (a.paciente_nome || 'Sem paciente') }}</div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:2px;">{{ a.tipo || 'Consulta' }}</div>
        <span class="badge" :class="a.status === 'em_atendimento' ? 'badge-purple' : (a.status === 'confirmado' ? 'badge-blue' : 'badge-orange')" style="margin-top:4px;font-size:9px;">{{ STATUS_LABEL[a.status] }}</span>
      </div>
    </aside>

    <!-- Prontuário -->
    <main class="clin-prontuario">
      <template v-if="selApt">
        <div class="clin-pront-header">
          <div class="ch-avatar" :style="{ background: colorFor(selApt.paciente_nome || '?'), width: '46px', height: '46px', fontSize: '14px' }">{{ initials(selApt.paciente_nome || '?') }}</div>
          <div class="pront-pac-info">
            <div class="pront-pac-name">{{ selApt.paciente_nome || 'Sem paciente' }}</div>
            <div class="pront-pac-meta">{{ time(selApt.inicio) }} · {{ selApt.tipo || 'Consulta' }}<span v-if="paciente?.nascimento"> · Nasc. {{ new Date(paciente.nascimento).toLocaleDateString('pt-BR') }}</span></div>
          </div>
          <div v-if="selApt.status === 'em_atendimento' && cronometro" class="pront-timer">⏱ {{ cronometro }}</div>
          <div class="pront-actions">
            <button v-if="selApt.status !== 'em_atendimento' && selApt.status !== 'realizado'" class="btn btn-primary btn-sm" @click="iniciar">▶ Iniciar atendimento</button>
            <button v-else-if="selApt.status === 'em_atendimento'" class="btn btn-success btn-sm" @click="finalizar">✓ Finalizar</button>
            <span v-else class="badge badge-green">✔ Finalizado</span>
          </div>
        </div>

        <div class="pront-tabs">
          <button v-for="t in TABS" :key="t.id" class="pront-tab" :class="{ active: activeTab === t.id }" @click="activeTab = t.id">{{ t.icon }} {{ t.label }}</button>
        </div>

        <div class="pront-content">
          <!-- Abas de nota -->
          <template v-if="currentTab.tipo">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <strong>{{ currentTab.label }}</strong>
              <span v-if="salvoFlash" style="color:var(--success);font-size:12px;font-weight:600;">✓ Salvo</span>
              <div style="margin-left:auto;display:flex;gap:6px;">
                <button v-if="currentTab.doc" class="btn btn-secondary btn-sm" @click="printDoc">🖨 Imprimir</button>
                <button class="btn btn-primary btn-sm" :disabled="savingNote" @click="saveNote">{{ savingNote ? 'Salvando…' : 'Salvar' }}</button>
              </div>
            </div>
            <!-- RECEITA estruturada (campos exigidos pela legislação) -->
            <template v-if="activeTab === 'receita'">
              <div style="max-width:640px;margin-bottom:10px;">
                <label class="form-label">💊 Buscar medicamento no catálogo</label>
                <AutoComplete tipo="medicamentos" clear-on-select placeholder="Digite: amoxicilina, losartana, dipirona..." @select="(i) => addMedItem(i.value)" />
              </div>
              <div v-if="!(editor.dados && editor.dados.itens.length)" class="cv-empty" style="padding:16px;">
                Nenhum medicamento. Busque acima ou <a href="#" @click.prevent="addManualItem">adicione manualmente</a>.
              </div>
              <div v-for="(it, i) in (editor.dados ? editor.dados.itens : [])" :key="i" class="rx-card">
                <div class="rx-card-head">
                  <span class="rx-num">{{ i + 1 }}</span>
                  <input class="form-input rx-nome-inp" v-model="it.medicamento" placeholder="Medicamento, concentração e forma (ex.: Amoxicilina 500 mg cápsula)" />
                  <button class="rx-del" title="Remover" @click="removeRxItem(i)">×</button>
                </div>
                <div class="rx-grid">
                  <div><label class="form-label">Via</label><select class="form-input" v-model="it.via"><option v-for="v in VIAS" :key="v" :value="v">{{ v }}</option></select></div>
                  <div><label class="form-label">Dose por vez</label><input class="form-input" v-model="it.dose" placeholder="1 comprimido" /></div>
                  <div><label class="form-label">Frequência / intervalo</label><input class="form-input" list="rx-freq" v-model="it.frequencia" placeholder="de 8 em 8 horas" /></div>
                  <div><label class="form-label">Duração</label><input class="form-input" list="rx-dur" v-model="it.duracao" placeholder="7 dias" /></div>
                  <div><label class="form-label">Quantidade a dispensar</label><input class="form-input" v-model="it.quantidade" placeholder="21 comprimidos / 1 caixa" /></div>
                  <div class="rx-full"><label class="form-label">Orientações</label><input class="form-input" v-model="it.orientacao" placeholder="após as refeições, se dor..." /></div>
                </div>
              </div>
              <button class="btn btn-secondary btn-sm" style="margin-top:6px;" @click="addManualItem">＋ Adicionar medicamento</button>
              <div v-if="editor.dados" style="max-width:640px;margin-top:14px;">
                <label class="form-label">Observações gerais (opcional)</label>
                <textarea v-model="editor.dados.observacoes" class="pront-editor" style="min-height:64px;"></textarea>
              </div>
              <datalist id="rx-freq"><option v-for="f in FREQ_SUGESTOES" :key="f" :value="f" /></datalist>
              <datalist id="rx-dur"><option v-for="d in DURACAO_SUGESTOES" :key="d" :value="d" /></datalist>
            </template>

            <!-- ATESTADO estruturado -->
            <template v-else-if="activeTab === 'atestado' && editor.dados">
              <div class="row-2" style="max-width:640px;">
                <div class="form-row">
                  <label class="form-label">Tipo de atestado</label>
                  <select class="form-input" v-model="editor.dados.tipo">
                    <option v-for="a in ATESTADO_TIPOS" :key="a.v" :value="a.v">{{ a.label }}</option>
                  </select>
                </div>
                <div class="form-row" v-if="editor.dados.tipo === 'afastamento' || editor.dados.tipo === 'repouso'">
                  <label class="form-label">Dias de afastamento</label>
                  <input type="number" min="1" class="form-input" v-model="editor.dados.dias" />
                </div>
              </div>
              <div class="row-2" style="max-width:640px;">
                <div class="form-row" v-if="editor.dados.tipo !== 'aptidao' && editor.dados.tipo !== 'outro'">
                  <label class="form-label">{{ editor.dados.tipo === 'comparecimento' ? 'Data do comparecimento' : 'A partir de' }}</label>
                  <input type="date" class="form-input" v-model="editor.dados.inicio" />
                </div>
                <div class="form-row" v-if="editor.dados.tipo === 'comparecimento'">
                  <label class="form-label">Período (horário)</label>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <input type="time" class="form-input" v-model="editor.dados.horaInicio" />
                    <span style="color:var(--gray-400);">às</span>
                    <input type="time" class="form-input" v-model="editor.dados.horaFim" />
                  </div>
                </div>
              </div>
              <div class="form-row" style="max-width:640px;" v-if="editor.dados.tipo !== 'outro'">
                <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--gray-700);">
                  <input type="checkbox" v-model="editor.dados.incluirCid" style="width:auto;" /> Incluir CID no atestado (somente com consentimento do paciente)
                </label>
                <div v-if="editor.dados.incluirCid" style="margin-top:6px;">
                  <AutoComplete v-model="editor.dados.cid" tipo="cids" placeholder="Buscar CID: lombar, hipertensão, J06..." />
                </div>
              </div>
              <div class="form-row" style="max-width:640px;">
                <label class="form-label">{{ editor.dados.tipo === 'outro' ? 'Texto do atestado' : 'Observações (opcional)' }}</label>
                <textarea v-model="editor.dados.observacoes" class="pront-editor" style="min-height:64px;"></textarea>
              </div>
              <div class="atest-preview" style="max-width:640px;">
                <div class="atest-preview-lbl">Pré-visualização</div>
                <div class="atest-preview-txt">{{ certificateText(editor.dados) || '—' }}</div>
              </div>
            </template>

            <!-- Demais notas: texto livre -->
            <template v-else>
              <textarea v-model="editor.conteudo" class="pront-editor" :placeholder="'Digite ' + currentTab.label.toLowerCase() + ' aqui...'"></textarea>
            </template>

            <div v-if="historico.length" style="margin-top:18px;">
              <div class="cv-section-title">🕐 Registros anteriores</div>
              <div v-for="n in historico" :key="n.id" class="cv-list-item">
                <div style="font-size:10px;color:var(--gray-500);margin-bottom:3px;">{{ fmtDataHora(n.data) }} · {{ n.profissional_nome || '—' }}</div>
                <div style="font-size:12px;white-space:pre-wrap;">{{ n.conteudo }}</div>
              </div>
            </div>
          </template>

          <!-- Exames -->
          <template v-else>
            <div class="cv-section-title">🔬 Solicitar exame</div>
            <div style="display:flex;gap:8px;max-width:660px;margin-bottom:6px;align-items:flex-start;flex-wrap:wrap;">
              <AutoComplete v-model="newExam.nome" tipo="exames" placeholder="Buscar exame: hemograma, RX, ultrassom..." style="flex:1;min-width:220px;" />
              <input class="form-input" style="max-width:150px;" v-model="newExam.tipo" placeholder="Tipo (opcional)" />
              <button class="btn btn-primary btn-sm" @click="solicitarExame">Solicitar</button>
            </div>
            <div style="max-width:660px;margin-bottom:18px;">
              <AutoComplete v-model="newExam.indicacao" tipo="cids" placeholder="Indicação clínica / CID (opcional) — ex.: lombalgia, I10..." />
            </div>

            <div class="cv-section-title">Exames do paciente</div>
            <div v-if="!exames.length" class="cv-empty" style="padding:16px;">Nenhum exame ainda.</div>
            <div v-for="e in exames" :key="e.id" class="ex-card">
              <div class="ex-card-head">
                <div>
                  <div class="ex-nome">{{ e.nome }}</div>
                  <div v-if="e.tipo" class="ex-tipo">{{ e.tipo }}</div>
                </div>
                <select class="form-input ex-status" :class="'st-' + e.status"
                  :value="e.status" @change="atualizarStatusExame(e, $event.target.value)">
                  <option v-for="o in STATUS_EXAME_OPCOES" :key="o.v" :value="o.v">{{ o.label }}</option>
                </select>
              </div>
              <div class="ex-meta">
                <span>📅 Solicitado: {{ e.data_solicitacao ? new Date(e.data_solicitacao).toLocaleDateString('pt-BR') : '—' }}</span>
                <span v-if="e.data_resultado">✅ Resultado: {{ new Date(e.data_resultado).toLocaleDateString('pt-BR') }}</span>
              </div>
              <div class="ex-ind">
                <label class="form-label">Indicação clínica / CID</label>
                <input class="form-input" :value="e.indicacao || ''" @change="atualizarIndicacao(e, $event.target.value)"
                  placeholder="hipótese diagnóstica / CID (sai no pedido impresso)" />
              </div>
              <div class="ex-actions">
                <button class="btn btn-secondary btn-sm" @click="printExamRequest(e)">🖨 Imprimir pedido</button>
                <a v-if="e.arquivo_url" :href="apiBase + e.arquivo_url" target="_blank" class="btn btn-secondary btn-sm">📄 Ver resultado</a>
                <label class="btn btn-secondary btn-sm" style="cursor:pointer;">
                  {{ e.arquivo_url ? '🔁 Trocar PDF' : '📎 Anexar resultado (PDF)' }}
                  <input type="file" accept="application/pdf" hidden @change="anexarPdf(e, $event)" />
                </label>
              </div>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="empty" style="margin:auto;padding:40px;">Selecione um paciente na fila à esquerda para iniciar o atendimento.</div>
    </main>

    <!-- Card de Vida clínico -->
    <aside class="clin-cardvida">
      <template v-if="paciente">
        <div style="padding:14px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:10px;">🪪 Card de Vida clínico</div>
          <div v-if="(paciente.alergias || []).length" class="alerta-clinico">
            <strong>⚠ Alergias:</strong> {{ paciente.alergias.join(', ') }}
          </div>
          <div v-if="(paciente.comorbidades || []).length" style="font-size:12px;margin:8px 0;">
            <strong>Comorbidades:</strong> {{ paciente.comorbidades.join(', ') }}
          </div>
          <div v-if="(paciente.medicacoes || []).length" style="font-size:12px;margin:8px 0;">
            <strong>Medicações:</strong> {{ paciente.medicacoes.join(', ') }}
          </div>
          <div v-if="!(paciente.alergias||[]).length && !(paciente.comorbidades||[]).length && !(paciente.medicacoes||[]).length" class="cv-empty" style="padding:14px;">
            Sem alertas clínicos registrados.
          </div>
          <button class="btn btn-secondary btn-sm" style="margin-top:12px;width:100%;" @click="cardId = paciente.id">📂 Abrir Card de Vida completo</button>
        </div>
      </template>
      <div v-else class="empty" style="padding:30px;font-size:12px;">Card de Vida clínico aparece aqui.</div>
    </aside>
  </div>

  <LifeCard v-if="cardId" :patient-id="cardId" @close="cardId = null" />
</template>
