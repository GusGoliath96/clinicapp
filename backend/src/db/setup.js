// Cria o schema e insere o seed de demonstração.
// Uso: npm run db:setup
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { hashSenha } from '../config/senha.js';

const here = dirname(fileURLToPath(import.meta.url));
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PROFISSIONAL_DEMO = '00000000-0000-0000-0000-0000000000a1';

async function run() {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  const seed = readFileSync(join(here, 'seed.sql'), 'utf8');

  console.log('[db:setup] aplicando schema...');
  await pool.query(schema);
  console.log('[db:setup] aplicando seed...');
  await pool.query(seed);

  // Os usuários vêm de SEED_ADMIN_EMAIL, não de um endereço fixo. A versão anterior
  // plantava admin@macs.com.br com a senha "123456" a cada execução — uma conta de admin
  // com senha pública, num domínio que ninguém controla. Com 2FA por e-mail isso seria
  // pior ainda: o código iria para uma caixa inalcançável.
  const adminEmail = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();

  if (!adminEmail) {
    console.log('[db:setup] SEED_ADMIN_EMAIL não definido — nenhum usuário criado.');
    console.log('[db:setup] abra o primeiro acesso com: npm run auth:admin -- <seu-email>');
  } else {
    // Senha do .env se houver; senão uma aleatória, mostrada só agora.
    const senha = process.env.SEED_ADMIN_SENHA || crypto.randomBytes(12).toString('base64url');
    const senhaHash = await hashSenha(senha);

    // O alias "+" do Gmail entrega na mesma caixa, então dá para exercitar o 2FA com dois
    // usuários distintos sem precisar de uma segunda conta de e-mail.
    const [local, dominio] = adminEmail.split('@');
    const medicoEmail = `${local}+medico@${dominio}`;

    await pool.query(
      `INSERT INTO users (tenant_id, nome, email, senha_hash, papel)
       VALUES ($1, 'Administrador', $2, $3, 'admin')
       ON CONFLICT (tenant_id, email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash`,
      [TENANT_ID, adminEmail, senhaHash],
    );

    // Vinculado ao Dr. Marco Aurélio, para cair direto na agenda dele.
    await pool.query(
      `INSERT INTO users (tenant_id, nome, email, senha_hash, papel, professional_id)
       VALUES ($1, 'Dr. Marco Aurélio Silva', $2, $3, 'medico', $4)
       ON CONFLICT (tenant_id, email) DO UPDATE
         SET senha_hash = EXCLUDED.senha_hash, professional_id = EXCLUDED.professional_id`,
      [TENANT_ID, medicoEmail, senhaHash, PROFISSIONAL_DEMO],
    );

    console.log(`[db:setup] usuários: ${adminEmail} (admin) · ${medicoEmail} (medico)`);
    if (!process.env.SEED_ADMIN_SENHA) console.log(`[db:setup] senha gerada: ${senha}`);
  }

  console.log('[db:setup] concluído.');
  await pool.end();
}

run().catch((err) => {
  console.error('[db:setup] falhou:', err.message);
  process.exit(1);
});
