import pg from 'pg';
import { env } from './env.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

// Helper: query direta.
export const query = (text, params) => pool.query(text, params);

pool.on('error', (err) => {
  console.error('[db] erro inesperado no pool', err);
});
