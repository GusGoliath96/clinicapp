<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { getSocket } from '../realtime/socket.js';
import { useApp } from '../stores/app.js';
import { initials, colorFor, time, statusTag, conversationLabel } from '../utils/ui.js';
import LifeCard from '../components/LifeCard.vue';

const router = useRouter();
const app = useApp();
const cardId = ref(null);

const conversas = ref([]);
const search = ref('');
const filter = ref('todas');
const ativaId = ref(null);
const mensagens = ref([]);
const paciente = ref(null);
const rascunho = ref('');
const banner = ref('');
const msgsEl = ref(null);
let socket;

const FILTROS = [
  { id: 'todas', label: 'Todas' },
  { id: 'pendente', label: 'Aguardando' },
  { id: 'humano', label: 'Atendendo' },
  { id: 'resolvida', label: 'Resolvidas' },
];
const QUICKS = [
  { nome: '👋 Saudação', texto: 'Olá! Aqui é da Clínica MACS. Como posso ajudar?' },
  { nome: '📅 Confirmar', texto: 'Sua consulta está confirmada. Até lá!' },
  { nome: '📄 Documentos', texto: 'Para seguir, envie foto do RG e da carteirinha do convênio, por favor.' },
];
const ORDER = { pendente: 0, humano: 1, resolvida: 2 };

const counts = computed(() => {
  const c = { todas: conversas.value.length, pendente: 0, humano: 0, resolvida: 0 };
  conversas.value.forEach((x) => { c[x.status] = (c[x.status] || 0) + 1; });
  return c;
});

const lista = computed(() => {
  const s = search.value.toLowerCase();
  return conversas.value
    .filter((c) => filter.value === 'todas' || c.status === filter.value)
    .filter((c) => !s
      || conversationLabel(c).toLowerCase().includes(s)
      || (c.nome_exibicao || '').toLowerCase().includes(s)
      || (c.telefone || '').includes(s)
      || (c.last_message_preview || '').toLowerCase().includes(s))
    .sort((a, b) => (ORDER[a.status] - ORDER[b.status])
      || new Date(b.updated_at) - new Date(a.updated_at));
});

const ativa = computed(() => conversas.value.find((c) => c.id === ativaId.value) || null);
const chStatus = computed(() => ({
  pendente: '⏳ Aguardando você assumir', humano: '● Atendendo', resolvida: '✅ Encerrada',
}[ativa.value?.status] || ''));

async function load() {
  const { data } = await api.get('/conversations');
  conversas.value = data;
  app.pendentesRecepcao = data.filter((c) => c.status === 'pendente').length;
}

async function open(c) {
  ativaId.value = c.id;
  banner.value = '';
  c.unread = 0;
  const { data } = await api.get(`/conversations/${c.id}/messages`);
  mensagens.value = data.messages;
  paciente.value = null;
  if (c.patient_id) {
    try { paciente.value = (await api.get(`/patients/${c.patient_id}`)).data; } catch {}
  }
  scrollFim();
}

async function enviar() {
  const texto = rascunho.value.trim();
  if (!texto || !ativa.value) return;
  try {
    const { data } = await api.post(`/conversations/${ativa.value.id}/messages`, { texto });
    mensagens.value.push(data);
    rascunho.value = '';
    banner.value = '';
    scrollFim();
  } catch (e) {
    if (e.response?.status === 409) {
      banner.value = '⏳ Fora da janela de 24h — só é possível enviar um template aprovado pela Meta.';
    } else {
      banner.value = e.response?.data?.error || 'Falha ao enviar.';
    }
  }
}

async function assumir() {
  const { data } = await api.post(`/conversations/${ativa.value.id}/assign`);
  upsert(data);
}
async function resolver() {
  const { data } = await api.post(`/conversations/${ativa.value.id}/resolve`);
  upsert(data);
}
function agendar() { router.push('/agenda'); }
function useQuick(t) { rascunho.value = t; }

async function reloadPatient() {
  if (ativa.value?.patient_id) {
    try { paciente.value = (await api.get(`/patients/${ativa.value.patient_id}`)).data; } catch {}
  }
}

