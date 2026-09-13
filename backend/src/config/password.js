// Ponto único de hash, conferência e política de senha. Antes disto o custo do bcrypt
// estava repetido em quatro arquivos e a regra de tamanho mínimo existia só no script de
// linha de comando — POST /users aceitava senha de um caractere.
import bcrypt from 'bcryptjs';
import { env } from './env.js';

export const hashPassword = (password) => bcrypt.hash(password, env.bcryptCost);

export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

// Hash de uma senha que ninguém conhece. O login o usa quando o e-mail não existe, para
// gastar o mesmo tempo de CPU de um e-mail válido: sem isso a diferença no tempo de
// resposta revela quais e-mails estão cadastrados.
export const DUMMY_HASH = bcrypt.hashSync('nao-confere-com-nada-$%&', env.bcryptCost);

const MIN_LENGTH = 10;

const COMMON = new Set([
  'senha', 'senha123', 'senha1234', 'password', 'password1', 'password123',
  '1234567890', '123456789', '12345678', 'qwertyuiop', 'clinicapp',
  'mudar123', 'admin123', 'clinica123',
]);

// Devolve a mensagem de erro (em português, vai direto para a tela), ou null se passa.
export function validatePolicy(password, { email } = {}) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`;
  }
  if (/^\d+$/.test(password)) return 'A senha não pode ser só números.';
  if (COMMON.has(password.toLowerCase())) return 'Essa senha é fácil demais de adivinhar.';

  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}
