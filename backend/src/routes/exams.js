import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { query } from '../config/db.js';
import { uploadsDir } from '../config/paths.js';

const router = Router();
const MAX_PDF = 15 * 1024 * 1024; // 15 MB

// Prefixo parametrizado: o GET tem JOIN com professionals, que também tem id e name.
const fields = (p = '') => `${p}id, ${p}tenant_id, ${p}patient_id, ${p}professional_id,
  ${p}appointment_id, ${p}name AS nome, ${p}kind AS tipo, ${p}status,
  ${p}requested_on AS data_solicitacao, ${p}resulted_on AS data_resultado,
  ${p}report AS laudo, ${p}file_url AS arquivo_url, ${p}indication AS indicacao,
  ${p}created_at, ${p}updated_at`;

router.get('/', async (req, res) => {
  const { patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT ${fields('e.')}, pr.name AS profissional_nome
    FROM exams e LEFT JOIN professionals pr ON pr.id = e.professional_id
    WHERE e.tenant_id = $1`;
  if (patientId) { params.push(patientId); sql += ` AND e.patient_id = $${params.length}`; }
  sql += ' ORDER BY e.requested_on DESC NULLS LAST, e.created_at DESC';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${fields()} FROM exams WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, appointment_id, nome: name, tipo: kind, status,
          data_solicitacao: requestedOn, data_resultado: resultedOn,
          laudo: report, arquivo_url: fileUrl, indicacao: indication } = req.body || {};
  if (!patient_id || !name) return res.status(400).json({ error: 'patient_id e nome são obrigatórios' });

  const { rows } = await query(
    `INSERT INTO exams (tenant_id, patient_id, professional_id, appointment_id, name, kind,
       status, requested_on, resulted_on, report, file_url, indication)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'solicitado'), $8, $9, $10, $11, $12)
     RETURNING ${fields()}`,
    [req.user.tenantId, patient_id, professional_id, appointment_id, name, kind, status,
     requestedOn, resultedOn, report, fileUrl, indication],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { professional_id, appointment_id, nome: name, tipo: kind, status,
          data_solicitacao: requestedOn, data_resultado: resultedOn,
          laudo: report, arquivo_url: fileUrl, indicacao: indication } = req.body || {};
  const hasIndication = indication !== undefined; // permite limpar (string vazia)

  const { rows } = await query(
    `UPDATE exams SET
       professional_id = COALESCE($3, professional_id), appointment_id = COALESCE($4, appointment_id),
       name = COALESCE($5, name), kind = COALESCE($6, kind), status = COALESCE($7, status),
       requested_on = COALESCE($8, requested_on), resulted_on = COALESCE($9, resulted_on),
       report = COALESCE($10, report), file_url = COALESCE($11, file_url),
       indication = CASE WHEN $12 THEN $13 ELSE indication END, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${fields()}`,
    [req.params.id, req.user.tenantId, professional_id, appointment_id, name, kind, status,
     requestedOn, resultedOn, report, fileUrl, hasIndication, indication ?? null],
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

  const existing = await query(
    'SELECT id, file_url FROM exams WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!existing.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(uploadsDir, filename), buf);
    // Remove o arquivo anterior, se houver.
    const previous = existing.rows[0].file_url;
    if (previous && previous.startsWith('/uploads/')) {
      fs.rm(path.join(uploadsDir, path.basename(previous)), () => {});
    }
    const { rows } = await query(
      `UPDATE exams SET file_url = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING ${fields()}`,
      [req.params.id, req.user.tenantId, `/uploads/${filename}`],
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
