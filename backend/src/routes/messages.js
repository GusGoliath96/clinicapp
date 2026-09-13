import { Router } from 'express';
import { query } from '../config/db.js';
import { sendTemplate } from '../integrations/aiEngine.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();

const MESSAGE_FIELDS = `id, tenant_id, conversation_id, direction, kind AS tipo,
  body AS texto, media_url, wa_message_id, status, sent_by AS enviado_por, created_at`;

// Envio de template aprovado (lembrete/confirmação, ou fora da janela de 24h).
// body: { conversationId, templateId, params: [], textoPreview }
router.post('/template', async (req, res) => {
  const { conversationId, templateId, params = [], textoPreview } = req.body || {};
  if (!conversationId || !templateId) {
    return res.status(400).json({ error: 'conversationId e templateId são obrigatórios' });
  }
  const conv = await query(
    'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2',
    [conversationId, req.user.tenantId],
  );
  if (!conv.rows[0]) return res.status(404).json({ error: 'Conversa não encontrada' });

  const result = await sendTemplate(conv.rows[0].phone, templateId, params);
  const { rows } = await query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, kind, body, wa_message_id, sent_by)
     VALUES ($1, $2, 'out', 'template', $3, $4, $5)
     RETURNING ${MESSAGE_FIELDS}`,
    [req.user.tenantId, conversationId, textoPreview || `[template: ${templateId}]`, result.messageId, req.user.id],
  );
  emitToTenant(req.user.tenantId, 'message:new', rows[0]);
  res.status(201).json(rows[0]);
});

export default router;
