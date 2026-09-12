-- ClinicaApp MVP-A — schema PostgreSQL
-- Multi-tenant-ready: tenant_id em todas as tabelas de negócio.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Núcleo ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',   -- fuso, horário de funcionamento
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL,
  senha_hash  TEXT NOT NULL,
  papel       TEXT NOT NULL DEFAULT 'recepcao',  -- admin | recepcao
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ─── Cadastros ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professionals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  conselho       TEXT,
  especialidade  TEXT,
  cor            TEXT DEFAULT '#2563eb',
  ativo          BOOLEAN NOT NULL DEFAULT true,
  -- { dias, inicio, fim, almoco, duracaoConsulta, duracaoRetorno }
  agenda         JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vínculo opcional do login com um profissional (médico cai direto na própria fila).
-- Depois de professionals existir, por causa da FK.
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS patients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome               TEXT NOT NULL,
  telefone           TEXT,                 -- E.164, casa com o WhatsApp
  cpf                TEXT,
  convenio           TEXT,
  tags               JSONB NOT NULL DEFAULT '[]',
  origem             TEXT,
  consentimento_lgpd BOOLEAN NOT NULL DEFAULT false,
  consentimento_em   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_tel ON patients (tenant_id, telefone);

-- ─── Recepção / Conversas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id            UUID REFERENCES patients(id) ON DELETE SET NULL,
  telefone              TEXT NOT NULL,
  nome_exibicao         TEXT,
  status                TEXT NOT NULL DEFAULT 'pendente',  -- pendente | humano | resolvida
  atendente_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  unread                INTEGER NOT NULL DEFAULT 0,
  last_inbound_at       TIMESTAMPTZ,        -- controla a janela de 24h do WhatsApp
  last_message_preview  TEXT,
  wa_conversation_id    TEXT,               -- id da conversa no motor de IA (ai_agent), p/ handoff/eventos
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, telefone)
);
-- Bancos já existentes: adiciona a coluna do id de conversa do motor.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS wa_conversation_id TEXT;

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,             -- in | out
  tipo            TEXT NOT NULL DEFAULT 'text', -- text | template | media
  texto           TEXT,
  media_url       TEXT,
  wa_message_id   TEXT,                       -- id na Gupshup, p/ reconciliar status
  status          TEXT NOT NULL DEFAULT 'enviado', -- enviado | entregue | lido | falhou
  enviado_por     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_waid ON messages (wa_message_id);

-- ─── Agenda ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
  professional_id     UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  unidade_id          UUID,
  tipo                TEXT,
  convenio            TEXT,
  inicio              TIMESTAMPTZ NOT NULL,
  fim                 TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'agendado',
  -- agendado | confirmado | em_atendimento | realizado | cancelado | falta
  origem              TEXT DEFAULT 'Recepção',   -- WhatsApp | Recepção | Telefone
  check_in_em         TIMESTAMPTZ,
  lembrete_enviado_em TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appt_periodo ON appointments (tenant_id, inicio, fim);

CREATE TABLE IF NOT EXISTS blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id UUID REFERENCES professionals(id) ON DELETE CASCADE, -- null = geral
  inicio          TIMESTAMPTZ NOT NULL,
  fim             TIMESTAMPTZ NOT NULL,
  motivo          TEXT,   -- ferias | congresso | manutencao | feriado | almoco | outro
  descricao       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── WhatsApp / Auditoria ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome_meta        TEXT NOT NULL,   -- elemento aprovado na Gupshup/Meta
  categoria        TEXT,
  corpo            TEXT,
  variaveis        JSONB NOT NULL DEFAULT '[]',
  status_aprovacao TEXT DEFAULT 'pendente',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  acao        TEXT NOT NULL,
  entidade    TEXT,
  entidade_id UUID,
  detalhe     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Card de Vida: paciente no centro ────────────────────────────────────────
-- Perfil estendido do paciente (espelha S.pacientes do protótipo). Colunas
-- adicionadas de forma idempotente sobre a tabela patients já existente.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nome_social        TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS rg                 TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nascimento         DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sexo               TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS email              TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS endereco           JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS contato_emergencia JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS saude              JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS alergias           JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS comorbidades       JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS medicacoes         JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS convenio_detalhe   JSONB NOT NULL DEFAULT '{}';

