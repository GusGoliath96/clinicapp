// Helpers de apresentação — reproduzem o comportamento visual do protótipo.

const CORES = ['#2563eb', '#16a34a', '#ea580c', '#7c3aed', '#db2777', '#0891b2', '#9333ea', '#dc2626'];

// Iniciais (2 letras) a partir do nome.
export function iniciais(nome = '') {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cor determinística baseada no texto (nome/telefone).
export function corDe(texto = '') {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return CORES[h % CORES.length];
}

// "2026-06-30T14:42:00Z" → "14:42"
export function hora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Como uma conversa se chama na tela, em ordem de preferência:
//   nome do paciente cadastrado > nome que o canal mandou (pushName/first_name) > telefone.
// O último recurso é o `telefone`, que no Telegram e no WhatsApp por LID guarda um id opaco —
// por isso ele é o ÚLTIMO: um número desses na lista não identifica ninguém.
export function rotuloConversa(c) {
  if (!c) return '';
  return c.paciente_nome || c.nome_exibicao || c.telefone || 'Sem identificação';
}

// Mapa status da conversa → [label, classe wa-tag]
export function statusTag(status) {
  return {
    pendente: ['Aguardando', 'wa-tag-pendente'],
    humano: ['Atendendo', 'wa-tag-humano'],
    resolvida: ['Resolvida', 'wa-tag-resolvido'],
  }[status] || [status, 'wa-tag-resolvido'];
}
