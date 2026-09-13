import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();

// O payload emitido pelo socket segue em português (contrato com o frontend).
const MESSAGE_FIELDS = `id, tenant_id, conversation_id, direction, kind AS tipo,
  body AS texto, media_url, wa_message_id, status, sent_by AS enviado_por, created_at`;

const CONVERSATION_FIELDS = `id, tenant_id, patient_id, phone AS telefone,
  display_name AS nome_exibicao, status, assignee_id AS atendente_id, unread,
  last_inbound_at, last_message_preview, wa_conversation_id, created_at, updated_at`;

// Webhook PÚBLICO do motor de IA (ai_agent). Recebe os callbacks assinados:
//   message.received | message.status | conversation.handoff
// Configurar no motor: Tenant.callbackUrl = https://SEU_DOMINIO/webhooks/ai-engine
//
// Precisamos do CORPO BRUTO para validar a assinatura HMAC (o express.json() global
// consome o body), então aplicamos um express.raw() só nesta rota.
router.post('/ai-engine', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');

  // Valida a origem: HMAC-SHA256(signingSecret, corpo_bruto) == X-Signature-256.
  if (!isValidSignature(rawBody, req.headers['x-signature-256'])) {
    return res.sendStatus(401);
  }

  // Responder rápido; processar sem bloquear o ACK.
  res.sendStatus(200);

  try {
    const event = JSON.parse(rawBody.toString('utf8'));
    const tenantId = await resolveTenant();
    if (!tenantId || !event?.type) return;

    if (event.type === 'message.received') await handleInboundMessage(tenantId, event.data);
    else if (event.type === 'message.status') await handleStatus(tenantId, event.data);
    else if (event.type === 'message.sent') await handleOutboundMessage(tenantId, event.data);
    else if (event.type === 'conversation.handoff') await handleHandoff(tenantId, event.data);
  } catch (err) {
    console.error('[webhook ai-engine] erro ao processar:', err.message);
  }
});