function upsert(conv) {
  const i = conversas.value.findIndex((c) => c.id === conv.id);
  if (i >= 0) conversas.value[i] = { ...conversas.value[i], ...conv };
  else conversas.value.unshift(conv);
  app.pendentesRecepcao = conversas.value.filter((c) => c.status === 'pendente').length;
}

function scrollFim() {
  nextTick(() => { if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight; });
}

onMounted(async () => {
  await load();
  socket = getSocket();
  socket.on('message:new', (msg) => {
    if (ativa.value && msg.conversation_id === ativa.value.id) { mensagens.value.push(msg); scrollFim(); }
    load();
  });
  socket.on('conversation:update', upsert);
  socket.on('message:status', (msg) => {
    const m = mensagens.value.find((x) => x.id === msg.id);
    if (m) m.status = msg.status;
  });
});
onUnmounted(() => {
  socket?.off('message:new'); socket?.off('conversation:update'); socket?.off('message:status');
});

watch(filter, () => {});
</script>

<template>
  <div class="alert alert-info" style="margin-bottom:9px;">
    <span>💡</span>
    <div><strong>Tela do recepcionista:</strong> conversas do WhatsApp chegam aqui em tempo real.
      Assuma a conversa, responda e veja o Card de Vida do paciente à direita.</div>
  </div>

  <div class="wa-layout">
    <!-- Coluna 1: lista de conversas -->
    <aside class="wa-panel">
      <div class="wa-panel-header">
        <div class="avatar">HR</div>
        <strong style="flex:1;font-size:12px;">Conversas</strong>
      </div>
      <div class="wa-search">
        <input v-model="search" type="text" placeholder="Pesquisar..." />
      </div>
      <div class="wa-filters">
        <button
          v-for="f in FILTROS" :key="f.id"
          class="wa-filter" :class="{ active: filter === f.id }"
          @click="filter = f.id"
        >{{ f.label }} <span class="ct">{{ counts[f.id] || 0 }}</span></button>
      </div>
      <div class="wa-conv-list">
        <div
          v-for="c in lista" :key="c.id"
          class="wa-conv" :class="{ active: c.id === ativaId }"
          @click="open(c)"
        >
          <div class="wa-conv-avatar" :style="{ background: colorFor(conversationLabel(c)) }">
            {{ initials(conversationLabel(c)) }}
            <div v-if="c.status === 'pendente'" class="wa-status-icon pulse" style="background:#f59e0b;">!</div>
            <div v-else-if="c.status === 'humano'" class="wa-status-icon" style="background:#16a34a;">●</div>
          </div>
          <div class="wa-conv-info">
            <div class="wa-conv-line1">
              <span class="wa-conv-name">{{ conversationLabel(c) }}</span>
              <span class="wa-conv-time" :class="{ unread: c.unread }">{{ time(c.updated_at) }}</span>
            </div>
            <div class="wa-conv-line2">
              <span class="wa-conv-preview">{{ c.last_message_preview }}</span>
              <span class="wa-tag" :class="statusTag(c.status)[1]">{{ statusTag(c.status)[0] }}</span>
              <span v-if="c.unread" class="wa-conv-badge">{{ c.unread }}</span>
            </div>
          </div>
        </div>
        <div v-if="!lista.length" class="empty" style="padding:20px;font-size:11px;">Nenhuma conversa nesses filtros</div>
      </div>
    </aside>

    <!-- Coluna 2: chat -->
    <main class="wa-chat">
      <div v-if="!ativa" class="wa-chat-empty">
        <div class="ic">💬</div>
        <h3 style="font-size:14px;font-weight:500;">Selecione uma conversa</h3>
      </div>
      <template v-else>
        <div class="wa-chat-header">
          <div class="ch-avatar" :style="{ background: colorFor(conversationLabel(ativa)) }">
            {{ initials(conversationLabel(ativa)) }}
          </div>
          <div class="ch-info">
            <div class="ch-name">{{ conversationLabel(ativa) }}</div>
            <div class="ch-status">{{ chStatus }}</div>
          </div>
          <div class="ch-actions">
            <button v-if="ativa.patient_id" class="ch-btn primary" style="background:var(--primary);border-color:var(--primary);" @click="agendar">📅 Agendar</button>
            <button v-if="ativa.status === 'pendente'" class="ch-btn primary" @click="assumir">▶ Assumir</button>
            <button v-if="ativa.status === 'humano'" class="ch-btn primary" @click="resolver">✓ Resolver</button>
          </div>
        </div>
        <div v-if="banner" class="wa-banner">{{ banner }}</div>

        <div ref="msgsEl" class="messages">
          <template v-for="m in mensagens" :key="m.id">
            <div v-if="m.direction === 'in'" class="bubble in">
              {{ m.texto }}<div class="meta">{{ time(m.created_at) }}</div>
            </div>
            <div v-else class="bubble out">
              {{ m.texto }}
              <div class="meta">{{ time(m.created_at) }} <span class="check">{{ m.status === 'lido' ? '✓✓' : m.status === 'falhou' ? '✗' : '✓✓' }}</span></div>
            </div>
          </template>
        </div>

        <div class="composer">
          <div class="quick-replies">
            <button v-for="q in QUICKS" :key="q.nome" class="quick-reply" @click="useQuick(q.texto)">{{ q.nome }}</button>
          </div>
          <div class="composer-row">
            <div class="composer-icons">
              <button title="Anexar">📎</button>
              <button title="Templates" style="background:var(--purple-light);color:var(--purple);">📚</button>
            </div>
            <textarea
              v-model="rascunho" placeholder="Digite uma mensagem..."
              @keydown.enter.exact.prevent="enviar"
            ></textarea>
            <button class="send-btn" @click="enviar">➤</button>
          </div>
        </div>
      </template>
    </main>

    <!-- Coluna 3: Card de Vida -->
    <aside class="patient-panel">
      <template v-if="paciente">
        <div class="pp-header">
          <div class="pp-avatar" :style="{ background: colorFor(paciente.nome) }">{{ initials(paciente.nome) }}</div>
          <div class="pp-name">{{ paciente.nome }}</div>
          <div class="pp-meta">{{ paciente.convenio || 'Sem convênio' }}</div>
          <div class="pp-tags">
            <span v-for="t in (paciente.tags || [])" :key="t" class="wa-tag wa-tag-humano">{{ t }}</span>
          </div>
        </div>
        <div class="pp-tab-content">
          <div class="pp-row"><span class="ic">📞</span><div><div class="lbl">Telefone</div><div class="val">{{ paciente.telefone || '—' }}</div></div></div>
          <div class="pp-row"><span class="ic">💳</span><div><div class="lbl">Convênio</div><div class="val">{{ paciente.convenio || '—' }}</div></div></div>
          <div class="pp-row"><span class="ic">📍</span><div><div class="lbl">Origem</div><div class="val">{{ paciente.origem || '—' }}</div></div></div>
          <div class="pp-row"><span class="ic">🔒</span><div><div class="lbl">LGPD</div><div class="val">{{ paciente.consentimento_lgpd ? 'Consentido' : 'Pendente' }}</div></div></div>
        </div>
        <div class="pp-actions">
          <button class="pp-action primary" @click="cardId = paciente.id">📂 Abrir Card de Vida completo</button>
          <button class="pp-action" @click="agendar">📅 Agendar consulta</button>
        </div>
      </template>
      <div v-else-if="ativa" class="pp-empty">
        <div style="font-size:38px;opacity:.3;">👤</div>
        <p style="margin-top:8px;">Contato não cadastrado.<br />Cadastre como paciente para ver o Card de Vida.</p>
      </div>
      <div v-else class="pp-empty">
        <div style="font-size:38px;opacity:.3;">👤</div>
        <p style="margin-top:8px;">Card de Vida aparece aqui</p>
      </div>
    </aside>
  </div>

  <LifeCard v-if="cardId" :patient-id="cardId" @close="cardId = null" @edited="reloadPatient" />
</template>
