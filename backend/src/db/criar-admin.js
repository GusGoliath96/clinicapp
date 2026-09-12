// Cria (ou reseta) um usuário, com senha aleatória impressa uma única vez.
// É o caminho oficial para abrir o primeiro acesso enquanto não existe tela de cadastro.
//
//   npm run auth:admin -- <email> [nome] [papel]
//
// A senha só aparece aqui, nunca vai para arquivo nem para o banco em claro. Se perder,
// rode de novo: o comando é idempotente e gera outra.
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { hashSenha } from '../config/senha.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PAPEIS = ['admin', 'recepcao', 'medico'];

const [emailArg, nome = 'Administrador', papel = 'admin'] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();

if (!email || !email.includes('@')) {
  console.error('uso: npm run auth:admin -- <email> [nome] [papel]');
  process.exit(1);
}
if (!PAPEIS.includes(papel)) {
  console.error(`papel inválido: ${papel} (use ${PAPEIS.join(', ')})`);
  process.exit(1);
}

// Sem 0/O/1/l/I: a senha vai ser lida de um terminal e digitada à mão pelo menos uma vez.
const ALFABETO = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const senha = Array.from(
  crypto.randomFillSync(new Uint32Array(18)),
  (v) => ALFABETO[v % ALFABETO.length],
).join('');

const hash = await hashSenha(senha);

// token_version sobe junto: se a conta estava comprometida, resetar a senha aqui precisa
// derrubar as sessões que já existiam.
const { rows } = await pool.query(
  `INSERT INTO users (tenant_id, nome, email, senha_hash, papel)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (tenant_id, email) DO UPDATE
     SET senha_hash = EXCLUDED.senha_hash,
         papel = EXCLUDED.papel,
         ativo = true,
         senha_alterada_em = now(),
         token_version = users.token_version + 1,
         updated_at = now()
   RETURNING id, (xmax = 0) AS criado`,
  [TENANT_ID, nome, email, hash, papel],
);

await pool.query('UPDATE trusted_devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].id]);

console.log(`\n  ${rows[0].criado ? 'Usuário criado' : 'Senha redefinida'}: ${email}  (${papel})`);
console.log(`  Senha: ${senha}`);
console.log('\n  Anote agora — ela não será mostrada de novo.\n');

await pool.end();
