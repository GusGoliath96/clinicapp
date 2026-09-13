# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ClinicaApp (MVP-A) — gestão de clínica multi-especialidade: Recepção (inbox de WhatsApp),
Agenda e prontuário. O WhatsApp e o bot **não vivem aqui**: são um serviço separado (o "motor
de IA"), com quem este sistema conversa por HTTP + callbacks assinados.

Stack: Node.js ESM puro (sem TypeScript) + Express + Socket.IO + PostgreSQL com SQL cru
(sem ORM, sem migrations) no backend; Vue 3 + Vite + Pinia no frontend. **Não há framework de
testes** — a verificação é manual, contra o banco recriado do zero.

## Comandos

```bash
./setup.sh                                          # instala tudo (Node/nvm, Postgres, .env, deps, schema+seed)

cd backend  && npm run dev                          # API em :3000 (node --watch)
cd frontend && npm run dev                          # SPA em :5173
cd frontend && npm run build                        # build estático em frontend/dist/

cd backend && npm run db:setup                      # re-aplica schema.sql + seed.sql (idempotente)
cd backend && npm run auth:admin -- <email>         # cria/reseta usuário com senha aleatória
cd backend && npm run db:senha -- <email> 'senha'   # idem, escolhendo a senha
cd backend && npm run auth:token -- <email>         # emite JWT sem login — saída de emergência do 2FA
cd backend && npm run mail:teste -- <email>         # confere o envio de e-mail
```

Sem Postgres na máquina: `docker compose up -d` sobe só o banco.

Não há lint nem testes automatizados. Para validar uma mudança, suba os dois servidores e
exercite a tela; o `docs/260912-ImplementacaoLogin.md` descreve o roteiro manual usado antes.

## Invariantes de arquitetura

Coisas que atravessam vários arquivos e não dá para descobrir lendo um só:

- **Multi-tenant por `tenant_id`.** Toda tabela de negócio tem `tenant_id` e **toda query deve
  filtrar por `req.user.tenantId`**. O JWT carrega `{ sub, tenantId, role, tv }` e `requireAuth`
  injeta `req.user`. Esquecer esse filtro é o bug de segurança mais fácil de introduzir aqui.
- **Revogação por `users.token_version`.** O `tv` do JWT é conferido no banco a cada request
  *e* no handshake do Socket.IO. Trocar senha, mudar papel ou desativar usuário incrementa a
  coluna e derruba as sessões. Qualquer caminho novo que aceite JWT precisa repetir essa
  checagem — senão vira porta dos fundos.
- **Realtime por sala de tenant.** `realtime/socket.js` põe cada cliente em `tenant:<id>`.
  Depois de qualquer mutação que a UI mostre ao vivo, emita `emitToTenant(tenantId, evento, payload)`
  (`message:new`, `message:status`, `conversation:update`, `appointment:update`).
- **Fronteira com o motor de IA.** Entrada: `POST /webhooks/ai-engine`, público, validado por
  HMAC-SHA256 (`X-Signature-256`) sobre o **corpo bruto** — por isso é montado *antes* do
  `express.json` global em `index.js`, com um `express.raw` próprio. Saída: `integrations/aiEngine.js`.
  A identidade entre os dois sistemas é o **telefone em E.164**, não um id.
- **Token de serviço.** `/professionals`, `/patients` e `/appointments` usam `authOrService`:
  aceitam o JWT humano **ou** o `SERVICE_API_KEY` que o motor apresenta para rodar as tools do
  fluxo (listar profissionais, achar paciente, ver disponibilidade, marcar).
- **Janela de 24h do WhatsApp.** Texto livre de sessão só é aceito se `last_inbound_at` for
  menor que 24h; fora disso a API responde 409 e exige template aprovado.
- **Backend em camadas rasas:** `config/` → `middleware/` → `routes/` (uma por recurso, montadas
  em `index.js`) + `integrations/` e `realtime/`. **Não existe camada de service** — a lógica
  vive nas rotas. Não introduza uma sem combinar antes.
- **Princípio de produto:** tudo parte do "Card de Vida" do paciente; cada tela é um ângulo
  sobre a mesma entidade. Na prática: não duplique dado entre telas.

## Convenção de idioma (a mais fácil de quebrar)

Banco e identificadores em **inglês**; comentários, textos e boa parte do **contrato externo**
em **português**. Concretamente:

| Camada | Idioma | Exemplo |
|---|---|---|
| Colunas/tabelas, variáveis, arquivos | inglês | `password_hash`, `starts_at`, `insurance_plans`, `Reception.vue` |
| **Payload JSON da API** | português | `specialty AS especialidade`, `starts_at AS inicio` |
| Valores de domínio e chaves de `jsonb` | português | `'agendado'`, `'recepcao'`, `'evolucao'`, `schedule.horarios` |
| URLs (navegador e API) | português | `/recepcao`, `/pacientes`, `/convenios`, `/auth/2fa/verificar` |
| Comentários e mensagens de erro | português | — |

A tradução dos payloads é feita com **alias SQL** na própria rota (veja a constante `fields`
em `routes/appointments.js` e `MESSAGE_FIELDS` em `routes/webhooks.js`). O motor de IA lê esses
campos; renomeá-los quebra a integração e exige mudar os dois sistemas junto. Ao adicionar
coluna nova, dê o alias em português se ela sair na API.

## Banco

`backend/src/db/schema.sql` é a única fonte da verdade e é **idempotente** (`CREATE TABLE IF NOT
EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). Não há ferramenta de migration: para
evoluir o schema, acrescente `ALTER TABLE ... IF NOT EXISTS` ao final da seção correspondente e
rode `npm run db:setup` de novo. Colunas são adicionadas, não editadas no lugar.

## Autenticação

Senha bcrypt (custo 11 — `bcryptjs` é JS puro e bloqueia o event loop), 2FA por e-mail e
recuperação de senha. Detalhes das decisões em `docs/260912-ImplementacaoLogin.md`; o essencial
para não regredir:

- **`TWO_FACTOR=off` por padrão, de propósito.** Enquanto `MAIL_FROM` for `onboarding@resend.dev`,
  o Resend só entrega no e-mail dono da conta. Ligar o 2FA nesse estado tranca todo mundo fora;
  a saída é `node src/db/issue-token.js <email>`.
- **Sem `RESEND_API_KEY` o mailer entra em modo simulado** e imprime código/link no console —
  suficiente para desenvolver.
- **O fator "dispositivo confiável" mora em cookie `HttpOnly`** (`Path=/auth`, 30 dias), nunca no
  `localStorage`, onde um XSS desligaria o 2FA para sempre. O JWT, esse sim, está no
  `localStorage`. `cookie-parser` só é montado em `/auth`, e o axios usa `withCredentials`.
- **Anti-força-bruta por (e-mail, IP)**, não por e-mail sozinho — senão qualquer um tranca a
  conta do admin de fora. Tabela dedicada `login_attempts` (em `audit_log` não cabe: lá
  `tenant_id` é `NOT NULL` e uma tentativa com e-mail inexistente não tem tenant).
- **Códigos de 2FA/reset usam sha256 com o id da linha no hash**, não bcrypt (event loop).
- `/users` exige `requireRole('admin')`.
- `app.set('trust proxy', 1)` é obrigatório: atrás do Caddy todo request vem de 127.0.0.1 e o
  limite por IP contaria a clínica inteira como um cliente só. É `1`, não `true` — `true`
  aceitaria qualquer `X-Forwarded-For` forjado.

## Frontend

- `api/client.js` injeta o JWT e, num 401, limpa a sessão e manda para `/login` — **exceto** nas
  rotas `/auth`, onde 401 significa "credencial errada" e redirecionar cortaria o fluxo de 2FA
  ou de reset no meio.
- `realtime/socket.js` separa à mão o prefixo de caminho da `VITE_API_URL` e o passa como `path`:
  o `socket.io-client` leria `https://host/api` como *namespace* e procuraria o handshake na raiz.
- O router usa `meta: { public: true }` para as telas de auth (ficam fora da shell) e
  `meta: { auth: true }` para o resto. Módulos ainda não construídos são `Placeholder.vue`
  registrados pelo helper `ph()` em `router/index.js`.

## Pendências conhecidas (não são descuido)

- `/uploads` é `express.static` sem autenticação — PDFs de exame protegidos só pelo nome UUID.
  É o maior risco de LGPD em aberto.
- Não existe backup do Postgres (o `deploy/README.md` chama isso de "risco número 1").
- Não existe tela de cadastro de usuários; use os scripts de `src/db/`.

## Deploy

`deploy/README.md` descreve a publicação numa VM caseira sem domínio pago nem IP fixo: DuckDNS
seguindo o IP dinâmico, Caddy para TLS automático e reverse proxy, PM2 (`ecosystem.config.cjs`
em dev, `deploy/ecosystem.prod.config.cjs` em produção). A superfície pública é mínima de
propósito — o painel do motor e o `POST /api/v1/messages` não vão para a internet; o ClinicaApp
fala com o motor por `localhost`. Há um Modo B (Tailscale Funnel) para provedores que bloqueiam
entrada nas portas 80/443.
