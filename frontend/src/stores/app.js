import { defineStore } from 'pinia';

// Estado leve compartilhado pela shell (ex.: badge de conversas pendentes na sidebar).
export const useApp = defineStore('app', {
  state: () => ({
    pendentesRecepcao: 0,
    openNewAppointment: false, // sinal do botão "+ Agendamento" da topbar
    openNewPatient: false,    // sinal do botão "+ Paciente" da topbar
  }),
});
