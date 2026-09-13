// Emite um JWT válido lendo o banco, sem passar pelo login.
//
//   npm run auth:token -- <email>
//
// Saída de emergência do 2FA obrigatório: se o provedor de e-mail cair, ou o código
// parar no spam, ninguém entra — e o conserto dependeria justamente do login quebrado.
// Rodar isto exige acesso ao servidor e ao banco, que é o mesmo nível de acesso de quem
// poderia editar o código.
import { pool } from '../config/db.js';
import { signToken } from '../middleware/auth.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('uso: npm run auth:token -- <email>');
  process.exit(1);
}

const { rows } = await pool.query(
  'SELECT * FROM users WHERE lower(email) = $1 AND active = true ORDER BY created_at LIMIT 1',
  [email],
);
if (!rows[0]) {
  console.error(`nenhum usuário ativo com o e-mail ${email}`);
  process.exit(1);
}

console.log(`\n  Token para ${rows[0].email} (${rows[0].role}):\n`);
console.log(`  ${signToken(rows[0])}\n`);
console.log('  No navegador, em localStorage, grave-o na chave "token" e recarregue.\n');

await pool.end();
