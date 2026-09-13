import { Router } from 'express';
import { query } from '../config/db.js';

// O payload segue em português: além do frontend, o motor de IA lê `especialidade` daqui
// para saber o que a clínica atende. Os alias mantêm esse contrato sobre as colunas novas.

const router = Router();

// Serializa o campo schedule (jsonb) — ver nota em patients.js sobre arrays/objetos.
const j = (v) => (v == null ? null : JSON.stringify(v));

const SELECT_FIELDS = `id, tenant_id, name AS nome, license AS conselho,
  specialty AS especialidade, color AS cor, active AS ativo, schedule AS agenda,
  created_at, updated_at`;

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${SELECT_FIELDS} FROM professionals WHERE tenant_id = $1 ORDER BY name`,
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome: name, conselho: license, especialidade: specialty,
          cor: color, agenda: schedule } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });

  try {
    const { rows } = await query(
      `INSERT INTO professionals (tenant_id, name, license, specialty, color, schedule)
       VALUES ($1, $2, $3, $4, COALESCE($5, '#2563eb'), COALESCE($6::jsonb, '{}'))
       RETURNING ${SELECT_FIELDS}`,
      [req.user.tenantId, name, license, specialty, color, j(schedule)],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[professionals.post]', e.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o profissional.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome: name, conselho: license, especialidade: specialty,
          cor: color, agenda: schedule, ativo: active } = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE professionals SET
         name = COALESCE($3, name),
         license = COALESCE($4, license),
         specialty = COALESCE($5, specialty),
         color = COALESCE($6, color),
         schedule = COALESCE($7::jsonb, schedule),
         active = COALESCE($8, active),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${SELECT_FIELDS}`,
      [req.params.id, req.user.tenantId, name, license, specialty, color, j(schedule), active],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[professionals.put]', e.message);
    res.status(500).json({ error: 'Não foi possível salvar o profissional.' });
  }
});

// Exclusão protegida: como appointments.professional_id é ON DELETE CASCADE,
// apagar um profissional apagaria o histórico de consultas dele. Se houver consultas,
// recusamos e sugerimos desativar (PUT ativo=false).
router.delete('/:id', async (req, res) => {
  const usage = await query(
    'SELECT COUNT(*)::int AS n FROM appointments WHERE professional_id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (usage.rows[0].n > 0) {
    return res.status(409).json({
      error: `Este profissional tem ${usage.rows[0].n} consulta(s) vinculada(s). Desative-o em vez de excluir para preservar o histórico.`,
    });
  }
  const { rowCount } = await query(
    'DELETE FROM professionals WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rowCount) return res.status(404).json({ error: 'Não encontrado' });
  res.status(204).end();
});

export default router;
