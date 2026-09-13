import { Router } from 'express';
import { query } from '../config/db.js';

// Convênios da clínica. A tabela é insurance_plans e a rota pública continua /convenios;
// o payload segue em português por ser contrato com o frontend.

const router = Router();

const SELECT_FIELDS = `id, tenant_id, name AS nome, ans_code AS codigo_ans,
  payment_term_days AS prazo_pgto, default_split AS repasse_default, active AS ativo,
  created_at, updated_at`;

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${SELECT_FIELDS} FROM insurance_plans WHERE tenant_id = $1 ORDER BY name`,
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome: name, codigo_ans: ansCode, prazo_pgto: paymentTermDays,
          repasse_default: defaultSplit, ativo: active } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });

  const { rows } = await query(
    `INSERT INTO insurance_plans (tenant_id, name, ans_code, payment_term_days, default_split, active)
     VALUES ($1, $2, $3, COALESCE($4, 0), $5, COALESCE($6, true))
     RETURNING ${SELECT_FIELDS}`,
    [req.user.tenantId, name, ansCode, paymentTermDays, defaultSplit, active],
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { nome: name, codigo_ans: ansCode, prazo_pgto: paymentTermDays,
          repasse_default: defaultSplit, ativo: active } = req.body || {};

  const { rows } = await query(
    `UPDATE insurance_plans SET
       name = COALESCE($3, name), ans_code = COALESCE($4, ans_code),
       payment_term_days = COALESCE($5, payment_term_days),
       default_split = COALESCE($6, default_split),
       active = COALESCE($7, active), updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${SELECT_FIELDS}`,
    [req.params.id, req.user.tenantId, name, ansCode, paymentTermDays, defaultSplit, active],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM insurance_plans WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.user.tenantId],
  );
  if (!rowCount) return res.status(404).json({ error: 'Não encontrado' });
  res.status(204).end();
});

export default router;
