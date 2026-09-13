// Troca a senha de um usuário direto no banco.
//
//   npm run db:senha -- admin@exemplo.com 'senha-forte-aqui'
//
// A senha aparece no histórico do shell — prefira `npm run auth:admin -- <email>`, que
// gera uma aleatória. Este script existe para quando você quer escolher a senha.
import { pool } from '../config/db.js';
import { hashPassword, validatePolicy } from '../config/password.js';

const [emailArg, password] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();

if (!email || !password) {
  console.error("uso: npm run db:senha -- <email> '<nova-senha>'");
  process.exit(1);
}

const weak = validatePolicy(password, { email });
if (weak) {
  console.error(weak);
  process.exit(1);
}

// token_version sobe para derrubar as sessões abertas, e os dispositivos lembrados são
// revogados: trocar a senha sem isso deixaria um invasor dentro por mais 7 dias.
const { rows } = await pool.query(
  `UPDATE users SET password_hash = $2, password_changed_at = now(),
          token_version = token_version + 1, updated_at = now()
    WHERE lower(email) = $1
    RETURNING id`,
  [email, await hashPassword(password)],
);

if (rows.length === 0) {
  console.error(`nenhum usuário com o e-mail ${email}`);
  process.exit(1);
}

await pool.query(
  'UPDATE trusted_devices SET revoked_at = now() WHERE user_id = ANY($1) AND revoked_at IS NULL',
  [rows.map((r) => r.id)],
);

console.log(`senha atualizada para ${email} — as sessões abertas foram encerradas`);
await pool.end();
