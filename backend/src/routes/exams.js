import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '../config/db.js';
import { uploadsDir } from '../config/paths.js';

const router = Router();
const MAX_PDF = 15 * 1024 * 1024; // 15 MB

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT e.*, pr.nome AS profissional_nome
    FROM exams e LEFT JOIN professionals pr ON pr.id = e.professional_id
    WHERE e.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND e.patient_id = $${params.length}`; }
  sql += ' ORDER BY e.data_solicitacao DESC NULLS LAST, e.created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM exams WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, appointment_id, nome, tipo, status, data_solicitacao, data_resultado, laudo, arquivo_url, indicacao } = req.body || {};
  if (!patient_id || !nome) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });
  const { rows } = await query(
    `INSERT INTO exams (tenant_id, patient_id, professional_id, appointment_id, nome, tipo, status, data_solicitacao, data_resultado, laudo, arquivo_url, indicacao)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'solicitado'), $8, $9, $10, $11, $12) RETURNING *`,
    [req.user.tenantId, patient_id, professional_id, appointment_id, nome, tipo, status, data_solicitacao, data_resultado, laudo, arquivo_url, indicacao],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { professional_id, appointment_id, nome, tipo, status, data_solicitacao, data_resultado, laudo, arquivo_url, indicacao } = req.body || {};
  const temIndicacao = indicacao !== undefined; // permite limpar (string vazia)
  const { rows } = await query(
    `UPDATE exams SET
       professional_id = COALESCE($3, professional_id), appointment_id = COALESCE($4, appointment_id),
       nome = COALESCE($5, nome), tipo = COALESCE($6, tipo), status = COALESCE($7, status),
       data_solicitacao = COALESCE($8, data_solicitacao), data_resultado = COALESCE($9, data_resultado),
       laudo = COALESCE($10, laudo), arquivo_url = COALESCE($11, arquivo_url),
       indicacao = CASE WHEN $12 THEN $13 ELSE indicacao END, updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, professional_id, appointment_id, nome, tipo, status, data_solicitacao, data_resultado, laudo, arquivo_url, temIndicacao, indicacao ?? null],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

// Anexar (ou trocar) o PDF do resultado. Recebe um data URL base64 de PDF.
router.post('/:id/arquivo', async (req, res) => {
  const { dataUrl } = req.body || {};
  const m = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Arquivo inválido.' });
  if (m[1] !== 'application/pdf') return res.status(400).json({ error: 'Envie um arquivo PDF.' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return res.status(400).json({ error: 'Arquivo vazio.' });
  if (buf.length > MAX_PDF) return res.status(413).json({ error: 'PDF muito grande (máx. 15 MB).' });

  const ex = await query('SELECT id, arquivo_url FROM exams WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  if (!ex.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fname = `${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(uploadsDir, fname), buf);
    // Remove o arquivo anterior, se houver.
    const anterior = ex.rows[0].arquivo_url;
    if (anterior && anterior.startsWith('/uploads/')) {
      fs.rm(path.join(uploadsDir, path.basename(anterior)), () => {});
    }
    const { rows } = await query(
      'UPDATE exams SET arquivo_url = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [req.params.id, req.user.tenantId, `/uploads/${fname}`],
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('[exams.arquivo]', e.message);
    res.status(500).json({ error: 'Não foi possível anexar o arquivo.' });
  }
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM exams WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  res.status(204).end();
});

export default router;
