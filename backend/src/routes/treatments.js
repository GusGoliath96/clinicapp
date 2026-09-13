import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// O payload segue em português (contrato com o frontend), então as colunas saem com alias.
// O prefixo é parâmetro porque o GET com JOIN precisa qualificar as colunas ambíguas
// (professionals também tem id, tenant_id e name).
const fields = (p = '') => `${p}id, ${p}tenant_id, ${p}patient_id, ${p}professional_id,
  ${p}name AS nome, ${p}kind AS tipo, ${p}total_sessions AS total_sessoes,
  ${p}completed_sessions AS sessoes_feitas, ${p}status, ${p}price AS valor,
  ${p}starts_on AS inicio, ${p}ends_on AS fim, ${p}notes AS obs,
  ${p}created_at, ${p}updated_at`;

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT ${fields('t.')}, pr.name AS profissional_nome
    FROM treatments t LEFT JOIN professionals pr ON pr.id = t.professional_id
    WHERE t.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND t.patient_id = $${params.length}`; }
  sql += ' ORDER BY t.starts_on DESC NULLS LAST, t.created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${fields()} FROM treatments WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, nome: name, tipo: kind,
          total_sessoes: totalSessions, sessoes_feitas: completedSessions,
          status, valor: price, inicio: startsOn, fim: endsOn, obs: notes } = req.body || {};
  if (!patient_id || !name) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });

  const { rows } = await query(
    `INSERT INTO treatments (tenant_id, patient_id, professional_id, name, kind,
       total_sessions, completed_sessions, status, price, starts_on, ends_on, notes)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), COALESCE($7, 0), COALESCE($8, 'ativo'), $9, $10, $11, $12)
     RETURNING ${fields()}`,
    [req.user.tenantId, patient_id, professional_id, name, kind,
     totalSessions, completedSessions, status, price, startsOn, endsOn, notes],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { professional_id, nome: name, tipo: kind,
          total_sessoes: totalSessions, sessoes_feitas: completedSessions,
          status, valor: price, inicio: startsOn, fim: endsOn, obs: notes } = req.body || {};

  const { rows } = await query(
    `UPDATE treatments SET
       professional_id = COALESCE($3, professional_id), name = COALESCE($4, name),
       kind = COALESCE($5, kind),
       total_sessions = COALESCE($6, total_sessions),
       completed_sessions = COALESCE($7, completed_sessions),
       status = COALESCE($8, status), price = COALESCE($9, price),
       starts_on = COALESCE($10, starts_on), ends_on = COALESCE($11, ends_on),
       notes = COALESCE($12, notes), updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${fields()}`,
    [req.params.id, req.user.tenantId, professional_id, name, kind,
     totalSessions, completedSessions, status, price, startsOn, endsOn, notes],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM treatments WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
