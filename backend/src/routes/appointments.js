import { Router } from 'express';
import { query } from '../config/db.js';
import { emitToTenant } from '../realtime/socket.js';

const router = Router();

// Verifica se o intervalo [inicio, fim) colide com outra consulta do mesmo profissional
// (ignorando canceladas/faltas e o próprio agendamento) ou com um bloqueio que o atinja.
// Retorna null se estiver livre, ou { tipo, ... } descrevendo o conflito.
async function temConflito(tenantId, professionalId, inicio, fim, excludeId = null) {
  const params = [tenantId, professionalId, fim, inicio];
  let sql = `SELECT a.id, a.inicio, a.fim, p.nome AS paciente_nome
    FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = $1 AND a.professional_id = $2
      AND a.status NOT IN ('cancelado', 'falta')
      AND a.inicio < $3 AND a.fim > $4`;
  if (excludeId) { params.push(excludeId); sql += ` AND a.id <> $${params.length}`; }
  const ag = await query(sql + ' LIMIT 1', params);
  if (ag.rows[0]) return { tipo: 'agendamento', ...ag.rows[0] };

  const bl = await query(
    `SELECT id, motivo, descricao FROM blocks
     WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
       AND inicio < $3 AND fim > $4 LIMIT 1`,
    [tenantId, professionalId, fim, inicio],
  );
  if (bl.rows[0]) return { tipo: 'bloqueio', ...bl.rows[0] };
  return null;
}

