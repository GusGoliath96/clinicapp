-- ClinicaApp MVP-A — schema PostgreSQL
-- Multi-tenant-ready: tenant_id em todas as tabelas de negócio.
--
-- Identificadores em inglês; os VALORES de domínio seguem em português
-- ('agendado', 'recepcao', 'evolucao'), porque a interface os exibe direto.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Núcleo ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',   -- fuso, horário de funcionamento
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'recepcao',  -- admin | recepcao | medico
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- ─── Cadastros ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professionals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  license     TEXT,                          -- registro no conselho (CRM, CRO...)
  specialty   TEXT,
  color       TEXT DEFAULT '#2563eb',
  active      BOOLEAN NOT NULL DEFAULT true,
  -- { horarios, almoco, duracaoConsulta, duracaoRetorno }
  schedule    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vínculo opcional do login com um profissional (médico cai direto na própria fila).
-- Depois de professionals existir, por causa da FK.
ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS patients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,                    -- E.164, casa com o WhatsApp
  cpf               TEXT,
  insurance_plan    TEXT,
  tags              JSONB NOT NULL DEFAULT '[]',
  source            TEXT,
  lgpd_consent      BOOLEAN NOT NULL DEFAULT false,
  lgpd_consent_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients (tenant_id, phone);

-- ─── Recepção / Conversas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id            UUID REFERENCES patients(id) ON DELETE SET NULL,
  phone                 TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'pendente',  -- pendente | humano | resolvida
  assignee_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  unread                INTEGER NOT NULL DEFAULT 0,
  last_inbound_at       TIMESTAMPTZ,        -- controla a janela de 24h do WhatsApp
  last_message_preview  TEXT,
  wa_conversation_id    TEXT,               -- id da conversa no motor de IA, p/ handoff e eventos
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,                   -- in | out
  kind            TEXT NOT NULL DEFAULT 'text',    -- text | template | media
  body            TEXT,
  media_url       TEXT,
  wa_message_id   TEXT,                            -- id no canal, p/ reconciliar status
  status          TEXT NOT NULL DEFAULT 'enviado', -- enviado | entregue | lido | falhou
  sent_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_waid ON messages (wa_message_id);

-- ─── Agenda ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id        UUID REFERENCES patients(id) ON DELETE SET NULL,
  professional_id   UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  unit_id           UUID,
  kind              TEXT,
  insurance_plan    TEXT,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'agendado',
  -- agendado | confirmado | em_atendimento | realizado | cancelado | falta
  source            TEXT DEFAULT 'Recepção',   -- WhatsApp | Recepção | Telefone
  checked_in_at     TIMESTAMPTZ,
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_period ON appointments (tenant_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id UUID REFERENCES professionals(id) ON DELETE CASCADE, -- null = geral
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  reason          TEXT,   -- ferias | congresso | manutencao | feriado | almoco | outro
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── WhatsApp / Auditoria ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meta_name        TEXT NOT NULL,   -- elemento aprovado na Meta
  category         TEXT,
  body             TEXT,
  variables        JSONB NOT NULL DEFAULT '[]',
  approval_status  TEXT DEFAULT 'pendente',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   UUID,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Card de Vida: paciente no centro ────────────────────────────────────────
-- Perfil estendido do paciente.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS social_name       TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS rg                TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS birth_date        DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS gender            TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address           JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS health            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergies         JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS comorbidities     JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS medications       JSONB NOT NULL DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_details JSONB NOT NULL DEFAULT '{}';

-- Documentos do paciente (RG, carteirinha, pedido médico...).
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind        TEXT,                              -- rg | carteirinha | pedido | outro
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendente',  -- pendente | validado
  file_url    TEXT,
  date        DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents (tenant_id, patient_id);

-- Exames vinculados ao paciente.
CREATE TABLE IF NOT EXISTS exams (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id  UUID REFERENCES professionals(id) ON DELETE SET NULL,  -- solicitante
  appointment_id   UUID REFERENCES appointments(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  kind             TEXT,
  status           TEXT NOT NULL DEFAULT 'solicitado', -- solicitado | coletado | resultado_disponivel
  requested_on     DATE,
  resulted_on      DATE,
  report           TEXT,
  file_url         TEXT,
  indication       TEXT,                       -- hipótese diagnóstica (CID) no pedido impresso
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exams_patient ON exams (tenant_id, patient_id);

-- Tratamentos / pacotes do paciente.
CREATE TABLE IF NOT EXISTS treatments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id     UUID REFERENCES professionals(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  kind                TEXT,                              -- pacote | plano | sessoes
  total_sessions      INTEGER NOT NULL DEFAULT 0,
  completed_sessions  INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'ativo',     -- ativo | concluido | cancelado
  price               NUMERIC(12,2),
  starts_on           DATE,
  ends_on             DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments (tenant_id, patient_id);

-- Prontuário longitudinal (anamnese, evolução, atestado, receita).
CREATE TABLE IF NOT EXISTS clinical_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id  UUID REFERENCES professionals(id) ON DELETE SET NULL,
  appointment_id   UUID REFERENCES appointments(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL DEFAULT 'evolucao',  -- anamnese | evolucao | atestado | receita
  content          TEXT,
  -- Versão estruturada (ex.: itens da receita com dose/via/frequência). content continua
  -- guardando o texto, para histórico, impressão e busca.
  data             JSONB,
  noted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_patient ON clinical_notes (tenant_id, patient_id);

-- Convênios da clínica (configuração). A rota pública segue sendo /convenios.
CREATE TABLE IF NOT EXISTS insurance_plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  ans_code           TEXT,
  payment_term_days  INTEGER NOT NULL DEFAULT 0,
  default_split      NUMERIC(5,2),                 -- % de repasse ao profissional
  active             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_plans_tenant ON insurance_plans (tenant_id);

-- ─── Autenticação ───────────────────────────────────────────────────────────

-- Desafios efêmeros: código de 2FA e token de redefinição de senha. As duas coisas têm a
-- mesma forma (segredo com validade e uso único), então moram na mesma tabela.
-- O segredo nunca é gravado em claro; o id da linha entra no hash para que os 10^6 códigos
-- possíveis não possam ser quebrados de uma vez por uma tabela pré-calculada.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- 2fa | reset
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_user ON auth_challenges (user_id, kind, created_at DESC);

-- Dispositivos que já passaram pelo 2FA e não precisam do código por 30 dias.
-- O segredo correspondente vai num cookie HttpOnly: se ficasse no localStorage junto do
-- JWT, um XSS desligaria o segundo fator de forma permanente.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  label         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
  success     BOOLEAN NOT NULL DEFAULT false,
  reason      TEXT,                            -- senha | usuario | inativo | 2fa | bloqueado
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts (ip, created_at DESC);

-- token_version invalida JWTs já emitidos (troca de senha, desativação, mudança de papel).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;
-- O login busca por lower(email); sem este índice a busca faz varredura na tabela.
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
