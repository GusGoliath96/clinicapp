import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();
const j = (v) => (v == null ? null : JSON.stringify(v)); // p/ coluna jsonb

// Prefixo parametrizado: o GET tem JOIN com professionals, que também tem id e tenant_id.
const fields = (p = '') => `${p}id, ${p}tenant_id, ${p}patient_id, ${p}professional_id,
  ${p}appointment_id, ${p}kind AS tipo, ${p}content AS conteudo, ${p}data AS dados,
  ${p}noted_at AS data, ${p}created_at`;

router.get('/', async (req, res) => {
  const { patientId, appointmentId, tipo: kind } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT ${fields('n.')}, pr.name AS profissional_nome
    FROM clinical_notes n LEFT JOIN professionals pr ON pr.id = n.professional_id
    WHERE n.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND n.patient_id = $${params.length}`; }
  if (appointmentId) { params.push(appointmentId); sql += ` AND n.appointment_id = $${params.length}`; }
  if (kind) { params.push(kind); sql += ` AND n.kind = $${params.length}`; }
  sql += ' ORDER BY n.noted_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${fields()} FROM clinical_notes WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, appointment_id,
          tipo: kind, conteudo: content, data: notedAt, dados: structured } = req.body || {};
  if (!patient_id) return res.status(400).json({ error: 'patient_id é obrigatório' });

  const { rows } = await query(
    `INSERT INTO clinical_notes (tenant_id, patient_id, professional_id, appointment_id,
       kind, content, noted_at, data)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'evolucao'), $6, COALESCE($7, now()), $8::jsonb)
     RETURNING ${fields()}`,
    [req.user.tenantId, patient_id, professional_id, appointment_id, kind, content, notedAt, j(structured)],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { tipo: kind, conteudo: content, dados: structured } = req.body || {};
  const { rows } = await query(
    `UPDATE clinical_notes SET kind = COALESCE($3, kind), content = COALESCE($4, content),
       data = COALESCE($5::jsonb, data)
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${fields()}`,
    [req.params.id, req.user.tenantId, kind, content, j(structured)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM clinical_notes WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
