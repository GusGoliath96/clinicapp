import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT t.*, pr.nome AS profissional_nome
    FROM treatments t LEFT JOIN professionals pr ON pr.id = t.professional_id
    WHERE t.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND t.patient_id = $${params.length}`; }
  sql += ' ORDER BY t.inicio DESC NULLS LAST, t.created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM treatments WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio, fim, obs } = req.body || {};
  if (!patient_id || !nome) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });
  const { rows } = await query(
    `INSERT INTO treatments (tenant_id, patient_id, professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio, fim, obs)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, 0), COALESCE($8, 'ativo'), $9, $10, $11, $12) RETURNING *`,
    [req.user.tenantId, patient_id, professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio, fim, obs],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio, fim, obs } = req.body || {};
  const { rows } = await query(
    `UPDATE treatments SET
       professional_id = COALESCE($3, professional_id), nome = COALESCE($4, nome), tipo = COALESCE($5, tipo),
       total_sessoes = COALESCE($6, total_sessoes), sessoes_feitas = COALESCE($7, sessoes_feitas),
       status = COALESCE($8, status), valor = COALESCE($9, valor),
       inicio = COALESCE($10, inicio), fim = COALESCE($11, fim), obs = COALESCE($12, obs), updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio, fim, obs],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM treatments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
