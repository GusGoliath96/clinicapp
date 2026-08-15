<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api } from '../api/client.js';
import { getSocket } from '../realtime/socket.js';
import { useApp } from '../stores/app.js';
import { hora } from '../utils/ui.js';
import { usePointerDrag } from '../utils/drag.js';
import CardVida from '../components/CardVida.vue';

const app = useApp();

const HORAS = Array.from({ length: 13 }, (_, i) => 7 + i); // 07h..19h
const DIAS_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ICONE_STATUS = { confirmado: '✓', em_atendimento: '🩺', realizado: '✔', cancelado: '✗', falta: '⚠', reservado_bot: '🤖' };
const BADGE_STATUS = { agendado: 'orange', confirmado: 'blue', em_atendimento: 'purple', realizado: 'green', cancelado: 'red', falta: 'gray' };
const MOTIVOS = { ferias: '🏖️ Férias', congresso: '🎓 Congresso', manutencao: '🔧 Manutenção', feriado: '📅 Feriado', almoco: '☕ Almoço', outro: '🚫 Outro' };

const profissionais = ref([]);
const pacientes = ref([]);
const agendamentos = ref([]);
const bloqueios = ref([]);
const selecionados = ref([]);
const offset = ref(0);
const view = ref('dia');
const filtroEsp = ref('all');
const filtroStatus = ref('all');
let socket;

// ─── Datas ──────────────────────────────────────────────────────────────────
const diaAtual = computed(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset.value); return d; });
const semanaInicio = computed(() => { const d = new Date(diaAtual.value); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; });
const semanaDias = computed(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(semanaInicio.value); d.setDate(d.getDate() + i); return d; }));
const diaLabel = computed(() => { const s = diaAtual.value.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); });

// Mês (grade de 6 semanas começando na segunda)
const mesGridInicio = computed(() => { const d = new Date(diaAtual.value); d.setDate(1); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0); return d; });
const mesSemanas = computed(() => { const weeks = []; const cur = new Date(mesGridInicio.value); for (let w = 0; w < 6; w++) { const row = []; for (let i = 0; i < 7; i++) { row.push(new Date(cur)); cur.setDate(cur.getDate() + 1); } weeks.push(row); } return weeks; });
const mesGridFim = computed(() => { const w = mesSemanas.value; return w[w.length - 1][6]; });
const mesLabel = computed(() => { const s = diaAtual.value.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); });

