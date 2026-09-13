import { Router } from 'express';
import { query } from '../config/db.js';
import { hashPassword, validatePolicy } from '../config/password.js';

// O payload da API segue em português (nome, papel, ativo, senha): é contrato com o
// frontend e com o motor de IA, que não muda neste refactor. Daí os alias nos SELECTs.

const router = Router();
const ROLES = ['admin', 'recepcao', 'medico'];

// Nunca retorna password_hash.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name AS nome, u.email, u.role AS papel, u.active AS ativo,
            u.professional_id, u.created_at, pr.name AS profissional_nome
       FROM users u LEFT JOIN professionals pr ON pr.id = u.professional_id
      WHERE u.tenant_id = $1 ORDER BY u.name`,
    [req.user.tenantId],
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome: name, email, senha: password, papel: role, professional_id } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'nome, email e senha são obrigatórios' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'papel inválido' });

  const weak = validatePolicy(password, { email });
  if (weak) return res.status(400).json({ error: weak });

  try {
    const hash = await hashPassword(password);
    const { rows } = await query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role, professional_id)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'recepcao'), $6)
       RETURNING id, name AS nome, email, role AS papel, active AS ativo, professional_id, created_at`,
      [req.user.tenantId, name, email, hash, role, professional_id || null],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
    console.error('[users.post]', e.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o usuário.' });
  }
});

router.put('/:id', async (req, res) => {
  const { nome: name, email, papel: role, ativo: active, senha: password, professional_id } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'papel inválido' });

  // Um admin que se rebaixa ou se desativa não consegue desfazer o próprio erro: /users
  // exige papel admin, e ele deixaria de ter. Se for o último admin, ninguém mais consegue.
  if (req.params.id === req.user.id && ((role && role !== 'admin') || active === false)) {
    return res.status(409).json({ error: 'Você não pode remover o próprio acesso de admin.' });
  }

  if (password) {
    const weak = validatePolicy(password, { email });
    if (weak) return res.status(400).json({ error: weak });
  }

  try {
    const hash = password ? await hashPassword(password) : null;
    // Trocar senha, papel ou desativar precisa derrubar as sessões abertas do usuário —
    // senão o JWT antigo continua valendo com o acesso antigo por até 7 dias.
    const revoke = Boolean(password || role || active === false);
    // professional_id: undefined = não mexe; null = desvincula; valor = vincula.
    const hasProfessional = professional_id !== undefined;
    const { rows } = await query(
      `UPDATE users SET
         name = COALESCE($3, name), email = COALESCE($4, email),
         role = COALESCE($5, role), active = COALESCE($6, active),
         password_hash = COALESCE($7, password_hash),
         professional_id = CASE WHEN $8 THEN $9 ELSE professional_id END,
         password_changed_at = CASE WHEN $7 IS NULL THEN password_changed_at ELSE now() END,
         token_version = token_version + CASE WHEN $10 THEN 1 ELSE 0 END,
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, name AS nome, email, role AS papel, active AS ativo, professional_id, created_at`,
      [req.params.id, req.user.tenantId, name, email, role, active, hash, hasProfessional, professional_id || null, revoke],
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
