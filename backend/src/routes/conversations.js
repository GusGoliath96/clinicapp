import { Router } from 'express';
import { query } from '../config/db.js';
import { sendSessionText } from '../integrations/aiEngine.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();
const JANELA_24H_MS = 24 * 60 * 60 * 1000;

// O nome do paciente vem junto porque é o melhor rótulo que existe para a conversa: o nome do
// cadastro ganha do pushName do WhatsApp, que ganha do número — e o número, no Telegram e no
// WhatsApp endereçado por LID, é um id opaco que não diz nada para a recepção.
const SELECT_CONVERSA = `
  SELECT c.*, p.nome AS paciente_nome
    FROM conversations c
    LEFT JOIN patients p ON p.id = c.patient_id`;

// Lista da sidebar da Recepção.
router.get('/', async (req, res) => {
  const { status } = req.query;
  const params = [req.user.tenantId];
  let sql = `${SELECT_CONVERSA} WHERE c.tenant_id = $1`;
  if (status) { params.push(status); sql += ` AND c.status = $${params.length}`; }
  sql += ' ORDER BY c.updated_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id/messages', async (req, res) => {
  const conv = await getConv(req);
  if (!conv) return res.status(404).json({ error: 'Não encontrada' });
  const { rows } = await query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at',
    [conv.id],
  );
  // Zera unread ao abrir.
  await query('UPDATE conversations SET unread = 0 WHERE id = $1', [conv.id]);
  res.json({ conversation: conv, messages: rows });
});

// Envio pela secretária (texto de sessão — só dentro da janela de 24h).
router.post('/:id/messages', async (req, res) => {
  const { texto } = req.body || {};
  if (!texto) return res.status(400).json({ error: 'texto é obrigatório' });
  const conv = await getConv(req);
  if (!conv) return res.status(404).json({ error: 'Não encontrada' });

  const dentroJanela = conv.last_inbound_at &&
    Date.now() - new Date(conv.last_inbound_at).getTime() < JANELA_24H_MS;
  if (!dentroJanela) {
    return res.status(409).json({
      error: 'Fora da janela de 24h — use um template aprovado (POST /messages/template).',
    });
  }

  let result;
  try {
    result = await sendSessionText(conv.telefone, texto);
  } catch (err) {
    if (err.code === 'window_closed') {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
  const { rows } = await query(
    `INSERT INTO messages (tenant_id, conversation_id, direction, tipo, texto, wa_message_id, enviado_por)
     VALUES ($1, $2, 'out', 'text', $3, $4, $5) RETURNING *`,
    [req.user.tenantId, conv.id, texto, result.messageId, req.user.id],
  );
  await query(
    `UPDATE conversations SET last_message_preview = $2, updated_at = now() WHERE id = $1`,
    [conv.id, texto.slice(0, 80)],
  );
  emitToTenant(req.user.tenantId, 'message:new', rows[0]);
  res.status(201).json(rows[0]);
});

// Secretária assume a conversa.
router.post('/:id/assign', async (req, res) => {
  const { rows } = await query(
    `UPDATE conversations SET status = 'humano', atendente_id = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrada' });
  emitToTenant(req.user.tenantId, 'conversation:update', rows[0]);
  res.json(rows[0]);
});

router.post('/:id/resolve', async (req, res) => {
  const { rows } = await query(
    `UPDATE conversations SET status = 'resolvida', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrada' });
  emitToTenant(req.user.tenantId, 'conversation:update', rows[0]);
  res.json(rows[0]);
});

// Muda o status para um valor arbitrário (usado pelo drag & drop do Hub).
const STATUS_VALIDOS = ['pendente', 'humano', 'resolvida'];
router.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  const atendente = status === 'humano' ? req.user.id : null;
  const { rows } = await query(
    `UPDATE conversations SET status = $3,
       atendente_id = COALESCE($4, atendente_id),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, status, atendente],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrada' });
  emitToTenant(req.user.tenantId, 'conversation:update', rows[0]);
  res.json(rows[0]);
});

async function getConv(req) {
  const { rows } = await query(
    `${SELECT_CONVERSA} WHERE c.id = $1 AND c.tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  return rows[0] || null;
}

export default router;
