import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = 'SELECT * FROM documents WHERE tenant_id = $1';
  if (patientId) { params.push(patientId); sql += ` AND patient_id = $${params.length}`; }
  sql += ' ORDER BY data DESC NULLS LAST, created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM documents WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, tipo, nome, status, arquivo_url, data } = req.body || {};
  if (!patient_id || !nome) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });
  const { rows } = await query(
    `INSERT INTO documents (tenant_id, patient_id, tipo, nome, status, arquivo_url, data)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'pendente'), $6, $7) RETURNING *`,
    [req.user.tenantId, patient_id, tipo, nome, status, arquivo_url, data],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { tipo, nome, status, arquivo_url, data } = req.body || {};
  const { rows } = await query(
    `UPDATE documents SET
       tipo = COALESCE($3, tipo), nome = COALESCE($4, nome),
       status = COALESCE($5, status), arquivo_url = COALESCE($6, arquivo_url),
       data = COALESCE($7, data), updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, tipo, nome, status, arquivo_url, data],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
