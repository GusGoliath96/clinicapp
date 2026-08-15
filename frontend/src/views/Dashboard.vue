<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { getSocket } from '../realtime/socket.js';
import { useAuth } from '../stores/auth.js';
import { useApp } from '../stores/app.js';
import { iniciais, corDe } from '../utils/ui.js';
import { usePointerDrag } from '../utils/drag.js';

const router = useRouter();
const auth = useAuth();
const app = useApp();

const conversas = ref([]);
let socket;

const ESTEIRAS = [
  { id: 'imediata', status: 'pendente', cls: 'hub-imediata', icon: '🚨', title: 'Atenção Imediata', sub: 'decisões agora', score: 'score-alto', drop: true },
  { id: 'curso', status: 'humano', cls: 'hub-curso', icon: '🔁', title: 'Em Curso', sub: 'atendendo agora', score: 'score-baixo', drop: true },
  { id: 'aguardando', status: 'resolvida', cls: 'hub-aguardando', icon: '⏳', title: 'Aguardando Terceiros', sub: 'encerradas / retorno', score: 'score-medio', drop: true },
  { id: 'quentes', status: null, cls: 'hub-quentes', icon: '🔥', title: 'Sinais Quentes', sub: 'contatos sem cadastro', score: 'score-baixo', drop: false },
];

function cardsDa(e) {
  if (e.id === 'quentes') return conversas.value.filter((c) => !c.patient_id);
  return conversas.value.filter((c) => c.patient_id && c.status === e.status);
}

// Drag por pointer events.
const { payload: dragCard, overKey: dragOver, justDragged, begin } = usePointerDrag(onSoltar);
function startDrag(c, ev) { if (c.patient_id) begin(c, ev, c.nome_exibicao || c.telefone); }
async function onSoltar(c, status) {
  if (!status || c.status === status) return;
  const { data } = await api.post(`/conversations/${c.id}/status`, { status });
  upsert(data);
}

const saudacao = computed(() => {
  const h = new Date().getHours();
  const nome = (auth.user?.nome || '').split(' ')[0];
  if (h < 12) return { emoji: '☀️', txt: `Bom dia, ${nome}` };
  if (h < 18) return { emoji: '🌤️', txt: `Boa tarde, ${nome}` };
  return { emoji: '🌙', txt: `Boa noite, ${nome}` };
});
const pendentes = computed(() => conversas.value.filter((c) => c.status === 'pendente').length);

async function carregar() {
  conversas.value = (await api.get('/conversations')).data;
  app.pendentesRecepcao = pendentes.value;
}
function upsert(conv) {
  const i = conversas.value.findIndex((c) => c.id === conv.id);
  if (i >= 0) conversas.value[i] = { ...conversas.value[i], ...conv };
  else conversas.value.unshift(conv);
  app.pendentesRecepcao = pendentes.value;
}
function abrir() { router.push('/recepcao'); }

onMounted(async () => {
  await carregar();
  socket = getSocket();
  socket.on('conversation:update', upsert);
  socket.on('message:new', carregar);
});
onUnmounted(() => { socket?.off('conversation:update'); socket?.off('message:new'); });
</script>

<template>
  <div class="hub-saudacao">
    <div class="hub-greeting"><span>{{ saudacao.emoji }}</span> <strong>{{ saudacao.txt }}</strong></div>
    <div class="hub-subline">
      {{ pendentes ? `${pendentes} conversa(s) aguardando você agora` : 'Nenhuma conversa aguardando — tudo em dia ✨' }}
    </div>
    <button class="btn btn-primary" style="margin-left:auto;background:linear-gradient(135deg,#8b5cf6,#6366f1);border:none;" @click="router.push('/recepcao')">
      🎯 Ir para a Recepção
    </button>
  </div>

  <div class="hub-esteiras">
    <div
      v-for="e in ESTEIRAS" :key="e.id"
      class="hub-esteira" :class="[e.cls, { 'drop-target': dragOver === e.status && e.drop }]"
      :data-drop="e.drop ? e.status : undefined"
    >
      <div class="hub-esteira-head">
        <span class="hub-esteira-icon">{{ e.icon }}</span>
        <div>
          <div class="hub-esteira-title">{{ e.title }}</div>
          <div class="hub-esteira-sub">{{ e.sub }}</div>
        </div>
        <span class="hub-esteira-count">{{ cardsDa(e).length }}</span>
      </div>
      <div class="hub-esteira-body">
        <div
          v-for="c in cardsDa(e)" :key="c.id"
          class="hub-card" :class="[e.score, { dragging: dragCard?.id === c.id }]"
          :style="e.id === 'quentes' ? 'cursor:default;' : ''"
          @pointerdown="startDrag(c, $event)"
          @click="!justDragged && abrir()"
        >
          <div class="hub-card-line1">
            <span class="hub-card-av" :style="{ background: corDe(c.nome_exibicao || c.telefone) }">{{ iniciais(c.nome_exibicao || c.telefone) }}</span>
            <span class="hub-card-nome">{{ c.nome_exibicao || c.telefone }}</span>
            <span v-if="c.unread" class="hub-card-tag">{{ c.unread }} nova(s)</span>
          </div>
          <div class="hub-card-motivo">{{ c.last_message_preview || 'Sem mensagens' }}</div>
        </div>
        <div v-if="!cardsDa(e).length" class="hub-empty">
          {{ e.id === 'quentes' ? 'Contatos novos aparecem aqui' : 'Nada por aqui' }}
        </div>
      </div>
    </div>
  </div>

  <p style="margin-top:12px;font-size:11px;color:var(--gray-500);">
    💡 Arraste um card entre <strong>Atenção Imediata</strong>, <strong>Em Curso</strong> e <strong>Aguardando</strong> para mudar o status da conversa.
  </p>
</template>
