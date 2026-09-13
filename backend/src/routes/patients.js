import { Router } from 'express';
import { query } from '../config/db.js';

// O payload segue em português: além do frontend, o motor de IA busca paciente por aqui.
// Os alias mantêm esse contrato sobre as colunas em inglês.

const router = Router();

// Serializa valores destinados a colunas jsonb. O node-pg formata arrays JS como
// array literal do Postgres ({a,b}), inválido para jsonb — então mandamos JSON explícito.
const j = (v) => (v == null ? null : JSON.stringify(v));

const FIELDS = `id, tenant_id, name AS nome, social_name AS nome_social, phone AS telefone,
  cpf, rg, birth_date AS nascimento, gender AS sexo, email,
  insurance_plan AS convenio, insurance_details AS convenio_detalhe,
  address AS endereco, emergency_contact AS contato_emergencia, health AS saude,
  allergies AS alergias, comorbidities AS comorbidades, medications AS medicacoes,
  tags, source AS origem, lgpd_consent AS consentimento_lgpd,
  lgpd_consent_at AS consentimento_em, created_at, updated_at`;

router.get('/', async (req, res) => {
  const { telefone, q } = req.query;
  const params = [req.user.tenantId];
  let sql = `SELECT ${FIELDS} FROM patients WHERE tenant_id = $1`;
  if (telefone) {
    params.push(telefone);
    sql += ` AND phone = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND name ILIKE $${params.length}`;
  }
  sql += ' ORDER BY name LIMIT 100';
  const { rows } = await query(sql, params);
  res.json(rows);
});

// Timeline unificada: consultas + mensagens + exames + documentos + prontuário,
// em ordem cronológica. "Puxa tudo que está ligado ao paciente" sem duplicar tabela.
router.get('/:id/timeline', async (req, res) => {
  const { rows } = await query(
    `
    SELECT 'consulta' AS tipo, ('Consulta · ' || COALESCE(kind, '')) AS titulo,
           status AS descricao, starts_at::timestamptz AS data
      FROM appointments WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'mensagem',
           CASE WHEN m.direction = 'in' THEN 'Mensagem recebida' ELSE 'Mensagem enviada' END,
           LEFT(COALESCE(m.body, '[mídia]'), 120), m.created_at::timestamptz
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.tenant_id = $1 AND c.patient_id = $2
    UNION ALL
    SELECT 'exame', ('Exame · ' || name), status,
           COALESCE(resulted_on, requested_on, created_at::date)::timestamptz
      FROM exams WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'documento', ('Documento · ' || name), status,
           COALESCE(date, created_at::date)::timestamptz
      FROM documents WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'prontuario', ('Prontuário · ' || kind), LEFT(COALESCE(content, ''), 120),
           noted_at::timestamptz
      FROM clinical_notes WHERE tenant_id = $1 AND patient_id = $2
    ORDER BY data DESC
    `,
    [req.user.tenantId, req.params.id],
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT ${FIELDS} FROM patients WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.user.tenantId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.nome) return res.status(400).json({ error: 'nome é obrigatório' });
  try {
    const { rows } = await query(
      `INSERT INTO patients
         (tenant_id, name, social_name, phone, cpf, rg, birth_date, gender, email,
          insurance_plan, insurance_details, address, emergency_contact, health,
          allergies, comorbidities, medications, tags, source, lgpd_consent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11::jsonb,'{}'), COALESCE($12::jsonb,'{}'), COALESCE($13::jsonb,'{}'), COALESCE($14::jsonb,'{}'),
               COALESCE($15::jsonb,'[]'), COALESCE($16::jsonb,'[]'), COALESCE($17::jsonb,'[]'), COALESCE($18::jsonb,'[]'), $19,
               COALESCE($20, false))
       RETURNING ${FIELDS}`,
      [req.user.tenantId, b.nome, b.nome_social, b.telefone, b.cpf, b.rg, b.nascimento, b.sexo, b.email,
       b.convenio, j(b.convenio_detalhe), j(b.endereco), j(b.contato_emergencia), j(b.saude),
       j(b.alergias), j(b.comorbidades), j(b.medicacoes), j(b.tags), b.origem, b.consentimento_lgpd],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[patients.post]', e.message);
    res.status(500).json({ error: 'Não foi possível cadastrar o paciente.' });
  }
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await query(
      `UPDATE patients SET
         name = COALESCE($3, name), social_name = COALESCE($4, social_name),
         phone = COALESCE($5, phone), cpf = COALESCE($6, cpf), rg = COALESCE($7, rg),
         birth_date = COALESCE($8, birth_date), gender = COALESCE($9, gender), email = COALESCE($10, email),
         insurance_plan = COALESCE($11, insurance_plan),
         insurance_details = COALESCE($12::jsonb, insurance_details),
         address = COALESCE($13::jsonb, address),
         emergency_contact = COALESCE($14::jsonb, emergency_contact),
         health = COALESCE($15::jsonb, health), allergies = COALESCE($16::jsonb, allergies),
         comorbidities = COALESCE($17::jsonb, comorbidities), medications = COALESCE($18::jsonb, medications),
         tags = COALESCE($19::jsonb, tags), source = COALESCE($20, source),
         lgpd_consent = COALESCE($21, lgpd_consent),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING ${FIELDS}`,
      [req.params.id, req.user.tenantId, b.nome, b.nome_social, b.telefone, b.cpf, b.rg,
       b.nascimento, b.sexo, b.email, b.convenio, j(b.convenio_detalhe), j(b.endereco), j(b.contato_emergencia),
       j(b.saude), j(b.alergias), j(b.comorbidades), j(b.medicacoes), j(b.tags), b.origem, b.consentimento_lgpd],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[patients.put]', e.message);
    res.status(500).json({ error: 'Não foi possível salvar as alterações.' });
  }
});

export default router;
