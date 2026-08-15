import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();
const j = (v) => (v == null ? null : JSON.stringify(v));

// Dados da própria clínica (tenant do token).
router.get('/', async (req, res) => {
  const { rows } = await query('SELECT id, nome, config FROM tenants WHERE id = $1', [req.user.tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.put('/', async (req, res) => {
  const { nome, config } = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE tenants SET nome = COALESCE($2, nome), config = COALESCE($3::jsonb, config), updated_at = now()
       WHERE id = $1 RETURNING id, nome, config`,
      [req.user.tenantId, nome, j(config)],
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('[tenant.put]', e.message);
    res.status(500).json({ error: 'Não foi possível salvar os dados da clínica.' });
  }
});

export default router;