-- Documentos do paciente (RG, carteirinha, pedido médico...).
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tipo        TEXT,                              -- rg | carteirinha | pedido | outro
  nome        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente',  -- pendente | validado
  arquivo_url TEXT,
  data        DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_pac ON documents (tenant_id, patient_id);

-- Exames vinculados ao paciente.
CREATE TABLE IF NOT EXISTS exams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id   UUID REFERENCES professionals(id) ON DELETE SET NULL,  -- solicitante
  appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,
  nome              TEXT NOT NULL,
  tipo              TEXT,
  status            TEXT NOT NULL DEFAULT 'solicitado', -- solicitado | coletado | resultado_disponivel
  data_solicitacao  DATE,
  data_resultado    DATE,
  laudo             TEXT,
  arquivo_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exams_pac ON exams (tenant_id, patient_id);
-- Indicação clínica / hipótese diagnóstica (CID) que sai no pedido impresso.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS indicacao TEXT;

-- Tratamentos / pacotes do paciente.
CREATE TABLE IF NOT EXISTS treatments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id  UUID REFERENCES professionals(id) ON DELETE SET NULL,
  nome             TEXT NOT NULL,
  tipo             TEXT,                              -- pacote | plano | sessoes
  total_sessoes    INTEGER NOT NULL DEFAULT 0,
  sessoes_feitas   INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'ativo',     -- ativo | concluido | cancelado
  valor            NUMERIC(12,2),
  inicio           DATE,
  fim              DATE,
  obs              TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treatments_pac ON treatments (tenant_id, patient_id);

-- Prontuário longitudinal (anamnese, evolução, atestado, receita).
CREATE TABLE IF NOT EXISTS clinical_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id  UUID REFERENCES professionals(id) ON DELETE SET NULL,
  appointment_id   UUID REFERENCES appointments(id) ON DELETE SET NULL,
  tipo             TEXT NOT NULL DEFAULT 'evolucao',  -- anamnese | evolucao | atestado | receita
  conteudo         TEXT,
  data             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_pac ON clinical_notes (tenant_id, patient_id);
-- Conteúdo estruturado (ex.: itens da receita com dose/via/frequência). conteudo continua
-- guardando a versão em texto (para histórico/impressão/busca).
ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS dados JSONB;

-- Convênios da clínica (configuração).
CREATE TABLE IF NOT EXISTS convenios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL,
  codigo_ans       TEXT,
  prazo_pgto       INTEGER NOT NULL DEFAULT 0,   -- dias
  repasse_default  NUMERIC(5,2),                 -- % de repasse ao profissional
  ativo            BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_convenios_tenant ON convenios (tenant_id);

-- ─── Autenticação ───────────────────────────────────────────────────────────

-- Desafios efêmeros: código de 2FA e token de redefinição de senha. As duas coisas têm a
-- mesma forma (segredo com validade e uso único), então moram na mesma tabela.
-- O segredo nunca é gravado em claro; o id da linha entra no hash para que os 10^6 códigos
-- possíveis não possam ser quebrados de uma vez por uma tabela pré-calculada.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,                  -- 2fa | reset
  codigo_hash  TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  tentativas   INTEGER NOT NULL DEFAULT 0,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_user ON auth_challenges (user_id, tipo, created_at DESC);

-- Dispositivos que já passaram pelo 2FA e não precisam do código por 30 dias.
-- O segredo correspondente vai num cookie HttpOnly: se ficasse no localStorage junto do
-- JWT, um XSS desligaria o segundo fator de forma permanente.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  rotulo       TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_hash ON trusted_devices (token_hash);

-- Tentativas de login, para detectar força bruta. Tabela própria em vez de audit_log
-- porque aqui tenant_id e user_id precisam ser nulos: numa tentativa com e-mail que não
-- existe não há nem tenant nem usuário a registrar.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  ip          TEXT NOT NULL,
  sucesso     BOOLEAN NOT NULL DEFAULT false,
  motivo      TEXT,                            -- senha | usuario | inativo | 2fa | bloqueado
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts (ip, created_at DESC);

-- token_version invalida JWTs já emitidos (troca de senha, desativação, mudança de papel).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS senha_alterada_em TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ultimo_login_em   TIMESTAMPTZ;
-- O login busca por lower(email); sem este índice a busca faz varredura na tabela.
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