const periodoLabel = computed(() => {
  if (view.value === 'mes') return mesLabel.value;
  if (view.value === 'semana') {
    const a = semanaDias.value[0], b = semanaDias.value[5];
    return `${a.getDate()} - ${b.getDate()} ${b.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`;
  }
  return diaAtual.value.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
});
const datePickerVal = computed({
  get: () => toISODate(diaAtual.value),
  set: (v) => { setData(new Date(v + 'T00:00:00')); },
});
function toISODate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function setData(d) { const hoje = new Date(); hoje.setHours(0, 0, 0, 0); offset.value = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - hoje) / 86400000); }
function ehHoje(d) { const h = new Date(); return d.getDate() === h.getDate() && d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear(); }
function mesmoDia(a, b) { return a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear(); }
function ehMesAtual(d) { return d.getMonth() === diaAtual.value.getMonth(); }
function fmtCurto(d) { return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} ${hora(d)}`; }

// ─── Profissionais / filtros ────────────────────────────────────────────────
const especialidades = computed(() => [...new Set(profissionais.value.map((p) => p.especialidade).filter(Boolean))]);
const ativos = computed(() => profissionais.value.filter((p) =>
  selecionados.value.includes(p.id) && p.ativo !== false
  && (filtroEsp.value === 'all' || p.especialidade === filtroEsp.value)));
const gridCols = computed(() => `60px ${ativos.value.map(() => 'minmax(140px,1fr)').join(' ')}`);
const porEsp = computed(() => {
  const g = {};
  profissionais.value.filter((p) => p.ativo !== false).forEach((p) => {
    (g[p.especialidade || 'Outros'] = g[p.especialidade || 'Outros'] || []).push(p);
  });
  return g;
});
function corEsp(p) { return p?.cor || '#6b7280'; }
function nomeProf(id) { return profissionais.value.find((p) => p.id === id)?.nome || ''; }
function parseHM(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); }

function atende(p, h) {
  const ag = p.agenda || {};
  const diaNome = DIAS_ABBR[diaAtual.value.getDay()];
  const min = h * 60;
  // Formato novo: horário por dia.
  if (ag.horarios) {
    const d = ag.horarios[diaNome];
    if (!d || !d.ativo) return false;
    if (d.inicio && min < parseHM(d.inicio)) return false;
    if (d.fim && min >= parseHM(d.fim)) return false;
    if (d.almoco) { const [i, f] = d.almoco.split('-'); if (min >= parseHM(i) && min < parseHM(f)) return 'almoco'; }
    return true;
  }
  // Formato antigo: horário único para todos os dias.
  if (ag.dias && !ag.dias.includes(diaNome)) return false;
  if (ag.inicio && min < parseHM(ag.inicio)) return false;
  if (ag.fim && min >= parseHM(ag.fim)) return false;
  if (ag.almoco) { const [i, f] = ag.almoco.split('-'); if (min >= parseHM(i) && min < parseHM(f)) return 'almoco'; }
  return true;
}

function passaFiltro(a) { return filtroStatus.value === 'all' || a.status === filtroStatus.value; }

// Indicadores visuais (VIP / 1ª consulta / check-in / doc pendente)
function indic(ev) {
  const out = [];
  const tags = ev.paciente_tags || [];
  if (tags.includes('VIP')) out.push('⭐');
  if (ev.primeira_consulta) out.push('🆕');
  if (ev.check_in_em) out.push('🟢');
  if (ev.doc_pendente) out.push('⚠️');
  return out;
}

// ─── Bloqueios ────────────────────────────────────────────────────────────────
function blocoNoSlot(p, dt) {
  return bloqueios.value.find((b) =>
    (b.professional_id === p.id || b.professional_id == null)
    && new Date(b.inicio) <= dt && new Date(b.fim) > dt);
}
function blocoSlot(p, h, m) { return blocoNoSlot(p, slotDate(h, m)); }
function blocosSemana(d, h) {
  const ini = new Date(d); ini.setHours(h, 0, 0, 0);
  const fim = new Date(d); fim.setHours(h + 1, 0, 0, 0);
  return bloqueios.value.filter((b) =>
    (b.professional_id == null || selecionados.value.includes(b.professional_id))
    && new Date(b.inicio) < fim && new Date(b.fim) > ini);
}

function eventosDia(p, h) {
  return agendamentos.value.filter((a) => {
    if (a.professional_id !== p.id || !passaFiltro(a)) return false;
    const i = new Date(a.inicio);
    return mesmoDia(i, diaAtual.value) && i.getHours() === h;
  });
}
function subSlots(p, h) {
  const dur = p.agenda?.duracaoConsulta || 30;
  const evs = eventosDia(p, h);
  const slots = [];
  for (let m = 0; m < 60; m += dur) slots.push({ min: m, ev: evs.find((e) => new Date(e.inicio).getMinutes() === m) });
  return slots;
}
// Semana: eventos de todos os profissionais selecionados naquele dia+hora
function eventosSemana(d, h) {
  return agendamentos.value.filter((a) => {
    if (!selecionados.value.includes(a.professional_id) || !passaFiltro(a)) return false;
    const i = new Date(a.inicio);
    return mesmoDia(i, d) && i.getHours() === h;
  }).sort((x, y) => new Date(x.inicio) - new Date(y.inicio));
}
// Mês: eventos de um dia (profissionais selecionados)
function eventosNoDia(d) {
  return agendamentos.value.filter((a) =>
    selecionados.value.includes(a.professional_id) && passaFiltro(a)
    && mesmoDia(new Date(a.inicio), d));
}
function heatColor(n) {
  if (!n) return 'transparent';
  const alpha = Math.min(0.14 + n * 0.11, 0.82);
  return `rgba(37,99,235,${alpha})`;
}
function slotDate(h, m) { const d = new Date(diaAtual.value); d.setHours(h, m, 0, 0); return d; }

// ─── Carregamento ───────────────────────────────────────────────────────────
async function carregar() {
  let de, ate;
  if (view.value === 'mes') { de = new Date(mesGridInicio.value); ate = new Date(mesGridFim.value); }
  else if (view.value === 'semana') { de = new Date(semanaInicio.value); ate = new Date(semanaDias.value[5]); }
  else { de = new Date(diaAtual.value); ate = new Date(diaAtual.value); }
  ate.setHours(23, 59, 59, 999);
  const params = { de: de.toISOString(), ate: ate.toISOString() };
  const [profs, appts, blocks] = await Promise.all([
    api.get('/professionals'),
    api.get('/appointments', { params }),
    api.get('/blocks', { params }),
  ]);
  profissionais.value = profs.data;
  agendamentos.value = appts.data;
  bloqueios.value = blocks.data;
  if (!selecionados.value.length) selecionados.value = profs.data.map((p) => p.id);
}
async function carregarPacientes() { pacientes.value = (await api.get('/patients')).data; }

function toggleProf(id) {
  selecionados.value = selecionados.value.includes(id)
    ? selecionados.value.filter((x) => x !== id) : [...selecionados.value, id];
}
function hoje() { offset.value = 0; }
function mudar(dir) {
  if (view.value === 'mes') { const d = new Date(diaAtual.value); d.setDate(1); d.setMonth(d.getMonth() + dir); setData(d); }
  else offset.value += (view.value === 'semana' ? 7 : 1) * dir;
}
function irParaDia(d) { setData(d); view.value = 'dia'; }

// ─── Drag & drop (pointer-based, com confirmação) ───────────────────────────
const reagendar = ref(null); // { appt, novoInicio, novoFim, profId }
function podeArrastar(ev) { return !['cancelado', 'falta', 'realizado'].includes(ev.status); }

const { payload: dragAppt, overKey: dragOver, justDragged, begin } = usePointerDrag(onSoltar);
const draggingId = computed(() => dragAppt.value?.id);
function keyDia(p, h, m) { return `d|${p.id}|${h}|${m}`; }
function keySemana(d, h) { return `w|${toISODate(d)}|${h}`; }
function startDrag(ev, e) { if (podeArrastar(ev)) begin(ev, e, ev.paciente_nome || 'Consulta'); }

function onSoltar(appt, key) {
  const p = String(key).split('|');
  if (p[0] === 'd') {
    const ini = new Date(diaAtual.value); ini.setHours(+p[2], +p[3], 0, 0);
    pedirReagendamento(appt, ini, p[1]);
  } else if (p[0] === 'w') {
    const ini = new Date(p[1] + 'T00:00:00'); ini.setHours(+p[2], new Date(appt.inicio).getMinutes(), 0, 0);
    pedirReagendamento(appt, ini, appt.professional_id);
  }
}
function pedirReagendamento(appt, novoInicio, profId) {
  if (!appt) return;
  if (new Date(appt.inicio).getTime() === novoInicio.getTime() && appt.professional_id === profId) return;
  const durMs = new Date(appt.fim) - new Date(appt.inicio);
  erro.value = '';
  reagendar.value = { appt, novoInicio, novoFim: new Date(novoInicio.getTime() + durMs), profId };
}
async function confirmarReagendamento() {
  const r = reagendar.value;
  try {
    await api.put(`/appointments/${r.appt.id}`, {
      inicio: r.novoInicio.toISOString(), fim: r.novoFim.toISOString(), professional_id: r.profId,
    });
    reagendar.value = null;
    carregar();
  } catch (e) { erro.value = e.response?.data?.error || 'Não foi possível reagendar.'; }
}

// Mensagens de erro (conflito etc.) exibidas dentro do modal aberto.
const erro = ref('');

// ─── Modal novo/criar ───────────────────────────────────────────────────────
const criar = ref(null);
function abrirNovo() {
  const p = ativos.value[0] || profissionais.value[0];
  erro.value = '';
  criar.value = { professional_id: p?.id || '', data: toISODate(diaAtual.value), horaSel: '08:00', patient_id: '', tipo: 'Consulta', convenio: '' };
}
function abrirCriarSlot(p, h, m) {
  erro.value = '';
  criar.value = { professional_id: p.id, data: toISODate(diaAtual.value), horaSel: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, patient_id: '', tipo: 'Consulta', convenio: '' };
}
async function salvarCriar() {
  const c = criar.value;
  if (!c.professional_id) return;
  const ini = new Date(`${c.data}T${c.horaSel}:00`);
  const prof = profissionais.value.find((p) => p.id === c.professional_id);
  const dur = prof?.agenda?.duracaoConsulta || 30;
  const fim = new Date(ini.getTime() + dur * 60000);
  try {
    await api.post('/appointments', {
      patient_id: c.patient_id || null, professional_id: c.professional_id,
      tipo: c.tipo, convenio: c.convenio, inicio: ini.toISOString(), fim: fim.toISOString(), origem: 'Recepção',
    });
    criar.value = null;
    carregar();
  } catch (e) { erro.value = e.response?.data?.error || 'Não foi possível agendar.'; }
}

// ─── Bloqueio de horários ─────────────────────────────────────────────────────
const bloquear = ref(null);
function abrirBloqueio() {
  erro.value = '';
  bloquear.value = { professional_id: '', data: toISODate(diaAtual.value), horaInicio: '08:00', dataFim: toISODate(diaAtual.value), horaFim: '18:00', motivo: 'ferias', descricao: '' };
}
async function salvarBloqueio() {
  const b = bloquear.value;
  const ini = new Date(`${b.data}T${b.horaInicio}:00`);
  const fim = new Date(`${b.dataFim}T${b.horaFim}:00`);
  if (fim <= ini) { erro.value = 'O fim deve ser depois do início.'; return; }
  await api.post('/blocks', {
    professional_id: b.professional_id || null,
    inicio: ini.toISOString(), fim: fim.toISOString(), motivo: b.motivo, descricao: b.descricao,
  });
  bloquear.value = null;
  carregar();
}

const detalheBloqueio = ref(null);
function abrirDetalheBloqueio(b) { detalheBloqueio.value = b; }
async function removerBloqueio() {
  await api.delete(`/blocks/${detalheBloqueio.value.id}`);
  detalheBloqueio.value = null;
  carregar();
}

// ─── Modal detalhe ──────────────────────────────────────────────────────────
const detalhe = ref(null);
const cardPacienteId = ref(null);
function abrirDetalhe(ev) { detalhe.value = ev; }
function abrirCard() { if (detalhe.value?.patient_id) { cardPacienteId.value = detalhe.value.patient_id; detalhe.value = null; } }
async function mudarStatus(status) { const { data } = await api.put(`/appointments/${detalhe.value.id}`, { status }); detalhe.value = { ...detalhe.value, ...data }; carregar(); }
async function checkIn() { const { data } = await api.post(`/appointments/${detalhe.value.id}/check-in`); detalhe.value = { ...detalhe.value, ...data }; carregar(); }

onMounted(async () => {
  await Promise.all([carregar(), carregarPacientes()]);
  if (app.abrirNovoAgendamento) { app.abrirNovoAgendamento = false; abrirNovo(); }
  socket = getSocket();
  socket.on('appointment:update', carregar);
  socket.on('block:update', carregar);
});
onUnmounted(() => { socket?.off('appointment:update'); socket?.off('block:update'); });
watch([offset, view], carregar);
watch(() => app.abrirNovoAgendamento, (v) => { if (v) { app.abrirNovoAgendamento = false; abrirNovo(); } });
</script>

<template>
  <!-- Toolbar -->
  <div class="agenda-toolbar">
    <div class="agenda-week-nav">
      <button @click="mudar(-1)">‹</button>
      <span class="week-label">{{ periodoLabel }}</span>
      <button @click="mudar(1)">›</button>
      <button class="btn btn-secondary btn-sm" style="margin-left:6px;" @click="hoje">Hoje</button>
      <input type="date" v-model="datePickerVal" style="margin-left:6px;padding:5px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;font-family:inherit;" />
    </div>
    <div class="view-toggle" style="margin-left:10px;">
      <button class="view-btn" :class="{ active: view === 'dia' }" @click="view = 'dia'">Dia</button>
      <button class="view-btn" :class="{ active: view === 'semana' }" @click="view = 'semana'">Semana</button>
      <button class="view-btn" :class="{ active: view === 'mes' }" @click="view = 'mes'">Mês</button>
      <button class="view-btn" :class="{ active: view === 'lista' }" @click="view = 'lista'">📋 Lista</button>
    </div>
    <div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;">
      <select class="form-select" v-model="filtroEsp">
        <option value="all">Todas especialidades</option>
        <option v-for="e in especialidades" :key="e" :value="e">{{ e }}</option>
      </select>
      <select class="form-select" v-model="filtroStatus">
        <option value="all">Todos status</option>
        <option value="agendado">Agendado</option>
        <option value="confirmado">Confirmado</option>
        <option value="em_atendimento">Em atend.</option>
        <option value="realizado">Realizado</option>
      </select>
      <button class="btn btn-secondary btn-sm" @click="abrirBloqueio">🚫 Bloquear</button>
      <button class="btn btn-primary btn-sm" @click="abrirNovo">+ Novo</button>
    </div>
  </div>

  <div class="legend" style="font-size:10px;gap:9px;flex-wrap:wrap;">
    <strong style="color:var(--gray-700);font-size:10px;text-transform:uppercase;">Status (borda):</strong>
    <div class="legend-item"><span style="display:inline-block;width:3px;height:12px;background:#f59e0b;"></span>Agendado</div>
    <div class="legend-item"><span style="display:inline-block;width:3px;height:12px;background:#2563eb;"></span>Confirmado</div>
    <div class="legend-item"><span style="display:inline-block;width:3px;height:12px;background:#7c3aed;"></span>Em atend.</div>
    <div class="legend-item"><span style="display:inline-block;width:3px;height:12px;background:#16a34a;"></span>Realizado</div>
    <div class="legend-item"><span style="display:inline-block;width:3px;height:12px;background:#dc2626;"></span>Cancelado</div>
    <span style="margin-left:8px;color:var(--gray-400);">|</span>
    <div class="legend-item">⭐ VIP</div>
    <div class="legend-item">🆕 1ª consulta</div>
    <div class="legend-item">🟢 check-in</div>
    <div class="legend-item">⚠️ doc pendente</div>
  </div>

  <div class="prof-layout">
    <!-- Sidebar profissionais -->
    <aside class="prof-sidebar">
      <h4>Profissionais</h4>
      <template v-for="(profs, esp) in porEsp" :key="esp">
        <div style="font-size:10px;font-weight:700;margin:8px 0 3px;text-transform:uppercase;letter-spacing:.3px;display:flex;align-items:center;gap:5px;" :style="{ color: corEsp(profs[0]) }">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;" :style="{ background: corEsp(profs[0]) }"></span>{{ esp }}
        </div>
        <div v-for="p in profs" :key="p.id" class="prof-side-item" :class="{ off: !selecionados.includes(p.id) }" @click="toggleProf(p.id)">
          <div class="prof-side-color" :style="{ borderColor: corEsp(p), background: selecionados.includes(p.id) ? corEsp(p) : 'white' }"></div>
          <span class="prof-side-name">{{ p.nome }}</span>
        </div>
      </template>
    </aside>

    <div class="prof-grid-wrap">
      <div class="prof-grid-day-header">{{ view === 'dia' ? diaLabel : periodoLabel }}</div>

      <!-- ─── DIA ─── -->
      <div v-if="view === 'dia'" class="prof-grid-scroll">
        <div v-if="!ativos.length" class="empty" style="padding:30px;">Selecione pelo menos um profissional na lateral</div>
        <div v-else class="prof-grid" :style="{ gridTemplateColumns: gridCols }">
          <div class="prof-time-col"></div>
          <div v-for="p in ativos" :key="'h' + p.id" class="prof-col-head" :style="{ borderTop: '3px solid ' + corEsp(p) }">
            <div class="pname" :style="{ color: corEsp(p) }">{{ p.nome.split(' ').slice(0, 3).join(' ') }}</div>
            <div class="pmeta">{{ p.especialidade }}</div>
          </div>
          <template v-for="h in HORAS" :key="'row' + h">
            <div class="prof-time-cell">{{ String(h).padStart(2, '0') }}:00</div>
            <div v-for="p in ativos" :key="h + '-' + p.id" class="prof-slot" :class="{ blocked: atende(p, h) === false, almoco: atende(p, h) === 'almoco' }">
              <span v-if="atende(p, h) === false" class="prof-slot-tooltip">— não atende —</span>
              <div v-else-if="atende(p, h) === 'almoco'" class="almoco-card">☕ almoço</div>
              <div v-else style="display:flex;flex-direction:column;height:100%;gap:1px;">
                <template v-for="s in subSlots(p, h)" :key="s.min">
                  <div v-if="s.ev" class="prof-event"
                    :class="['s-' + s.ev.status, { dragging: draggingId === s.ev.id, 'drop-target': dragOver === keyDia(p, h, s.min) }]"
                    :style="{ background: corEsp(p), color: 'white', flex: 1, minHeight: 0 }"
                    :data-drop="keyDia(p, h, s.min)"
                    @pointerdown="startDrag(s.ev, $event)"
                    @click="!justDragged && abrirDetalhe(s.ev)">
                    <div class="pe-time">{{ hora(s.ev.inicio) }}</div>
                    <div class="pe-name">{{ (s.ev.paciente_nome || 'Sem paciente').split(' ').slice(0, 2).join(' ') }}</div>
                    <div v-if="indic(s.ev).length" class="pe-indic">{{ indic(s.ev).join('') }}</div>
                    <span v-if="ICONE_STATUS[s.ev.status]" class="pe-status">{{ ICONE_STATUS[s.ev.status] }}</span>
                  </div>
                  <div v-else-if="blocoSlot(p, h, s.min)" class="prof-bloco" @click="abrirDetalheBloqueio(blocoSlot(p, h, s.min))">
                    {{ MOTIVOS[blocoSlot(p, h, s.min).motivo] || '🚫 Bloqueado' }}
                  </div>
                  <div v-else class="prof-vaga-livre" :class="{ 'drop-target': dragOver === keyDia(p, h, s.min) }"
                    style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;"
                    :data-drop="keyDia(p, h, s.min)"
                    @click="!justDragged && abrirCriarSlot(p, h, s.min)">
                    + {{ String(h).padStart(2, '0') }}:{{ String(s.min).padStart(2, '0') }}
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- ─── SEMANA ─── -->
      <div v-else-if="view === 'semana'" class="prof-grid-scroll">
        <div class="agenda-grid">
          <div class="col-head"></div>
          <div v-for="d in semanaDias" :key="'wd' + d" class="col-head" :class="{ today: ehHoje(d) }">
            <div>{{ DIAS_ABBR[d.getDay()] }}</div>
            <div class="day-num">{{ d.getDate() }}</div>
          </div>
          <template v-for="h in HORAS" :key="'wr' + h">
            <div class="time-cell">{{ String(h).padStart(2, '0') }}:00</div>
            <div v-for="d in semanaDias" :key="h + '-' + toISODate(d)" class="slot"
              :class="{ 'drop-target': dragOver === keySemana(d, h) }"
              :data-drop="keySemana(d, h)">
              <div v-for="b in blocosSemana(d, h)" :key="'b' + b.id" class="agenda-bloco" @click="abrirDetalheBloqueio(b)">
                {{ MOTIVOS[b.motivo] || '🚫' }}
              </div>
              <div v-for="ev in eventosSemana(d, h)" :key="ev.id"
                class="agenda-event" :class="['s-' + ev.status, { dragging: draggingId === ev.id }]"
                @pointerdown="startDrag(ev, $event)"
                @click="!justDragged && abrirDetalhe(ev)">
                <span class="ev-time">{{ hora(ev.inicio) }}</span> {{ (ev.paciente_nome || 'Sem paciente').split(' ')[0] }}
                <span v-if="indic(ev).length" class="ev-indic">{{ indic(ev).join('') }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- ─── MÊS ─── -->
      <div v-else-if="view === 'mes'" class="prof-grid-scroll">
        <div class="mes-grid">
          <div v-for="dn in ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']" :key="'mh' + dn" class="mes-col-head">{{ dn }}</div>
          <template v-for="(semana, wi) in mesSemanas" :key="'ms' + wi">
            <div v-for="d in semana" :key="toISODate(d)"
              class="mes-cell" :class="{ hoje: ehHoje(d), 'fora-mes': !ehMesAtual(d) }"
              :style="{ background: heatColor(eventosNoDia(d).length) }"
              @click="irParaDia(d)">
              <div class="mes-cell-num">{{ d.getDate() }}</div>
              <div v-if="eventosNoDia(d).length" class="mes-cell-count" :class="{ claro: eventosNoDia(d).length >= 4 }">
                {{ eventosNoDia(d).length }} {{ eventosNoDia(d).length === 1 ? 'consulta' : 'consultas' }}
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- ─── LISTA ─── -->
      <div v-else>
        <table>
          <thead><tr><th>Hora</th><th>Paciente</th><th></th><th>Profissional</th><th>Tipo</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in agendamentos.slice().sort((x, y) => new Date(x.inicio) - new Date(y.inicio))" :key="a.id">
              <td><strong>{{ hora(a.inicio) }}</strong></td>
              <td>{{ a.paciente_nome || '—' }}</td>
              <td style="font-size:13px;">{{ indic(a).join(' ') }}</td>
              <td>{{ a.profissional_nome }}</td>
              <td>{{ a.tipo }}</td>
              <td><span class="badge" :class="'badge-' + (BADGE_STATUS[a.status] || 'gray')">{{ a.status }}</span></td>
              <td><button class="btn btn-secondary btn-sm" @click="abrirDetalhe(a)">Ver</button></td>
            </tr>
            <tr v-if="!agendamentos.length"><td colspan="7" class="empty">Nenhum agendamento no período.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Modal novo/criar -->
  <div v-if="criar" class="modal-backdrop active" @click.self="criar = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Novo agendamento</div>
        <button class="modal-close" @click="criar = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>
        <div class="form-row">
          <label class="form-label">Profissional <span class="required">*</span></label>
          <select class="form-input" v-model="criar.professional_id">
            <option v-for="p in profissionais" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.especialidade }}</option>
          </select>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Data</label><input type="date" class="form-input" v-model="criar.data" /></div>
          <div class="form-row"><label class="form-label">Hora</label><input type="time" class="form-input" v-model="criar.horaSel" /></div>
        </div>
        <div class="form-row">
          <label class="form-label">Paciente</label>
          <select class="form-input" v-model="criar.patient_id">
            <option value="">Sem paciente (encaixe)</option>
            <option v-for="p in pacientes" :key="p.id" :value="p.id">{{ p.nome }}</option>
          </select>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Tipo</label><input class="form-input" v-model="criar.tipo" /></div>
          <div class="form-row"><label class="form-label">Convênio</label><input class="form-input" v-model="criar.convenio" placeholder="Particular, Unimed..." /></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="criar = null">Cancelar</button>
        <button class="btn btn-primary" @click="salvarCriar">Agendar</button>
      </div>
    </div>
  </div>

  <!-- Modal bloquear horário -->
  <div v-if="bloquear" class="modal-backdrop active" @click.self="bloquear = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">🚫 Bloquear horário</div>
        <button class="modal-close" @click="bloquear = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>
        <div class="form-row">
          <label class="form-label">Motivo</label>
          <select class="form-input" v-model="bloquear.motivo">
            <option v-for="(lbl, k) in MOTIVOS" :key="k" :value="k">{{ lbl }}</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">Profissional</label>
          <select class="form-input" v-model="bloquear.professional_id">
            <option value="">Toda a clínica (geral)</option>
            <option v-for="p in profissionais" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.especialidade }}</option>
          </select>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Início</label><input type="date" class="form-input" v-model="bloquear.data" /></div>
          <div class="form-row"><label class="form-label">Hora</label><input type="time" class="form-input" v-model="bloquear.horaInicio" /></div>
        </div>
        <div class="row-2">
          <div class="form-row"><label class="form-label">Fim</label><input type="date" class="form-input" v-model="bloquear.dataFim" /></div>
          <div class="form-row"><label class="form-label">Hora</label><input type="time" class="form-input" v-model="bloquear.horaFim" /></div>
        </div>
        <div class="form-row">
          <label class="form-label">Descrição</label>
          <input class="form-input" v-model="bloquear.descricao" placeholder="Opcional" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="bloquear = null">Cancelar</button>
        <button class="btn btn-primary" @click="salvarBloqueio">Bloquear</button>
      </div>
    </div>
  </div>

  <!-- Modal detalhe do bloqueio -->
  <div v-if="detalheBloqueio" class="modal-backdrop active" @click.self="detalheBloqueio = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Bloqueio de horário</div>
        <button class="modal-close" @click="detalheBloqueio = null">×</button>
      </div>
      <div class="modal-body">
        <div class="pp-row"><span class="ic">🚫</span><div><div class="lbl">Motivo</div><div class="val">{{ MOTIVOS[detalheBloqueio.motivo] || detalheBloqueio.motivo || '—' }}</div></div></div>
        <div class="pp-row"><span class="ic">🩺</span><div><div class="lbl">Profissional</div><div class="val">{{ detalheBloqueio.profissional_nome || 'Toda a clínica' }}</div></div></div>
        <div class="pp-row"><span class="ic">🕐</span><div><div class="lbl">Período</div><div class="val">{{ fmtCurto(new Date(detalheBloqueio.inicio)) }} → {{ fmtCurto(new Date(detalheBloqueio.fim)) }}</div></div></div>
        <div v-if="detalheBloqueio.descricao" class="pp-row"><span class="ic">📝</span><div><div class="lbl">Descrição</div><div class="val">{{ detalheBloqueio.descricao }}</div></div></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="detalheBloqueio = null">Fechar</button>
        <button class="btn btn-danger" @click="removerBloqueio">Remover bloqueio</button>
      </div>
    </div>
  </div>

  <!-- Modal confirmar reagendamento -->
  <div v-if="reagendar" class="modal-backdrop active" @click.self="reagendar = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Reagendar consulta</div>
        <button class="modal-close" @click="reagendar = null">×</button>
      </div>
      <div class="modal-body">
        <div v-if="erro" class="form-erro">{{ erro }}</div>
        <p style="font-size:13px;margin-bottom:14px;">
          Confirmar novo horário para <strong>{{ reagendar.appt.paciente_nome || 'consulta' }}</strong>?
        </p>
        <div class="reag-box">
          <div class="reag-col">
            <div class="lbl">De</div>
            <div class="val">{{ fmtCurto(new Date(reagendar.appt.inicio)) }}</div>
            <div style="font-size:11px;color:var(--gray-500);margin-top:3px;">{{ nomeProf(reagendar.appt.professional_id) }}</div>
          </div>
          <div class="reag-seta">→</div>
          <div class="reag-col novo">
            <div class="lbl">Para</div>
            <div class="val">{{ fmtCurto(reagendar.novoInicio) }}</div>
            <div style="font-size:11px;color:var(--gray-500);margin-top:3px;">{{ nomeProf(reagendar.profId) }}</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="reagendar = null">Cancelar</button>
        <button class="btn btn-primary" @click="confirmarReagendamento">Confirmar reagendamento</button>
      </div>
    </div>
  </div>

  <!-- Modal detalhe -->
  <div v-if="detalhe" class="modal-backdrop active" @click.self="detalhe = null">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Consulta</div>
        <button class="modal-close" @click="detalhe = null">×</button>
      </div>
      <div class="modal-body">
        <div class="pp-row"><span class="ic">👤</span><div><div class="lbl">Paciente</div><div class="val">{{ detalhe.paciente_nome || '—' }}</div></div></div>
        <div class="pp-row"><span class="ic">🩺</span><div><div class="lbl">Profissional</div><div class="val">{{ detalhe.profissional_nome }}</div></div></div>
        <div class="pp-row"><span class="ic">🕐</span><div><div class="lbl">Horário</div><div class="val">{{ hora(detalhe.inicio) }} – {{ hora(detalhe.fim) }}</div></div></div>
        <div class="pp-row"><span class="ic">📋</span><div><div class="lbl">Tipo / Convênio</div><div class="val">{{ detalhe.tipo }} · {{ detalhe.convenio || '—' }}</div></div></div>
        <div class="pp-row"><span class="ic">🔖</span><div><div class="lbl">Status</div><div class="val">{{ detalhe.status }}</div></div></div>
      </div>
      <div class="modal-footer" style="flex-wrap:wrap;">
        <button v-if="detalhe.patient_id" class="btn btn-secondary" style="margin-right:auto;" @click="abrirCard">📂 Abrir Card de Vida</button>
        <button class="btn btn-secondary" @click="mudarStatus('confirmado')">Confirmar</button>
        <button class="btn btn-secondary" @click="checkIn">Check-in</button>
        <button class="btn btn-secondary" @click="mudarStatus('realizado')">Realizado</button>
        <button class="btn btn-danger" @click="mudarStatus('cancelado')">Cancelar consulta</button>
      </div>
    </div>
  </div>

  <CardVida v-if="cardPacienteId" :patient-id="cardPacienteId" @close="cardPacienteId = null" @edited="carregar" />
</template>