// GET /appointments?de=&ate=&professionalId=&patientId=  → feed das visões dia/semana/mês
// e histórico do Card de Vida (patientId).
router.get('/', async (req, res) => {
  const { de, ate, professionalId, patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `
    SELECT a.*, p.nome AS paciente_nome, p.tags AS paciente_tags,
           pr.nome AS profissional_nome, pr.cor AS profissional_cor,
           (a.patient_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM appointments a2
              WHERE a2.tenant_id = a.tenant_id AND a2.patient_id = a.patient_id
                AND a2.status = 'realizado' AND a2.inicio < a.inicio
           )) AS primeira_consulta,
           EXISTS (
              SELECT 1 FROM documents d
              WHERE d.tenant_id = a.tenant_id AND d.patient_id = a.patient_id
                AND d.status = 'pendente'
           ) AS doc_pendente
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.patient_id
    JOIN professionals pr ON pr.id = a.professional_id
    WHERE a.tenant_id = $1`;
  if (de) { params.push(de); sql += ` AND a.inicio >= $${params.length}`; }
  if (ate) { params.push(ate); sql += ` AND a.inicio < $${params.length}`; }
  if (professionalId) { params.push(professionalId); sql += ` AND a.professional_id = $${params.length}`; }
  if (patientId) { params.push(patientId); sql += ` AND a.patient_id = $${params.length}`; }
  sql += ' ORDER BY a.inicio';
  const { rows } = await query(sql, params);
  res.json(rows);
});

// Fuso da clínica (America/Sao_Paulo, sem horário de verão desde 2019).
const CLINIC_OFFSET = '-03:00';
const DIA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_DIAS = 31;

const hhmmToMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const minToHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const isoLocal = (dateStr, min) => `${dateStr}T${minToHHMM(min)}:00${CLINIC_OFFSET}`;

// Compara nome de dia sem depender de acento: a interface grava 'Sáb' e havia código
// comparando com 'Sab' — sábado nunca casava e o profissional ficava sem horário no dia.
const normDia = (d) => String(d).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const janelaDoDia = (inicio, fim, almoco) => {
  let almIni = -1, almFim = -1;
  if (typeof almoco === 'string' && almoco.includes('-')) {
    const [a, b] = almoco.split('-');
    almIni = hhmmToMin(a); almFim = hhmmToMin(b);
  }
  return { ini: hhmmToMin(inicio), fim: hhmmToMin(fim), almIni, almFim };
};

// Expediente do profissional num dia da semana. Existem DOIS formatos de agenda no banco:
//   novo  (o que o ProfessionalForm grava): { horarios: { Seg: { ativo, inicio, fim, almoco } } }
//         — permite horário diferente por dia;
//   antigo (seed/legado):                  { dias: ['Seg',…], inicio, fim, almoco }
//         — mesmo horário todo dia.
// Entender só o antigo fazia todo profissional criado ou editado pela interface devolver
// `slots: []` — sem erro nenhum, o bot só dizia "não tem horário". Devolve null se não atende.
function expedienteDoDia(ag, dia) {
  const alvo = normDia(dia);
  if (ag?.horarios) {
    const entrada = Object.entries(ag.horarios).find(([d]) => normDia(d) === alvo)?.[1];
    if (!entrada?.ativo || !entrada.inicio || !entrada.fim) return null;
    return janelaDoDia(entrada.inicio, entrada.fim, entrada.almoco);
  }
  if (ag?.dias?.length && ag.inicio && ag.fim) {
    if (!ag.dias.some((d) => normDia(d) === alvo)) return null;
    return janelaDoDia(ag.inicio, ag.fim, ag.almoco);
  }
  return null;
}

// GET /appointments/disponibilidade?professionalId=&de=&ate=&tipo=consulta|retorno
// Devolve os horários LIVRES do profissional no intervalo [de, ate] (datas YYYY-MM-DD),
// respeitando a agenda dele (dias de atendimento, expediente, almoço), a duração da consulta
// e os conflitos (outras consultas + bloqueios). É o que o bot usa para marcar 1ª consulta.
router.get('/disponibilidade', async (req, res) => {
  const { professionalId, de, ate, tipo } = req.query;
  if (!professionalId || !de || !ate) {
    return res.status(400).json({ error: 'professionalId, de e ate (YYYY-MM-DD) são obrigatórios' });
  }
  const dDe = String(de).slice(0, 10);
  const dAte = String(ate).slice(0, 10);

  const prof = await query(
    'SELECT agenda FROM professionals WHERE id = $1 AND tenant_id = $2 AND ativo = true',
    [professionalId, req.user.tenantId],
  );
  if (!prof.rows[0]) return res.status(404).json({ error: 'Profissional não encontrado' });
  const ag = prof.rows[0].agenda || {};
  const temAgenda = !!ag.horarios || (ag.dias?.length && ag.inicio && ag.fim);
  if (!temAgenda) {
    return res.json({ professionalId, slots: [] }); // agenda não configurada
  }

  const dur = (tipo === 'retorno' ? ag.duracaoRetorno : ag.duracaoConsulta) || 30;

  // Carrega ocupações do período de uma vez (consultas ativas + bloqueios).
  const rangeIni = isoLocal(dDe, 0);
  const rangeFim = isoLocal(dAte, 24 * 60);
  const ocup = await query(
    `SELECT inicio, fim FROM appointments
       WHERE tenant_id = $1 AND professional_id = $2 AND status NOT IN ('cancelado', 'falta')
         AND inicio < $4 AND fim > $3
     UNION ALL
     SELECT inicio, fim FROM blocks
       WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
         AND inicio < $4 AND fim > $3`,
    [req.user.tenantId, professionalId, rangeIni, rangeFim],
  );
  const ocupacoes = ocup.rows.map((r) => [new Date(r.inicio).getTime(), new Date(r.fim).getTime()]);
  const livre = (ini, fim) => !ocupacoes.some(([oi, of]) => oi < fim && of > ini);

  const slots = [];
  // Itera dia a dia usando meio-dia UTC (independe do fuso do servidor p/ achar o dia da semana).
  let cursor = new Date(`${dDe}T12:00:00Z`);
  const limite = new Date(`${dAte}T12:00:00Z`);
  for (let i = 0; i <= MAX_DIAS && cursor <= limite; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const exp = expedienteDoDia(ag, DIA_SEMANA[cursor.getUTCDay()]);
    if (exp) {
      for (let t = exp.ini; t + dur <= exp.fim; t += dur) {
        const dentroAlmoco = exp.almIni >= 0 && t < exp.almFim && t + dur > exp.almIni;
        if (dentroAlmoco) continue;
        const iniIso = isoLocal(dateStr, t);
        const fimIso = isoLocal(dateStr, t + dur);
        const iniMs = new Date(iniIso).getTime();
        const fimMs = new Date(fimIso).getTime();
        if (livre(iniMs, fimMs)) slots.push({ inicio: iniIso, fim: fimIso });
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  res.json({ professionalId, duracao: dur, slots });
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, tipo, convenio, inicio, fim, origem } = req.body || {};
  if (!professional_id || !inicio || !fim) {
    return res.status(400).json({ error: 'professional_id, inicio e fim são obrigatórios' });
  }
  const conflito = await temConflito(req.user.tenantId, professional_id, inicio, fim);
  if (conflito) return res.status(409).json({ error: mensagemConflito(conflito), conflito });

  const { rows } = await query(
    `INSERT INTO appointments (tenant_id, patient_id, professional_id, tipo, convenio, inicio, fim, origem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'Recepção'))
     RETURNING *`,
    [req.user.tenantId, patient_id, professional_id, tipo, convenio, inicio, fim, origem],
  );
  emitToTenant(req.user.tenantId, 'appointment:update', rows[0]);
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { inicio, fim, status, tipo, convenio, professional_id } = req.body || {};

  // Só checa conflito quando muda horário/profissional (não em mudança de status simples).
  if (inicio || fim || professional_id) {
    const atual = await query(
      'SELECT * FROM appointments WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.user.tenantId],
    );
    if (!atual.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    const a = atual.rows[0];
    const conflito = await temConflito(
      req.user.tenantId,
      professional_id || a.professional_id,
      inicio || a.inicio,
      fim || a.fim,
      a.id,
    );
    if (conflito) return res.status(409).json({ error: mensagemConflito(conflito), conflito });
  }

  const { rows } = await query(
    `UPDATE appointments SET
       inicio = COALESCE($3, inicio),
       fim = COALESCE($4, fim),
       status = COALESCE($5, status),
       tipo = COALESCE($6, tipo),
       convenio = COALESCE($7, convenio),
       professional_id = COALESCE($8, professional_id),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING *`,
    [req.params.id, req.user.tenantId, inicio, fim, status, tipo, convenio, professional_id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  emitToTenant(req.user.tenantId, 'appointment:update', rows[0]);
  res.json(rows[0]);
});

router.post('/:id/check-in', async (req, res) => {
  const { rows } = await query(
    `UPDATE appointments SET check_in_em = now(), status = 'confirmado', updated_at = now()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  emitToTenant(req.user.tenantId, 'appointment:update', rows[0]);
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM appointments WHERE id = $1 AND tenant_id = $2', [
    req.params.id, req.user.tenantId,
  ]);
  res.status(204).end();
});

function mensagemConflito(c) {
  if (c.tipo === 'bloqueio') {
    return `Horário bloqueado (${c.motivo || 'indisponível'}).`;
  }
  return `Horário já ocupado por ${c.paciente_nome || 'outra consulta'}.`;
}

export default router;
