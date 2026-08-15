import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'email e senha são obrigatórios' });

  const { rows } = await query(
    'SELECT * FROM users WHERE email = $1 AND ativo = true LIMIT 1',
    [email],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(senha, user.senha_hash))) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, nome: user.nome, email: user.email, papel: user.papel, professional_id: user.professional_id },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, nome, email, papel, professional_id FROM users WHERE id = $1',
    [req.user.id],
  );
  res.json(rows[0] || null);
});

export default router;
