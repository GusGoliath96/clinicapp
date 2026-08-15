import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// Serializa o campo agenda (jsonb) — ver nota em patients.js sobre arrays/objetos.
const j = (v) => (v == null ? null : JSON.stringify(v));

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM professionals WHERE tenant_id = $1 ORDER BY nome',
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome, conselho, especialidade, cor, agenda } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
  try {
    const { rows } = await query(
      `INSERT INTO professionals (tenant_id, nome, conselho, especialidade, cor, agenda)
       VALUES ($1, $2, $3, $4, COALESCE($5, '#2563eb'), COALESCE($6::jsonb, '{}'))
       RETURNING *`,
      [req.user.tenantId, nome, conselho, especialidade, cor, j(agenda)],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[professionals.post]', e.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o profissional.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome, conselho, especialidade, cor, agenda, ativo } = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE professionals SET
         nome = COALESCE($3, nome),
         conselho = COALESCE($4, conselho),
         especialidade = COALESCE($5, especialidade),
         cor = COALESCE($6, cor),
         agenda = COALESCE($7::jsonb, agenda),
         ativo = COALESCE($8, ativo),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.id, req.user.tenantId, nome, conselho, especialidade, cor, j(agenda), ativo],
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
  const uso = await query(
    'SELECT COUNT(*)::int AS n FROM appointments WHERE professional_id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (uso.rows[0].n > 0) {
    return res.status(409).json({
      error: `Este profissional tem ${uso.rows[0].n} consulta(s) vinculada(s). Desative-o em vez de excluir para preservar o histórico.`,
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
