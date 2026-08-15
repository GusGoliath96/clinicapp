import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../stores/auth.js';
import Placeholder from '../views/Placeholder.vue';

// Página placeholder reutilizável para módulos ainda não construídos.
const ph = (slug, title, sub, soon = true) => ({
  path: `/${slug}`,
  name: slug,
  component: Placeholder,
  meta: { auth: true, title, breadcrumb: sub, slug, soon },
});

const routes = [
  { path: '/', redirect: '/recepcao' },
  { path: '/login', component: () => import('../views/Login.vue'), meta: { public: true } },

  {
    path: '/recepcao', name: 'recepcao',
    component: () => import('../views/Recepcao.vue'),
    meta: { auth: true, title: 'Recepção', breadcrumb: 'Atendimento via WhatsApp' },
  },
  {
    path: '/agenda', name: 'agenda',
    component: () => import('../views/Agenda.vue'),
    meta: { auth: true, title: 'Agenda', breadcrumb: 'Calendário de consultas' },
  },
  {
    path: '/dashboard', name: 'dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { auth: true, title: 'Hub de Atenção', breadcrumb: 'Visão geral do dia' },
  },
  {
    path: '/pacientes', name: 'pacientes',
    component: () => import('../views/Pacientes.vue'),
    meta: { auth: true, title: 'Pacientes', breadcrumb: 'Card de Vida' },
  },
  {
    path: '/config', name: 'config',
    component: () => import('../views/Configuracoes.vue'),
    meta: { auth: true, title: 'Configurações', breadcrumb: 'Administração' },
  },
  {
    path: '/clinico', name: 'clinico',
    component: () => import('../views/Atendimento.vue'),
    meta: { auth: true, title: 'Atendimento Clínico', breadcrumb: 'Prontuário' },
  },

  // Placeholders (mesma navegação do protótipo)
  ph('reservas', 'Reservas pendentes', 'Fila do bot'),
  ph('espera', 'Lista de espera', 'Fila de espera'),
  ph('telemedicina', 'Telemedicina', 'Atendimento remoto'),
  ph('agendamento-online', 'Agendamento Online', 'Auto-serviço do paciente'),
  ph('leads', 'Leads (CRM)', 'Pipeline comercial'),
  ph('pendentes', 'Pendentes 1ª consulta', 'Conversão'),
  ph('marketing', 'Marketing Ativo', 'Campanhas'),
  ph('pacotes', 'Programas / Pacotes', 'Tratamentos'),
  ph('nps', 'NPS & Satisfação', 'Pós-atendimento'),
  ph('estoque', 'Estoque', 'Materiais e insumos'),
  ph('docs-eletronicos', 'Documentos Eletrônicos', 'Assinatura ICP-Brasil'),
  ph('laboratorios', 'Laboratórios', 'Integração de exames'),
  ph('educacao', 'Educação do Paciente', 'Conteúdo e adesão'),
  ph('financeiro', 'Financeiro', 'Caixa e repasses'),
  ph('convenios', 'Convênios & Glosa', 'Faturamento TISS'),
  ph('pagamentos', 'Pagamentos Integrados', 'PIX, cartão, link'),
  ph('gestor', 'Visão do Gestor', 'Sinais do time'),
  ph('bi', 'BI & Relatórios', 'Análise customizada'),
  ph('rh', 'RH & Equipe', 'Equipe não-clínica'),
  ph('compliance', 'Compliance', 'Regulatório'),
  ph('patrimonio', 'Patrimônio', 'Equipamentos'),
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.auth && !auth.isAuthenticated) return '/login';
  if (to.path === '/login' && auth.isAuthenticated) return '/recepcao';
});

export default router;
