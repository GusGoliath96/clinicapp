import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';

const router = Router();
const PAPEIS = ['admin', 'recepcao', 'medico'];

// Nunca retorna senha_hash.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.nome, u.email, u.papel, u.ativo, u.professional_id, u.created_at,
            pr.nome AS profissional_nome
       FROM users u LEFT JOIN professionals pr ON pr.id = u.professional_id
      WHERE u.tenant_id = $1 ORDER BY u.nome`,
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome, email, senha, papel, professional_id } = req.body || {};
  if (!nome || !email || !senha) return res.status(400).json({ error: 'nome, email e senha são obrigatórios' });
  if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ error: 'papel inválido' });
  try {
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await query(
      `INSERT INTO users (tenant_id, nome, email, senha_hash, papel, professional_id)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'recepcao'), $6)
       RETURNING id, nome, email, papel, ativo, professional_id, created_at`,
      [req.user.tenantId, nome, email, hash, papel, professional_id || null],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
    console.error('[users.post]', e.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o usuário.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome, email, papel, ativo, senha, professional_id } = req.body || {};
  if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ error: 'papel inválido' });
  try {
    const hash = senha ? await bcrypt.hash(senha, 10) : null;
    // professional_id: undefined = não mexe; null = desvincula; valor = vincula.
    const temProf = professional_id !== undefined;
    const { rows } = await query(
      `UPDATE users SET
         nome = COALESCE($3, nome), email = COALESCE($4, email),
         papel = COALESCE($5, papel), ativo = COALESCE($6, ativo),
         senha_hash = COALESCE($7, senha_hash),
         professional_id = CASE WHEN $8 THEN $9 ELSE professional_id END,
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, nome, email, papel, ativo, professional_id, created_at`,
      [req.params.id, req.user.tenantId, nome, email, papel, ativo, hash, temProf, professional_id || null],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
    console.error('[users.put]', e.message);
    res.status(500).json({ error: 'Não foi possível salvar o usuário.' });
  }
});

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(409).json({ error: 'Você não pode excluir o próprio usuário.' });
  }
  const { rowCount } = await query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenantId]);
  if (!rowCount) return res.status(404).json({ error: 'Não encontrado' });
  res.status(204).end();
});

export default router;
