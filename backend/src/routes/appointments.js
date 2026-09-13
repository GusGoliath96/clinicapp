import { Router } from 'express';
import { query } from '../config/db.js';
import { emitToTenant } from '../realtime/socket.js';

// O payload segue em português: além do frontend, o motor de IA consulta disponibilidade e
// marca consulta por aqui. As chaves do JSON de agenda também ficam em português, por serem
// conteúdo da coluna schedule.

const router = Router();

const fields = (p = '') => `${p}id, ${p}tenant_id, ${p}patient_id, ${p}professional_id,
  ${p}unit_id AS unidade_id, ${p}kind AS tipo, ${p}insurance_plan AS convenio,
  ${p}starts_at AS inicio, ${p}ends_at AS fim, ${p}status, ${p}source AS origem,
  ${p}checked_in_at AS check_in_em, ${p}reminder_sent_at AS lembrete_enviado_em,
  ${p}created_at, ${p}updated_at`;

// Verifica se o intervalo [inicio, fim) colide com outra consulta do mesmo profissional
// (ignorando canceladas/faltas e o próprio agendamento) ou com um bloqueio que o atinja.
// Retorna null se estiver livre, ou { tipo, ... } descrevendo o conflito.
async function findConflict(tenantId, professionalId, startsAt, endsAt, excludeId = null) {
  const params = [tenantId, professionalId, endsAt, startsAt];
  let sql = `SELECT a.id, a.starts_at AS inicio, a.ends_at AS fim, p.name AS paciente_nome
    FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = $1 AND a.professional_id = $2
      AND a.status NOT IN ('cancelado', 'falta')
      AND a.starts_at < $3 AND a.ends_at > $4`;
  if (excludeId) { params.push(excludeId); sql += ` AND a.id <> $${params.length}`; }
  const appointment = await query(sql + ' LIMIT 1', params);
  if (appointment.rows[0]) return { tipo: 'agendamento', ...appointment.rows[0] };

  const block = await query(
    `SELECT id, reason AS motivo, description AS descricao FROM blocks
     WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
       AND starts_at < $3 AND ends_at > $4 LIMIT 1`,
    [tenantId, professionalId, endsAt, startsAt],
  );
  if (block.rows[0]) return { tipo: 'bloqueio', ...block.rows[0] };
  return null;
}

