// Troca a senha de um usuário direto no banco. Existe porque o seed cria o admin com uma
// senha pública ("123456") e isso não pode sobreviver ao primeiro deploy exposto à internet.
//
//   npm run db:senha -- admin@macs.com.br 'nova-senha-forte'
//
// Se a senha vier vazia, o script recusa: senha em branco no bcrypt gera hash válido e o
// login passaria a aceitar string vazia.
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';

const [email, senha] = process.argv.slice(2);

if (!email || !senha) {
  console.error("uso: npm run db:senha -- <email> '<nova-senha>'");
  process.exit(1);
}
if (senha.length < 8) {
  console.error('a senha precisa ter pelo menos 8 caracteres');
  process.exit(1);
}

const hash = await bcrypt.hash(senha, 10);
const { rowCount } = await query('UPDATE users SET senha_hash = $2 WHERE email = $1', [email, hash]);

if (rowCount === 0) {
  console.error(`nenhum usuário com o e-mail ${email}`);
  process.exit(1);
}

console.log(`senha atualizada para ${email}`);
process.exit(0);
