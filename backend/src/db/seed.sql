-- Seed de demonstração (idempotente). UUIDs fixos p/ referências estáveis.
-- O usuário admin é criado pelo setup.js (precisa de hash bcrypt gerado em runtime).

INSERT INTO tenants (id, nome, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Clínica MACS',
   '{"fuso":"America/Sao_Paulo","abertura":"08:00","fechamento":"18:00"}')
ON CONFLICT (id) DO NOTHING;

-- Quadro de profissionais. As ESPECIALIDADES aqui são a fonte de verdade para o bot de
-- WhatsApp: ele descobre o que a clínica atende por GET /professionals e escolhe por elas
-- quem tem agenda. Precisam bater com a base de conhecimento da recepção — quando não batiam
-- (aqui Ortopedia/Cardiologia, lá Fisioterapia/Acupuntura/…), o bot anunciava especialidade
-- que não dava para agendar e negava as que existiam. Mexeu numa lista, mexa na outra.
--
-- Os ids a1/a2 são reaproveitados de propósito: consultas, exames, tratamentos e evoluções
-- do seed apontam para eles, e o login-médico de demonstração está vinculado ao a1.
--
-- Dois formatos de agenda convivem e a API entende os dois (ver `expedienteDoDia` em
-- routes/appointments.js): o novo `horarios` (por dia, o que a interface grava, com TODOS os
-- sete dias declarados) e o antigo `dias/inicio/fim` (horário igual todo dia). O Dr. Marco
-- fica no formato antigo de propósito, para o caminho legado continuar coberto.
INSERT INTO professionals (id, tenant_id, nome, conselho, especialidade, cor, agenda) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
   'Dr. Marco Aurélio Silva', 'CREFITO-3 123456-F', 'Fisioterapia', '#2563eb',
   '{"dias":["Seg","Ter","Qua","Qui"],"inicio":"08:00","fim":"19:00","almoco":"12:00-13:15","duracaoConsulta":50,"duracaoRetorno":50}'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001',
   'Dra. Ana Beatriz Costa', 'CRP 06/234567', 'Psicologia', '#16a34a',
   '{"duracaoConsulta":50,"duracaoRetorno":50,"horarios":{"Seg":{"ativo":true,"inicio":"09:00","fim":"18:00","almoco":"12:00-13:15"},"Ter":{"ativo":false},"Qua":{"ativo":true,"inicio":"09:00","fim":"18:00","almoco":"12:00-13:15"},"Qui":{"ativo":false},"Sex":{"ativo":true,"inicio":"09:00","fim":"17:00","almoco":"12:00-13:15"},"Sáb":{"ativo":false},"Dom":{"ativo":false}}}'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001',
   'Dra. Helena Yamamoto', 'CREFITO-3 345678-F', 'Acupuntura', '#9333ea',
   '{"duracaoConsulta":50,"duracaoRetorno":50,"horarios":{"Seg":{"ativo":false},"Ter":{"ativo":true,"inicio":"08:00","fim":"17:00","almoco":"12:00-13:15"},"Qua":{"ativo":false},"Qui":{"ativo":true,"inicio":"08:00","fim":"17:00","almoco":"12:00-13:15"},"Sex":{"ativo":false},"Sáb":{"ativo":false},"Dom":{"ativo":false}}}'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000001',
   'Dr. Rafael Nunes Prado', 'CREFITO-3 456789-F', 'RPG', '#ea580c',
   '{"duracaoConsulta":50,"duracaoRetorno":50,"horarios":{"Seg":{"ativo":true,"inicio":"13:15","fim":"19:00"},"Ter":{"ativo":true,"inicio":"13:15","fim":"19:00"},"Qua":{"ativo":true,"inicio":"13:15","fim":"19:00"},"Qui":{"ativo":true,"inicio":"13:15","fim":"19:00"},"Sex":{"ativo":false},"Sáb":{"ativo":false},"Dom":{"ativo":false}}}'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000001',
   'Dra. Camila Ferraz', 'CRN-3 45678', 'Nutrição', '#0891b2',
   '{"duracaoConsulta":60,"duracaoRetorno":40,"horarios":{"Seg":{"ativo":false},"Ter":{"ativo":true,"inicio":"09:00","fim":"18:00","almoco":"12:00-13:15"},"Qua":{"ativo":false},"Qui":{"ativo":false},"Sex":{"ativo":true,"inicio":"09:00","fim":"14:00","almoco":"12:00-13:15"},"Sáb":{"ativo":false},"Dom":{"ativo":false}}}'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000001',
   'Dra. Letícia Bastos', 'CRFa 2-12345', 'Fonoaudiologia', '#db2777',
   '{"duracaoConsulta":45,"duracaoRetorno":45,"horarios":{"Seg":{"ativo":false},"Ter":{"ativo":false},"Qua":{"ativo":true,"inicio":"08:00","fim":"17:00","almoco":"12:00-13:15"},"Qui":{"ativo":true,"inicio":"08:00","fim":"17:00","almoco":"12:00-13:15"},"Sex":{"ativo":false},"Sáb":{"ativo":false},"Dom":{"ativo":false}}}')
