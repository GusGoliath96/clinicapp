<script setup>
import { useRoute } from 'vue-router';
const route = useRoute();

// Ícone por slug (espelha os ícones da sidebar).
const ICONES = {
  dashboard: '📊', pacientes: '👥', reservas: '🤖', espera: '⏳', clinico: '🩺',
  telemedicina: '📹', 'agendamento-online': '🌐', leads: '💼', pendentes: '🆕',
  marketing: '📣', pacotes: '🎁', nps: '⭐', estoque: '📦', 'docs-eletronicos': '📄',
  laboratorios: '🔬', educacao: '🎓', financeiro: '💰', convenios: '📋',
  pagamentos: '💳', gestor: '🎖️', bi: '📈', rh: '👥', compliance: '✅',
  patrimonio: '🏥', config: '⚙️',
};
</script>

<template>
  <div class="ph-wrap">
    <div class="ph-hero">
      <div class="ph-hero-icon">{{ ICONES[route.meta.slug] || '🧩' }}</div>
      <div>
        <h2>{{ route.meta.title }}</h2>
        <div class="ph-sub">{{ route.meta.breadcrumb }}</div>
        <span class="ph-status">{{ route.meta.soon ? 'EM DESENVOLVIMENTO' : 'PRÓXIMA ETAPA' }}</span>
      </div>
    </div>
    <div class="ph-roadmap">
      Este módulo faz parte do roadmap do ClinicaApp e ainda não foi implementado no MVP-A.
      O foco atual é <strong>Recepção</strong> e <strong>Agenda</strong>, já funcionais.
    </div>
  </div>
</template>
