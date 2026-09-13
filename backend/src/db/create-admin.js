// Cria (ou reseta) um usuário, com senha aleatória impressa uma única vez.
// É o caminho oficial para abrir o primeiro acesso enquanto não existe tela de cadastro.
//
//   npm run auth:admin -- <email> [nome] [papel]
//
// A senha só aparece aqui, nunca vai para arquivo nem para o banco em claro. Se perder,
// rode de novo: o comando é idempotente e gera outra.
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { hashPassword } from '../config/password.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ROLES = ['admin', 'recepcao', 'medico'];

const [emailArg, name = 'Administrador', role = 'admin'] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('uso: npm run auth:admin -- <email> [nome] [papel]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`papel inválido: ${role} (use ${ROLES.join(', ')})`);
  process.exit(1);
}

// Sem 0/O/1/l/I: a senha vai ser lida de um terminal e digitada à mão pelo menos uma vez.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const password = Array.from(
  crypto.randomFillSync(new Uint32Array(18)),
  (v) => ALPHABET[v % ALPHABET.length],
).join('');

const hash = await hashPassword(password);

// token_version sobe junto: se a conta estava comprometida, resetar a senha aqui precisa
// derrubar as sessões que já existiam.
const { rows } = await pool.query(
  `INSERT INTO users (tenant_id, name, email, password_hash, role)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (tenant_id, email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         active = true,
         password_changed_at = now(),
         token_version = users.token_version + 1,
         updated_at = now()
   RETURNING id, (xmax = 0) AS created`,
  [TENANT_ID, name, email, hash, role],
);

await pool.query(
  'UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
  [rows[0].id],
);

console.log(`\n  ${rows[0].created ? 'Usuário criado' : 'Senha redefinida'}: ${email}  (${role})`);
console.log(`  Senha: ${password}`);
console.log('\n  Anote agora — ela não será mostrada de novo.\n');

await pool.end();
