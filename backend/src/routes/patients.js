import { Router } from 'express';
import { query } from '../config/db.js';

const router = Router();

// Serializa valores destinados a colunas jsonb. O node-pg formata arrays JS como
// array literal do Postgres ({a,b}), inválido para jsonb — então mandamos JSON explícito.
const j = (v) => (v == null ? null : JSON.stringify(v));

router.get('/', async (req, res) => {
  const { telefone, q } = req.query;
  const params = [req.user.tenantId];
  let sql = 'SELECT * FROM patients WHERE tenant_id = $1';
  if (telefone) {
    params.push(telefone);
    sql += ` AND telefone = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND nome ILIKE $${params.length}`;
  }
  sql += ' ORDER BY nome LIMIT 100';
  const { rows } = await query(sql, params);
  res.json(rows);
});

// Timeline unificada: consultas + mensagens + exames + documentos + prontuário,
// em ordem cronológica. "Puxa tudo que está ligado ao paciente" sem duplicar tabela.
router.get('/:id/timeline', async (req, res) => {
  const { rows } = await query(
    `
    SELECT 'consulta' AS tipo, ('Consulta · ' || COALESCE(tipo, '')) AS titulo,
           status AS descricao, inicio::timestamptz AS data
      FROM appointments WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'mensagem',
           CASE WHEN m.direction = 'in' THEN 'Mensagem recebida' ELSE 'Mensagem enviada' END,
           LEFT(COALESCE(m.texto, '[mídia]'), 120), m.created_at::timestamptz
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.tenant_id = $1 AND c.patient_id = $2
    UNION ALL
    SELECT 'exame', ('Exame · ' || nome), status,
           COALESCE(data_resultado, data_solicitacao, created_at::date)::timestamptz
      FROM exams WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'documento', ('Documento · ' || nome), status,
           COALESCE(data, created_at::date)::timestamptz
      FROM documents WHERE tenant_id = $1 AND patient_id = $2
    UNION ALL
    SELECT 'prontuario', ('Prontuário · ' || tipo), LEFT(COALESCE(conteudo, ''), 120),
           data::timestamptz
      FROM clinical_notes WHERE tenant_id = $1 AND patient_id = $2
    ORDER BY data DESC
    `,
    [req.user.tenantId, req.params.id],
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM patients WHERE id = $1 AND tenant_id = $2',
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
         (tenant_id, nome, nome_social, telefone, cpf, rg, nascimento, sexo, email,
          convenio, convenio_detalhe, endereco, contato_emergencia, saude,
          alergias, comorbidades, medicacoes, tags, origem, consentimento_lgpd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               COALESCE($11::jsonb,'{}'), COALESCE($12::jsonb,'{}'), COALESCE($13::jsonb,'{}'), COALESCE($14::jsonb,'{}'),
               COALESCE($15::jsonb,'[]'), COALESCE($16::jsonb,'[]'), COALESCE($17::jsonb,'[]'), COALESCE($18::jsonb,'[]'), $19,
               COALESCE($20, false))
       RETURNING *`,
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
         nome = COALESCE($3, nome), nome_social = COALESCE($4, nome_social),
         telefone = COALESCE($5, telefone), cpf = COALESCE($6, cpf), rg = COALESCE($7, rg),
         nascimento = COALESCE($8, nascimento), sexo = COALESCE($9, sexo), email = COALESCE($10, email),
         convenio = COALESCE($11, convenio), convenio_detalhe = COALESCE($12::jsonb, convenio_detalhe),
         endereco = COALESCE($13::jsonb, endereco), contato_emergencia = COALESCE($14::jsonb, contato_emergencia),
         saude = COALESCE($15::jsonb, saude), alergias = COALESCE($16::jsonb, alergias),
         comorbidades = COALESCE($17::jsonb, comorbidades), medicacoes = COALESCE($18::jsonb, medicacoes),
         tags = COALESCE($19::jsonb, tags), origem = COALESCE($20, origem),
         consentimento_lgpd = COALESCE($21, consentimento_lgpd),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
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
