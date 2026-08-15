// Cria o schema e insere o seed de demonstração.
// Uso: npm run db:setup
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function run() {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  const seed = readFileSync(join(here, 'seed.sql'), 'utf8');

  console.log('[db:setup] aplicando schema...');
  await pool.query(schema);
  console.log('[db:setup] aplicando seed...');
  await pool.query(seed);

  // Usuário admin (hash gerado em runtime).
  const senhaHash = await bcrypt.hash('123456', 10);
  await pool.query(
    `INSERT INTO users (tenant_id, nome, email, senha_hash, papel)
     VALUES ($1, 'Admin MACS', 'admin@macs.com.br', $2, 'admin')
     ON CONFLICT (tenant_id, email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash`,
    [TENANT_ID, senhaHash],
  );

  // Usuário-médico de demonstração, vinculado ao Dr. Marco Aurélio (cai direto na fila dele).
  await pool.query(
    `INSERT INTO users (tenant_id, nome, email, senha_hash, papel, professional_id)
     VALUES ($1, 'Dr. Marco Aurélio Silva', 'marco@macs.com.br', $2, 'medico', '00000000-0000-0000-0000-0000000000a1')
     ON CONFLICT (tenant_id, email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, professional_id = EXCLUDED.professional_id`,
    [TENANT_ID, senhaHash],
  );

  console.log('[db:setup] concluído. Logins demo: admin@macs.com.br · marco@macs.com.br (senha 123456)');
  await pool.end();
}

run().catch((err) => {
  console.error('[db:setup] falhou:', err.message);
  process.exit(1);
});
