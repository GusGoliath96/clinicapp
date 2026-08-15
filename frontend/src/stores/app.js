import { defineStore } from 'pinia';

// Estado leve compartilhado pela shell (ex.: badge de conversas pendentes na sidebar).
export const useApp = defineStore('app', {
  state: () => ({
    pendentesRecepcao: 0,
    abrirNovoAgendamento: false, // sinal do botão "+ Agendamento" da topbar
    abrirNovoPaciente: false,    // sinal do botão "+ Paciente" da topbar
  }),
});
