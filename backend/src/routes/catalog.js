import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Catálogos de referência (CID-10, medicamentos, exames) para autocomplete clínico.
// Conjunto inicial curado — desenhado para ser substituído/ampliado pelos arquivos
// oficiais completos (DATASUS / ANVISA / TUSS) sem mudar este contrato de API.
const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', 'data', f), 'utf8'));

// Remove acentos e caixa para busca tolerante.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// Sinônimos/abreviações que o médico costuma digitar (aplicados ao índice, não ao rótulo).
const SINONIMOS = [
  [/ultrassonografia/, 'ultrassom usg us'],
  [/ressonancia magnetica/, 'rm rnm'],
  [/tomografia computadorizada/, 'tc tomo'],
  [/raio-x|raio x/, 'rx radiografia'],
  [/eletrocardiograma/, 'ecg'],
  [/ecocardiograma/, 'eco ecocardio'],
  [/colpocitologia|papanicolau/, 'preventivo papanicolau citologia'],
  [/densitometria/, 'dexa densito'],
];
const idx = (s) => s + SINONIMOS.reduce((acc, [re, extra]) => (re.test(s) ? `${acc} ${extra}` : acc), '');

const CIDS = load('cids.json').map((c) => ({
  label: `${c.codigo} — ${c.descricao}`, value: `${c.codigo} - ${c.descricao}`, _s: idx(norm(`${c.codigo} ${c.descricao}`)),
}));
const MEDS = load('medicamentos.json').map((n) => ({ label: n, value: n, _s: idx(norm(n)) }));
const EXAMES = load('exames.json').map((n) => ({ label: n, value: n, _s: idx(norm(n)) }));
const CAT = { cids: CIDS, medicamentos: MEDS, exames: EXAMES };

const router = Router();

router.get('/:tipo', (req, res) => {
  const base = CAT[req.params.tipo];
  if (!base) return res.status(404).json({ error: 'Catálogo inválido' });
  const consulta = norm(req.query.q);
  const termos = consulta.split(/\s+/).filter(Boolean);
  if (consulta.length < 2 || !termos.length) return res.json([]);
  const out = [];
  for (const it of base) {
    if (termos.every((t) => it._s.includes(t))) {
      out.push({ label: it.label, value: it.value });
      if (out.length >= 20) break;
    }
  }
  res.json(out);
});

export default router;
