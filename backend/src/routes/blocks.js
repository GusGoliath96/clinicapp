import { Router } from 'express';
import { query } from '../config/db.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();

// GET /blocks?de=&ate=  → bloqueios que tocam o período (para desenhar na grade).
// professional_id NULL = bloqueio geral da clínica (vale para todos).
router.get('/', async (req, res) => {
  const { de, ate, professionalId } = req.query;
  const params = [req.user.tenantId];
  let sql = `
    SELECT b.*, pr.nome AS profissional_nome
    FROM blocks b
    LEFT JOIN professionals pr ON pr.id = b.professional_id
    WHERE b.tenant_id = $1`;
  // Sobreposição com [de, ate): inicio < ate AND fim > de
  if (ate) { params.push(ate); sql += ` AND b.inicio < $${params.length}`; }
  if (de) { params.push(de); sql += ` AND b.fim > $${params.length}`; }
  if (professionalId) {
    params.push(professionalId);
    sql += ` AND (b.professional_id = $${params.length} OR b.professional_id IS NULL)`;
  }
  sql += ' ORDER BY b.inicio';
  const { rows } = await query(sql, params);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { professional_id, inicio, fim, motivo, descricao } = req.body || {};
  if (!inicio || !fim) {
    return res.status(400).json({ error: 'inicio e fim são obrigatórios' });
  }
  const { rows } = await query(
    `INSERT INTO blocks (tenant_id, professional_id, inicio, fim, motivo, descricao)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.tenantId, professional_id || null, inicio, fim, motivo, descricao],
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
