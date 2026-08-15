import { env } from '../config/env.js';

// Cliente do motor de IA / WhatsApp (ai_agent). Substitui a antiga integração Gupshup:
// o ClinicaApp NÃO fala mais direto com a Meta — pede ao motor para enviar.
//
// Contrato do motor: POST /api/v1/messages  (Authorization: Bearer <api key do tenant>)
//   { to, type, text?, template?, clientRef?, idempotencyKey? }
//   - type 'text'     → texto de sessão (só dentro da janela de 24h; fora → 409 window_closed)
//   - type 'template' → mensagem proativa (lembrete/confirmação), exige template aprovado
// Resposta: { messageId, conversationId, metaMessageId, status, clientRef }

const isConfigured = () => Boolean(env.aiEngine.url && env.aiEngine.apiKey);

async function post(body) {
  if (!isConfigured()) {
    // Sem credenciais ainda (dev): loga e simula, não quebra o fluxo local.
    console.warn('[ai-engine] credenciais ausentes — envio simulado:', body.type, body.to);
    return { messageId: `sim-${Date.now()}`, status: 'enviado', simulated: true };
  }

  const res = await fetch(`${env.aiEngine.url}/api/v1/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.aiEngine.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 409 && data.code === 'window_closed') {
    // Janela de 24h fechada no motor: repassa como erro tratável (usar template).
    const err = new Error(data.message || 'Janela de 24h fechada — use um template aprovado.');
    err.code = 'window_closed';
    err.statusCode = 409;
    throw err;
  }
  if (!res.ok) throw new Error(`ai-engine ${res.status}: ${JSON.stringify(data)}`);

  return data; // { messageId, conversationId, metaMessageId, status, clientRef }
}

// Texto de sessão (resposta do atendente humano, dentro da janela de 24h).
export function sendSessionText(toPhone, text) {
  return post({ to: normalize(toPhone), type: 'text', text });
}

// Template aprovado (lembrete/confirmação, ou fora da janela de 24h).
// variables preenchem os {{1}},{{2}}... do corpo, na ordem. clientRef é o eco opaco
// (ex.: id da consulta), devolvido nos eventos message.status.
export function sendTemplate(toPhone, templateName, variables = [], clientRef, idempotencyKey) {
  return post({
    to: normalize(toPhone),
    type: 'template',
    template: { name: templateName, language: 'pt_BR', variables },
    ...(clientRef ? { clientRef } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

// O motor espera E.164 só com dígitos (sem '+').
function normalize(phone) {
  return String(phone).replace(/[^\d]/g, '');
}
