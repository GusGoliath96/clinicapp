<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './stores/auth.js';
import { useApp } from './stores/app.js';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const app = useApp();

const isPublic = computed(() => route.meta.public);

// Estrutura da sidebar — idêntica ao protótipo.
const sections = [
  { title: 'Geral', items: [
    { page: 'dashboard', icon: '📊', label: 'Dashboard' },
    { page: 'agenda', icon: '📅', label: 'Agenda' },
    { page: 'pacientes', icon: '👥', label: 'Pacientes' },
    { page: 'config', icon: '⚙️', label: 'Configurações' },
  ]},
  { title: 'Atendimento', items: [
    { page: 'recepcao', icon: '💬', label: 'WhatsApp', soon: true },
    { page: 'clinico', icon: '🩺', label: 'Atendimento Clínico' },
    { page: 'reservas', icon: '🤖', label: 'Reservas pendentes', soon: true },
    { page: 'espera', icon: '⏳', label: 'Lista de espera', soon: true },
    { page: 'telemedicina', icon: '📹', label: 'Telemedicina', soon: true },
    { page: 'agendamento-online', icon: '🌐', label: 'Agendamento Online', soon: true },
  ]},
  { title: 'CRM & Comercial', items: [
    { page: 'leads', icon: '💼', label: 'Leads (CRM)', soon: true },
    { page: 'pendentes', icon: '🆕', label: 'Pendentes 1ª consulta' },
    { page: 'marketing', icon: '📣', label: 'Marketing Ativo', soon: true },
    { page: 'pacotes', icon: '🎁', label: 'Programas / Pacotes', soon: true },
    { page: 'nps', icon: '⭐', label: 'NPS & Satisfação', soon: true },
  ]},
  { title: 'Operação', items: [
    { page: 'estoque', icon: '📦', label: 'Estoque', soon: true },
    { page: 'docs-eletronicos', icon: '📄', label: 'Documentos Eletrônicos', soon: true },
    { page: 'laboratorios', icon: '🔬', label: 'Laboratórios', soon: true },
    { page: 'educacao', icon: '🎓', label: 'Educação do Paciente', soon: true },
  ]},
  { title: 'Financeiro', items: [
    { page: 'financeiro', icon: '💰', label: 'Financeiro', soon: true },
    { page: 'convenios', icon: '📋', label: 'Convênios & Glosa', soon: true },
    { page: 'pagamentos', icon: '💳', label: 'Pagamentos Integrados', soon: true },
  ]},
  { title: 'Gestão', items: [
    { page: 'gestor', icon: '🎖️', label: 'Visão do Gestor', soon: true },
    { page: 'bi', icon: '📈', label: 'BI & Relatórios', soon: true },
    { page: 'rh', icon: '👥', label: 'RH & Equipe', soon: true },
    { page: 'compliance', icon: '✅', label: 'Compliance', soon: true },
    { page: 'patrimonio', icon: '🏥', label: 'Patrimônio', soon: true },
  ]},
];

// Perfis (visual — como o protótipo). Troca nome/papel/avatar exibidos.
const perfis = {
  recepcao: { icone: '💬', role: 'Recepção', nome: 'Helena Rocha', papel: 'Recepcionista', avatar: 'HR', cor: 'linear-gradient(135deg,#6366f1,#8b5cf6)', sub: 'Helena · Secretária' },
  medico: { icone: '🩺', role: 'Profissional', nome: 'Dr. Marco Aurélio', papel: 'Ortopedia', avatar: 'MA', cor: '#2563eb', sub: 'Dr. Marco · Ortopedia' },
  crm: { icone: '💼', role: 'CRM', nome: 'Ana Beatriz', papel: 'Captação', avatar: 'AB', cor: '#7c3aed', sub: 'Ana · Captação' },
  financeiro: { icone: '💰', role: 'Financeiro', nome: 'Roberto Dias', papel: 'Administrativo', avatar: 'RD', cor: '#16a34a', sub: 'Roberto · Adm' },
  gestor: { icone: '🎖️', role: 'Gestor', nome: 'Diego Castro', papel: 'Dono', avatar: 'DC', cor: '#ea580c', sub: 'Diego · Dono' },
};
const perfilAtivo = ref('recepcao');
const perfilMenu = ref(false);
const perfil = computed(() => perfis[perfilAtivo.value]);
function setPerfil(id) { perfilAtivo.value = id; perfilMenu.value = false; }

const badgeRec = computed(() => app.pendentesRecepcao);

function go(page) { router.push(`/${page}`); }
function sair() { auth.logout(); router.push('/login'); }

function newAppointment() {
  app.openNewAppointment = true;      // a Agenda observa esse sinal e abre o modal
  if (route.name !== 'agenda') router.push('/agenda');
}

function newPatient() {
  app.openNewPatient = true;         // Pacientes observa esse sinal e abre o modal
  if (route.name !== 'pacientes') router.push('/pacientes');
}
</script>

<template>
  <router-view v-if="isPublic" />

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-icon">+</div>
        <div>
          <div class="logo-text">ClinicaApp</div>
          <div class="logo-subtext">Clínica MACS</div>
        </div>
      </div>
      <nav>
        <template v-for="sec in sections" :key="sec.title">
          <div class="nav-section">{{ sec.title }}</div>
          <div
            v-for="it in sec.items" :key="it.page"
            class="nav-item" :class="{ active: route.name === it.page }"
            @click="go(it.page)"
          >
            <span class="icon">{{ it.icon }}</span> {{ it.label }}
            <span v-if="it.badge === 'rec' && badgeRec" class="badge">{{ badgeRec }}</span>
            <span v-if="it.soon" class="nav-soon">EM BREVE</span>
          </div>
        </template>
      </nav>

      <div class="role-switch">
        <div class="role-switch-current" @click="perfilMenu = !perfilMenu">
          <span>{{ perfil.icone }}</span> <strong>{{ perfil.role }}</strong>
          <span style="margin-left:auto;color:var(--gray-400);">▼</span>
        </div>
        <div v-if="perfilMenu" class="role-switch-menu">
          <div
            v-for="(p, id) in perfis" :key="id"
            class="role-option" @click="setPerfil(id)"
          >
            <span>{{ p.icone }}</span>
            <div><strong>{{ p.role }}</strong><span>{{ p.sub }}</span></div>
          </div>
        </div>
      </div>

      <div class="user">
        <div class="avatar" :style="{ background: perfil.cor }">{{ perfil.avatar }}</div>
        <div>
          <div class="user-name">{{ perfil.nome }}</div>
          <div class="user-role">{{ perfil.papel }}</div>
        </div>
        <span style="margin-left:auto;cursor:pointer;color:var(--gray-400);" title="Sair" @click="sair">⎋</span>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h1>{{ route.meta.title || 'ClinicaApp' }}</h1>
          <div class="breadcrumb">{{ route.meta.breadcrumb }}</div>
        </div>
        <div class="topbar-actions">
          <input type="text" class="search-input" placeholder="Buscar paciente, agenda..." />
          <button class="btn btn-secondary" @click="newPatient">+ Paciente</button>
          <button class="btn btn-primary" @click="newAppointment">+ Agendamento</button>
        </div>
      </header>
      <div class="content">
        <router-view />
      </div>
    </main>
  </div>
</template>
