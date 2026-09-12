// Ponto único de hash, conferência e política de senha. Antes disto o custo do bcrypt
// estava repetido em quatro arquivos e a regra de tamanho mínimo existia só no script de
// linha de comando — POST /users aceitava senha de um caractere.
import bcrypt from 'bcryptjs';
import { env } from './env.js';

export const hashSenha = (senha) => bcrypt.hash(senha, env.bcryptCost);

export const conferirSenha = (senha, hash) => bcrypt.compare(senha, hash);

// Hash de uma senha que ninguém conhece. O login o usa quando o e-mail não existe, para
// gastar o mesmo tempo de CPU de um e-mail válido: sem isso a diferença no tempo de
// resposta revela quais e-mails estão cadastrados.
export const HASH_FALSO = bcrypt.hashSync('nao-confere-com-nada-$%&', env.bcryptCost);

const MINIMO = 10;

const OBVIAS = new Set([
  'senha', 'senha123', 'senha1234', 'password', 'password1', 'password123',
  '1234567890', '123456789', '12345678', 'qwertyuiop', 'clinicapp',
  'mudar123', 'admin123', 'clinica123',
]);

// Devolve a mensagem de erro, ou null se a senha passa.
export function validarPolitica(senha, { email } = {}) {
  if (typeof senha !== 'string' || senha.length < MINIMO) {
    return `A senha precisa ter pelo menos ${MINIMO} caracteres.`;
  }
  if (/^\d+$/.test(senha)) return 'A senha não pode ser só números.';
  if (OBVIAS.has(senha.toLowerCase())) return 'Essa senha é fácil demais de adivinhar.';

  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && senha.toLowerCase().includes(local)) {
    return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}
