import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

const SELECT_FIELDS = `id, tenant_id, patient_id, kind AS tipo, name AS nome, status,
  file_url AS arquivo_url, date AS data, created_at, updated_at`;

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT ${SELECT_FIELDS} FROM documents WHERE tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND patient_id = $${params.length}`; }
  sql += ' ORDER BY date DESC NULLS LAST, created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${SELECT_FIELDS} FROM documents WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, tipo: kind, nome: name, status, arquivo_url: fileUrl, data: date } = req.body || {};
  if (!patient_id || !name) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });
  const { rows } = await query(
    `INSERT INTO documents (tenant_id, patient_id, kind, name, status, file_url, date)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'pendente'), $6, $7)
     RETURNING ${SELECT_FIELDS}`,
    [req.user.tenantId, patient_id, kind, name, status, fileUrl, date],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { tipo: kind, nome: name, status, arquivo_url: fileUrl, data: date } = req.body || {};
  const { rows } = await query(
    `UPDATE documents SET
       kind = COALESCE($3, kind), name = COALESCE($4, name),
       status = COALESCE($5, status), file_url = COALESCE($6, file_url),
       date = COALESCE($7, date), updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${SELECT_FIELDS}`,
    [req.params.id, req.user.tenantId, kind, name, status, fileUrl, date],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM documents WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
