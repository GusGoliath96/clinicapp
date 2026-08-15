import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM convenios WHERE tenant_id = $1 ORDER BY nome',
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome, codigo_ans, prazo_pgto, repasse_default, ativo } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
  const { rows } = await query(
    `INSERT INTO convenios (tenant_id, nome, codigo_ans, prazo_pgto, repasse_default, ativo)
     VALUES ($1, $2, $3, COALESCE($4, 0), $5, COALESCE($6, true)) RETURNING *`,
    [req.user.tenantId, nome, codigo_ans, prazo_pgto, repasse_default, ativo],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { nome, codigo_ans, prazo_pgto, repasse_default, ativo } = req.body || {};
  const { rows } = await query(
    `UPDATE convenios SET
       nome = COALESCE($3, nome), codigo_ans = COALESCE($4, codigo_ans),
       prazo_pgto = COALESCE($5, prazo_pgto), repasse_default = COALESCE($6, repasse_default),
       ativo = COALESCE($7, ativo), updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId, nome, codigo_ans, prazo_pgto, repasse_default, ativo],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM convenios WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  if (!rowCount) return res.status(404).json({ error: 'Não encontrado' });
  res.status(204).end();
});

export default router;