-- DO UPDATE (e não DO NOTHING): o quadro é fixture de demonstração e precisa poder ser
-- realinhado com a base de conhecimento rodando o seed de novo. Edições feitas pela interface
-- nestes seis são sobrescritas — profissionais criados por você têm outro id e não são tocados.
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, conselho = EXCLUDED.conselho, especialidade = EXCLUDED.especialidade,
  cor = EXCLUDED.cor, agenda = EXCLUDED.agenda, ativo = true, updated_at = now();

INSERT INTO patients (id, tenant_id, nome, telefone, convenio, origem, consentimento_lgpd) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001',
   'Tânia Felux', '+5511987654321', 'Unimed', 'WhatsApp', true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001',
   'Paulo José Melo', '+5511976543210', 'Particular', 'Recepção', true)
ON CONFLICT (id) DO NOTHING;

-- Uma conversa de exemplo (aguardando atendimento humano)
INSERT INTO conversations (id, tenant_id, patient_id, telefone, nome_exibicao, status, unread, last_inbound_at, last_message_preview) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000b1', '+5511987654321', 'Tânia Felux', 'pendente', 1,
   now(), 'Pode me ajudar a remarcar?')
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, tenant_id, conversation_id, direction, tipo, texto, status) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'in', 'text', 'Oi, boa tarde', 'lido'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'in', 'text', 'Pode me ajudar a remarcar?', 'lido')
ON CONFLICT (id) DO NOTHING;

-- Agendamentos de hoje (09:00, 09:30, 11:00 no fuso de São Paulo). Idempotente.
INSERT INTO appointments (id, tenant_id, patient_id, professional_id, tipo, convenio, inicio, fim, status, origem) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Consulta', 'Unimed',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '9 hours') AT TIME ZONE 'America/Sao_Paulo',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '9 hours 30 minutes') AT TIME ZONE 'America/Sao_Paulo', 'confirmado', 'WhatsApp'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Retorno', 'Particular',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '9 hours 30 minutes') AT TIME ZONE 'America/Sao_Paulo',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '10 hours') AT TIME ZONE 'America/Sao_Paulo', 'agendado', 'Recepção'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Consulta', 'Unimed',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '11 hours') AT TIME ZONE 'America/Sao_Paulo',
   (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') + interval '11 hours 30 minutes') AT TIME ZONE 'America/Sao_Paulo', 'agendado', 'WhatsApp')
ON CONFLICT (id) DO NOTHING;

-- Uma consulta antiga já realizada (para a Tânia não ser "1ª consulta" e alimentar histórico).
INSERT INTO appointments (id, tenant_id, patient_id, professional_id, tipo, convenio, inicio, fim, status, origem) VALUES
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Consulta', 'Unimed',
   (now() - interval '40 days'), (now() - interval '40 days' + interval '30 minutes'), 'realizado', 'Recepção')
ON CONFLICT (id) DO NOTHING;