// Compara a assinatura recebida com a calculada, em tempo constante.
function isValidSignature(rawBody, header) {
  const secret = env.aiEngine.signingSecret;
  if (!secret) {
    // Sem segredo configurado (dev): não valida, mas avisa alto.
    console.warn('[webhook ai-engine] AI_ENGINE_SIGNING_SECRET ausente — assinatura NÃO validada.');
    return true;
  }
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// message.received.data =
//   { conversationId, contactId, from, contactName?, phone?, channel, messageType, text, ... }
async function handleInboundMessage(tenantId, data) {
  const phone = phoneLabel(data);
  const text = data.text ?? null;
  const kind = data.media ? 'media' : 'text';

  await reconcilePhone(tenantId, data.conversationId, phone);

  const conv = await upsertConversation(tenantId, phone, {
    displayName: data.contactName || data.content?.profileName || null,
    preview: (text || '[mídia]').slice(0, 80),
    bumpUnread: true,
    touchInbound: true,
    waConversationId: data.conversationId || null,
  });

  const msg = await query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, kind, body, media_url, wa_message_id, status)
     VALUES ($1, $2, 'in', $3, $4, $5, $6, 'lido')
     RETURNING ${MESSAGE_FIELDS}`,
    [tenantId, conv.id, kind, text, data.media?.url || null, data.metaMessageId || null],
  );

  emitToTenant(tenantId, 'message:new', msg.rows[0]);
  emitToTenant(tenantId, 'conversation:update', conv);
}

// message.sent.data = { conversationId, contactId, from, messageId, text, ... } — resposta do BOT.
// Espelha no inbox para a Recepção enxergar o que o bot respondeu.
async function handleOutboundMessage(tenantId, data) {
  const waConvId = data.waConversationId || data.conversationId;
  let conv = waConvId
    ? await query(
        `SELECT ${CONVERSATION_FIELDS} FROM conversations
          WHERE tenant_id = $1 AND wa_conversation_id = $2 LIMIT 1`,
        [tenantId, waConvId],
      ).then((r) => r.rows[0])
    : null;

  // Fallback pelo telefone: nosso inbox tem a conversa por (tenant_id, telefone), mas o
  // wa_conversation_id guardado é o PRIMEIRO que vimos (o upsert usa COALESCE). Se o motor
  // manda a resposta com outro conversationId — conversa nova do lado dele, callback de
  // inbound perdido — a busca por id não acha e a mensagem do bot sumia do portal sem deixar
  // rastro. O telefone é a identidade estável dos dois lados.
  if (!conv && data.from) {
    const phone = phoneLabel(data);
    conv = await query(
      `SELECT ${CONVERSATION_FIELDS} FROM conversations
        WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
      [tenantId, phone],
    ).then((r) => r.rows[0]);
    if (conv) {
      console.warn(
        `[webhook ai-engine] message.sent com conversationId desconhecido (${waConvId}); ` +
          `casei por ${phone} (conversa ${conv.id}).`,
      );
    }
  }

  if (!conv) {
    console.warn(
      `[webhook ai-engine] message.sent DESCARTADA: sem conversa espelhada ` +
        `(conversationId=${waConvId ?? '-'}, from=${data.from ?? '-'}).`,
    );
    return;
  }

  const msg = await query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, kind, body, wa_message_id, status)
     VALUES ($1, $2, 'out', 'text', $3, $4, 'enviado')
     RETURNING ${MESSAGE_FIELDS}`,
    [tenantId, conv.id, data.text ?? null, data.messageId || null],
  );
  await query(
    'UPDATE conversations SET last_message_preview = $2, updated_at = now() WHERE id = $1',
    [conv.id, (data.text || '').slice(0, 80)],
  );
  emitToTenant(tenantId, 'message:new', msg.rows[0]);
}

// message.status.data = { conversationId, messageId, metaMessageId, status, clientRef }
async function handleStatus(tenantId, data) {
  const status = mapStatus(data.status);
  const { rows } = await query(
    `UPDATE messages SET status = $3 WHERE tenant_id = $1 AND wa_message_id = $2
     RETURNING ${MESSAGE_FIELDS}`,
    [tenantId, data.messageId || data.metaMessageId, status],
  );
  if (rows[0]) emitToTenant(tenantId, 'message:status', rows[0]);
}

// conversation.handoff.data = { conversationId, handoffAt } — o bot pausou; humano assume.
async function handleHandoff(tenantId, data) {
  const { rows } = await query(
    `UPDATE conversations SET status = 'humano', updated_at = now()
     WHERE tenant_id = $1 AND wa_conversation_id = $2
     RETURNING ${CONVERSATION_FIELDS}`,
    [tenantId, data.conversationId],
  );
  if (rows[0]) emitToTenant(tenantId, 'conversation:update', rows[0]);
}

// Upsert de conversa por (tenant_id, telefone). Liga ao paciente pelo telefone quando existir.
async function upsertConversation(tenantId, phone, opts = {}) {
  const patient = await query(
    'SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2 LIMIT 1',
    [tenantId, phone],
  );
  const { rows } = await query(
    `INSERT INTO conversations
       (tenant_id, phone, display_name, patient_id, status, unread, last_inbound_at, last_message_preview, wa_conversation_id)
     VALUES ($1, $2, $3, $4, 'pendente', $5, ${opts.touchInbound ? 'now()' : 'NULL'}, $6, $7)
     ON CONFLICT (tenant_id, phone) DO UPDATE SET
       unread = conversations.unread + $5,
       last_inbound_at = ${opts.touchInbound ? 'now()' : 'conversations.last_inbound_at'},
       last_message_preview = EXCLUDED.last_message_preview,
       -- O nome NOVO vence: a primeira mensagem de uma conversa costuma chegar sem nome
       -- (o WhatsApp/Telegram só mandam o pushName depois), e com COALESCE ao contrário a
       -- conversa ficava marcada como sem nome para sempre — exibindo o número cru.
       display_name = COALESCE(EXCLUDED.display_name, conversations.display_name),
       -- Idem: o id que o motor acabou de mandar vence o guardado. Segurar o primeiro para
       -- sempre deixava a linha apontando para uma conversa que o motor já não usa, e aí todo
       -- message.sent/handoff que busca por esse id não achava nada.
       wa_conversation_id = COALESCE(EXCLUDED.wa_conversation_id, conversations.wa_conversation_id),
       updated_at = now()
     RETURNING ${CONVERSATION_FIELDS}`,
    [
      tenantId,
      phone,
      opts.displayName,
      patient.rows[0]?.id || null,
      opts.bumpUnread ? 1 : 0,
      opts.preview,
      opts.waConversationId,
    ],
  );
  return rows[0];
}

// Chave da conversa no nosso inbox. `data.phone` é o telefone E.164 de verdade, e o motor só o
// manda quando ele é discável; `data.from` é o endereço do canal, que no Telegram é um chat id e
// no WhatsApp por LID é um identificador opaco. Preferir o phone é o que faz a conversa casar com
// o cadastro do paciente (upsertConversation liga por telefone) em vez de virar uma linha órfã.
function phoneLabel(data) {
  return data.phone || `+${data.from}`;
}

// Migra a linha do inbox quando o telefone real aparece depois (conversa criada com o LID do
// WhatsApp, e o número só veio na mensagem seguinte). Sem isso a recepção acaba com duas entradas
// para a mesma pessoa, uma delas ilegível. O NOT EXISTS protege o UNIQUE (tenant_id, telefone):
// se já existe linha com o número certo, deixamos as duas em paz.
async function reconcilePhone(tenantId, waConversationId, phone) {
  if (!waConversationId || !phone) return;
  const { rowCount } = await query(
    `UPDATE conversations SET phone = $3, updated_at = now()
      WHERE tenant_id = $1 AND wa_conversation_id = $2 AND phone <> $3
        AND NOT EXISTS (
          SELECT 1 FROM conversations c2 WHERE c2.tenant_id = $1 AND c2.phone = $3
        )`,
    [tenantId, waConversationId, phone],
  );
  if (rowCount) console.log(`[webhook ai-engine] conversa ${waConversationId} migrada para ${phone}`);
}

function mapStatus(t) {
  return { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' }[t] || t;
}

// MVP single-clinic: um tenant só. O motor manda um tenantId próprio, mas o id local é outro.
async function resolveTenant() {
  const { rows } = await query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
  return rows[0]?.id || null;
}

export default router;