// GET /appointments?de=&ate=&professionalId=&patientId=  → feed das visões dia/semana/mês
// e histórico do Card de Vida (patientId).
router.get('/', async (req, res) => {
  const { de, ate, professionalId, patientId } = req.query;
  const params = [req.user.tenantId];
  let sql = `
    SELECT ${fields('a.')}, p.name AS paciente_nome, p.tags AS paciente_tags,
           pr.name AS profissional_nome, pr.color AS profissional_cor,
           (a.patient_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM appointments a2
              WHERE a2.tenant_id = a.tenant_id AND a2.patient_id = a.patient_id
                AND a2.status = 'realizado' AND a2.starts_at < a.starts_at
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
  if (de) { params.push(de); sql += ` AND a.starts_at >= $${params.length}`; }
  if (ate) { params.push(ate); sql += ` AND a.starts_at < $${params.length}`; }
  if (professionalId) { params.push(professionalId); sql += ` AND a.professional_id = $${params.length}`; }
  if (patientId) { params.push(patientId); sql += ` AND a.patient_id = $${params.length}`; }
  sql += ' ORDER BY a.starts_at';
  const { rows } = await query(sql, params);
  res.json(rows);
});

// Fuso da clínica (America/Sao_Paulo, sem horário de verão desde 2019).
const CLINIC_OFFSET = '-03:00';
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_DAYS = 31;

const hhmmToMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const minToHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const isoLocal = (dateStr, min) => `${dateStr}T${minToHHMM(min)}:00${CLINIC_OFFSET}`;

// Compara nome de dia sem depender de acento: a interface grava 'Sáb' e havia código
// comparando com 'Sab' — sábado nunca casava e o profissional ficava sem horário no dia.
const normalizeDay = (d) => String(d).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const dayWindow = (start, end, lunch) => {
  let lunchStart = -1, lunchEnd = -1;
  if (typeof lunch === 'string' && lunch.includes('-')) {
    const [a, b] = lunch.split('-');
    lunchStart = hhmmToMin(a); lunchEnd = hhmmToMin(b);
  }
  return { start: hhmmToMin(start), end: hhmmToMin(end), lunchStart, lunchEnd };
};

// Expediente do profissional num dia da semana. Existem DOIS formatos de agenda no banco:
//   novo  (o que o ProfessionalForm grava): { horarios: { Seg: { ativo, inicio, fim, almoco } } }
//         — permite horário diferente por dia;
//   antigo (seed/legado):                  { dias: ['Seg',…], inicio, fim, almoco }
//         — mesmo horário todo dia.
// Entender só o antigo fazia todo profissional criado ou editado pela interface devolver
// `slots: []` — sem erro nenhum, o bot só dizia "não tem horário". Devolve null se não atende.
function dayShift(schedule, weekday) {
  const target = normalizeDay(weekday);
  if (schedule?.horarios) {
    const entry = Object.entries(schedule.horarios).find(([d]) => normalizeDay(d) === target)?.[1];
    if (!entry?.ativo || !entry.inicio || !entry.fim) return null;
    return dayWindow(entry.inicio, entry.fim, entry.almoco);
  }
  if (schedule?.dias?.length && schedule.inicio && schedule.fim) {
    if (!schedule.dias.some((d) => normalizeDay(d) === target)) return null;
    return dayWindow(schedule.inicio, schedule.fim, schedule.almoco);
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
  const fromDate = String(de).slice(0, 10);
  const toDate = String(ate).slice(0, 10);

  const professional = await query(
    'SELECT schedule FROM professionals WHERE id = $1 AND tenant_id = $2 AND active = true',
    [professionalId, req.user.tenantId],
  );
  if (!professional.rows[0]) return res.status(404).json({ error: 'Profissional não encontrado' });

  const schedule = professional.rows[0].schedule || {};
  const hasSchedule = !!schedule.horarios || (schedule.dias?.length && schedule.inicio && schedule.fim);
  if (!hasSchedule) {
    return res.json({ professionalId, slots: [] }); // agenda não configurada
  }

  const duration = (tipo === 'retorno' ? schedule.duracaoRetorno : schedule.duracaoConsulta) || 30;

  // Carrega ocupações do período de uma vez (consultas ativas + bloqueios).
  const rangeStart = isoLocal(fromDate, 0);
  const rangeEnd = isoLocal(toDate, 24 * 60);
  const busy = await query(
    `SELECT starts_at, ends_at FROM appointments
       WHERE tenant_id = $1 AND professional_id = $2 AND status NOT IN ('cancelado', 'falta')
         AND starts_at < $4 AND ends_at > $3
     UNION ALL
     SELECT starts_at, ends_at FROM blocks
       WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
         AND starts_at < $4 AND ends_at > $3`,
    [req.user.tenantId, professionalId, rangeStart, rangeEnd],
  );
  const busyRanges = busy.rows.map((r) => [new Date(r.starts_at).getTime(), new Date(r.ends_at).getTime()]);
  const isFree = (start, end) => !busyRanges.some(([bs, be]) => bs < end && be > start);

  const slots = [];
  // Itera dia a dia usando meio-dia UTC (independe do fuso do servidor p/ achar o dia da semana).
  let cursor = new Date(`${fromDate}T12:00:00Z`);
  const limit = new Date(`${toDate}T12:00:00Z`);
  for (let i = 0; i <= MAX_DAYS && cursor <= limit; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const shift = dayShift(schedule, WEEKDAYS[cursor.getUTCDay()]);
    if (shift) {
      for (let t = shift.start; t + duration <= shift.end; t += duration) {
        const overlapsLunch = shift.lunchStart >= 0 && t < shift.lunchEnd && t + duration > shift.lunchStart;
        if (overlapsLunch) continue;
        const startIso = isoLocal(dateStr, t);
        const endIso = isoLocal(dateStr, t + duration);
        if (isFree(new Date(startIso).getTime(), new Date(endIso).getTime())) {
          slots.push({ inicio: startIso, fim: endIso });
        }
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  res.json({ professionalId, duracao: duration, slots });
});

router.post('/', async (req, res) => {
  const { patient_id, professional_id, tipo: kind, convenio: insurancePlan,
          inicio: startsAt, fim: endsAt, origem: source } = req.body || {};
  if (!professional_id || !startsAt || !endsAt) {
    return res.status(400).json({ error: 'professional_id, inicio e fim são obrigatórios' });
  }
  const conflict = await findConflict(req.user.tenantId, professional_id, startsAt, endsAt);
  if (conflict) return res.status(409).json({ error: conflictMessage(conflict), conflito: conflict });

  const { rows } = await query(
    `INSERT INTO appointments (tenant_id, patient_id, professional_id, kind, insurance_plan,
       starts_at, ends_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'Recepção'))
     RETURNING ${fields()}`,
    [req.user.tenantId, patient_id, professional_id, kind, insurancePlan, startsAt, endsAt, source],
  );
  emitToTenant(req.user.tenantId, 'appointment:update', rows[0]);
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { inicio: startsAt, fim: endsAt, status, tipo: kind,
          convenio: insurancePlan, professional_id } = req.body || {};

  // Só checa conflito quando muda horário/profissional (não em mudança de status simples).
  if (startsAt || endsAt || professional_id) {
    const current = await query(
      `SELECT ${fields()} FROM appointments WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId],
    );
    if (!current.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    const a = current.rows[0];
    const conflict = await findConflict(
      req.user.tenantId,
      professional_id || a.professional_id,
      startsAt || a.inicio,
      endsAt || a.fim,
      a.id,
    );
    if (conflict) return res.status(409).json({ error: conflictMessage(conflict), conflito: conflict });
  }

  const { rows } = await query(
    `UPDATE appointments SET
       starts_at = COALESCE($3, starts_at),
       ends_at = COALESCE($4, ends_at),
       status = COALESCE($5, status),
       kind = COALESCE($6, kind),
       insurance_plan = COALESCE($7, insurance_plan),
       professional_id = COALESCE($8, professional_id),
       updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${fields()}`,
    [req.params.id, req.user.tenantId, startsAt, endsAt, status, kind, insurancePlan, professional_id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  emitToTenant(req.user.tenantId, 'appointment:update', rows[0]);
  res.json(rows[0]);
});

router.post('/:id/check-in', async (req, res) => {
  const { rows } = await query(
    `UPDATE appointments SET checked_in_at = now(), status = 'confirmado', updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING ${fields()}`,
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

function conflictMessage(c) {
  if (c.tipo === 'bloqueio') {
    return `Horário bloqueado (${c.motivo || 'indisponível'}).`;
  }
  return `Horário já ocupado por ${c.paciente_nome || 'outra consulta'}.`;
}

export default router;