-- ─── Card de Vida: enriquecimento da Tânia Felux (demonstração completa) ──────
UPDATE patients SET
  nome_social = '', rg = '12.345.678-9', nascimento = '1955-03-12', sexo = 'F',
  email = 'tania@email.com', tags = '["Idosa","Hipertensa","VIP"]',
  convenio_detalhe = '{"operadora":"Unimed","plano":"Personal","matricula":"008456789012","validade":"12/2026"}',
  endereco = '{"cep":"01305-000","rua":"Rua Augusta","numero":"200","complemento":"Apto 42","bairro":"Consolação","cidade":"São Paulo","uf":"SP"}',
  contato_emergencia = '{"nome":"Carla Felux","tel":"(11) 99999-0000","parentesco":"Filha"}',
  saude = '{"tipoSanguineo":"O+","peso":"62 kg","altura":"1.58 m","imc":"24.8","habitos":"Não fuma · não bebe","atividadeFisica":"Caminhada 3x/semana","historicoFamiliar":"Pai: Cardiopatia · Mãe: Diabetes tipo 2","cirurgias":["Catarata (2020)"]}',
  alergias = '["Dipirona","Penicilina"]',
  comorbidades = '["Hipertensão arterial","Osteoartrose"]',
  medicacoes = '["Losartana 50mg 1x/dia","Atenolol 25mg 1x/dia"]'
WHERE id = '00000000-0000-0000-0000-0000000000b1';

UPDATE patients SET
  rg = '23.456.789-0', nascimento = '1961-08-22', sexo = 'M', email = 'paulo@email.com',
  tags = '["Recorrente"]', comorbidades = '["Diabetes Tipo 2"]', medicacoes = '["Metformina 500mg 2x/dia"]'
WHERE id = '00000000-0000-0000-0000-0000000000b2';

INSERT INTO documents (id, tenant_id, patient_id, tipo, nome, status, data) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'rg', 'RG (frente)', 'validado', now()::date - 5),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'carteirinha', 'Carteirinha Unimed', 'validado', now()::date - 5),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'pedido', 'Pedido médico - RX coluna', 'pendente', now()::date)
ON CONFLICT (id) DO NOTHING;

INSERT INTO exams (id, tenant_id, patient_id, professional_id, nome, tipo, status, data_solicitacao, data_resultado, laudo) VALUES
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'RX coluna lombar AP+P', 'Imagem', 'solicitado', now()::date, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Hemograma completo', 'Laboratório', 'resultado_disponivel', now()::date - 30, now()::date - 25, 'Sem alterações significativas.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO treatments (id, tenant_id, patient_id, professional_id, nome, tipo, total_sessoes, sessoes_feitas, status, valor, inicio) VALUES
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Fisioterapia lombar', 'pacote', 10, 3, 'ativo', 1500.00, now()::date - 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinical_notes (id, tenant_id, patient_id, professional_id, appointment_id, tipo, conteudo, data) VALUES
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e9', 'anamnese', 'Paciente refere dor lombar há 5 dias, irradiando para membro inferior direito. Nega trauma. HAS controlada.', now() - interval '40 days')
ON CONFLICT (id) DO NOTHING;

-- Convênios de demonstração (espelham a lista do protótipo).
INSERT INTO convenios (id, tenant_id, nome, codigo_ans, prazo_pgto, repasse_default, ativo) VALUES
  ('00000000-0000-0000-0000-000000c00001', '00000000-0000-0000-0000-000000000001', 'Particular', NULL, 0, 70, true),
  ('00000000-0000-0000-0000-000000c00002', '00000000-0000-0000-0000-000000000001', 'Unimed', '339679', 60, 50, true),
  ('00000000-0000-0000-0000-000000c00003', '00000000-0000-0000-0000-000000000001', 'Bradesco Saúde', '005711', 45, 55, true),
  ('00000000-0000-0000-0000-000000c00004', '00000000-0000-0000-0000-000000000001', 'Amil', '326305', 60, 55, true),
  ('00000000-0000-0000-0000-000000c00005', '00000000-0000-0000-0000-000000000001', 'SulAmérica', '006246', 45, 55, true)
ON CONFLICT (id) DO NOTHING;
