import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();
const j = (v) => (v == null ? null : JSON.stringify(v)); // p/ coluna jsonb

router.get('/', async (req, res) => {
  const { patientId, appointmentId, tipo } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT n.*, pr.nome AS profissional_nome
    FROM clinical_notes n LEFT JOIN professionals pr ON pr.id = n.professional_id
    WHERE n.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND n.patient_id = $${params.length}`; }
  if (appointmentId) { params.push(appointmentId); sql += ` AND n.appointment_id = $${params.length}`; }
  if (tipo) { params.push(tipo); sql += ` AND n.tipo = $${params.length}`; }
  sql += ' ORDER BY n.data DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM clinical_notes WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, appointment_id, tipo, conteudo, data, dados } = req.body || {};
  if (!patient_id) return res.status(400).json({ error: 'patient_id é obrigatório' });
  const { rows } = await query(
    `INSERT INTO clinical_notes (tenant_id, patient_id, professional_id, appointment_id, tipo, conteudo, data, dados)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'evolucao'), $6, COALESCE($7, now()), $8::jsonb) RETURNING *`,
    [req.user.tenantId, patient_id, professional_id, appointment_id, tipo, conteudo, data, j(dados)],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { tipo, conteudo, dados } = req.body || {};
  const { rows } = await query(
    `UPDATE clinical_notes SET tipo = COALESCE($3, tipo), conteudo = COALESCE($4, conteudo),
       dados = COALESCE($5::jsonb, dados)
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, tipo, conteudo, j(dados)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM clinical_notes WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
