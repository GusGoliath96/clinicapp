import { Router } from 'express';
import { query } from '../config/db.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();

const SELECT_FIELDS = `b.id, b.tenant_id, b.professional_id, b.starts_at AS inicio,
  b.ends_at AS fim, b.reason AS motivo, b.description AS descricao, b.created_at`;

// GET /blocks?de=&ate=  → bloqueios que tocam o período (para desenhar na grade).
// professional_id NULL = bloqueio geral da clínica (vale para todos).
router.get('/', async (req, res) => {
  const { de, ate, professionalId } = req.query;
  const params = [req.user.tenantId];
  let sql = `
    SELECT ${SELECT_FIELDS}, pr.name AS profissional_nome
    FROM blocks b
    LEFT JOIN professionals pr ON pr.id = b.professional_id
    WHERE b.tenant_id = $1`;
  // Sobreposição com [de, ate): starts_at < ate AND ends_at > de
  if (ate) { params.push(ate); sql += ` AND b.starts_at < $${params.length}`; }
  if (de) { params.push(de); sql += ` AND b.ends_at > $${params.length}`; }
  if (professionalId) {
    params.push(professionalId);
    sql += ` AND (b.professional_id = $${params.length} OR b.professional_id IS NULL)`;
  }
  sql += ' ORDER BY b.starts_at';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { professional_id, inicio: startsAt, fim: endsAt,
          motivo: reason, descricao: description } = req.body || {};
  if (!startsAt || !endsAt) {
    return res.status(400).json({ error: 'inicio e fim são obrigatórios' });
  }
  const { rows } = await query(
    `INSERT INTO blocks (tenant_id, professional_id, starts_at, ends_at, reason, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, professional_id, starts_at AS inicio, ends_at AS fim,
               reason AS motivo, description AS descricao, created_at`,
    [req.user.tenantId, professional_id || null, startsAt, endsAt, reason, description],
  );
  emitToTenant(req.user.tenantId, 'block:update', rows[0]);
  res.status(201).json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM blocks WHERE id = $1 AND tenant_id = $2', [
    req.params.id, req.user.tenantId,
  ]);
  emitToTenant(req.user.tenantId, 'block:update', { id: req.params.id, deleted: true });
  res.status(204).end();
});

export default router;
