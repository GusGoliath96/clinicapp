# ClinicaApp — Sistema (MVP-A)

Sistema de gestão para clínicas multi-especialidade. Este repositório contém o **MVP-A**
— Recepção (inbox de WhatsApp) + Agenda + prontuário — e a infraestrutura de publicação.

O WhatsApp e o bot de auto-atendimento não vivem aqui: são um serviço separado (o "motor
de IA"), com quem este sistema conversa por HTTP + callbacks assinados.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js (ESM, JavaScript puro), Express, Socket.IO, JWT |
| Banco | PostgreSQL, SQL cru via helper `query()` (sem ORM) |
| Frontend | Vue 3, Vite, Vue Router, Pinia, axios, socket.io-client |
| Infra | Caddy (TLS automático), PM2, Docker Compose (só para o banco) |

Sem TypeScript, sem ORM, sem framework de testes.

## Como rodar (desenvolvimento)

Um único script instala tudo: Node.js (via nvm), PostgreSQL, cria o banco, gera os `.env`,
instala as dependências e aplica schema + seed.

```bash
./setup.sh          # pede sudo para instalar Postgres/pacotes do sistema
```

Depois, em dois terminais:

```bash
cd backend  && npm run dev     # http://localhost:3000
cd frontend && npm run dev     # http://localhost:5173
```

O primeiro acesso vem de `SEED_ADMIN_EMAIL` no `backend/.env`: o `db:setup` cria o admin
(e um usuário médico no alias `+medico`) e imprime a senha gerada **uma única vez**. Se
perder, `npm run auth:admin -- <email>` gera outra.

> Se num terminal novo o `node` não for encontrado, carregue o nvm:
> `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`.

Se preferir não instalar o Postgres na máquina, use o `docker-compose.yml` incluído
(`docker compose up -d`) e rode `npm install` + `npm run db:setup` + `npm run dev` em cada
projeto.

Outros comandos:

```bash
cd backend  && npm run db:setup                    # re-aplica schema.sql + seed.sql (idempotente)
cd backend  && npm run auth:admin -- <email>       # cria/reseta usuário com senha aleatória
cd backend  && npm run db:senha -- <email> 'senha' # idem, escolhendo a senha
cd backend  && npm run auth:token -- <email>       # emite JWT sem login (emergência do 2FA)
cd backend  && npm run mail:teste -- <email>       # confere se o envio de e-mail funciona
cd frontend && npm run build                       # build estático em frontend/dist/
```

## Autenticação

O login tem senha (bcrypt), segundo fator por e-mail e recuperação de senha.

- **Segundo fator** — com `TWO_FACTOR=on`, o login manda um código de 6 dígitos por e-mail.
  Marcar "confiar neste dispositivo" grava um cookie `HttpOnly` de 30 dias e o código deixa
  de ser pedido naquele navegador. O JWT continua no `localStorage`; o segundo fator não,
  de propósito — senão um XSS desligaria o 2FA de forma permanente.
- **E-mail** — `RESEND_API_KEY` no `.env`. Sem ela o código e o link são impressos no
  console do backend, o que basta para desenvolver. Confirme a entrega com
  `npm run mail:teste` **antes** de ligar `TWO_FACTOR=on`: com o 2FA ligado e o e-mail fora
  do ar, ninguém entra — a saída é `npm run auth:token`.
  > Enquanto o `MAIL_FROM` for `onboarding@resend.dev`, o Resend **só entrega no endereço
  > dono da conta** — nem aliases `+` dele passam. Na prática, só esse usuário consegue
  > receber código ou link; para os demais, use `npm run auth:token -- <email>`. Verificar
  > um domínio em resend.com/domains remove a restrição e é o que produção exige.
- **Força bruta** — limite por IP em memória, mais bloqueio por (e-mail, IP) no Postgres
  (`login_attempts`). A chave é o par, não o e-mail sozinho: assim ninguém tranca a conta
  do admin de fora só para causar dano.
- **Revogação** — `users.token_version` entra no JWT. Trocar a senha, mudar o papel ou
  desativar o usuário derruba as sessões abertas, inclusive o Socket.IO.
- **Papéis** — `/users` exige papel `admin`; a aba Usuários some para os demais.

> Senha em claro nunca é enviada pelo front nem gravada em log: o transporte é protegido
> por TLS (Caddy), e o hash fica só no servidor. Hashear no navegador não substituiria o
> TLS — o hash passaria a *ser* a senha para quem o interceptasse.

## Arquitetura

Invariantes que atravessam vários arquivos:

- **Multi-tenant por `tenant_id`** — toda tabela de negócio tem `tenant_id` e toda query
  deve ser escopada por `req.user.tenantId`. O JWT carrega `{ sub, tenantId, papel }` e o
  middleware `requireAuth` injeta `req.user`. Esquecer o filtro de tenant é o bug de
  segurança mais fácil de introduzir aqui.
- **Realtime por sala de tenant** — `realtime/socket.js` põe cada cliente na sala
  `tenant:<id>`. Depois de qualquer mutação que a UI precise ver ao vivo, emita com
  `emitToTenant(tenantId, evento, payload)`.
- **Fronteira com o motor de IA** — entrada pelo webhook público `POST /webhooks/ai-engine`,
  validado por HMAC-SHA256 (`X-Signature-256`) sobre o corpo bruto, montado antes do
  `express.json` global; saída por `integrations/aiEngine.js`. A identidade entre os dois
  sistemas é o telefone em E.164.
- **Janela de 24h do WhatsApp** — texto livre de sessão só é aceito se `last_inbound_at`
  for menor que 24h; fora disso a API responde 409 e exige template aprovado.
- **Backend em camadas** — `config/` → `middleware/` → `routes/` (uma por recurso) +
  `integrations/` e `realtime/`. Sem camada de service: a lógica vive nas rotas.
- **Princípio de produto** — tudo parte do "Card de Vida" do paciente; cada tela é um
  ângulo sobre a mesma entidade. Na prática: não duplique dado entre telas.

```
backend/          Express + Socket.IO + PostgreSQL
  src/routes/     uma rota por recurso, montadas em index.js
  src/db/         schema.sql, seed.sql, setup.js
frontend/         Vue 3 + Vite
deploy/           Caddy, DuckDNS, PM2 de produção — ver deploy/README.md
docker-compose.yml
```

## Deploy

[`deploy/README.md`](deploy/README.md) descreve a publicação numa VM caseira sem domínio
pago e sem IP fixo: DuckDNS para acompanhar o IP dinâmico, Caddy para TLS automático e
reverse proxy, com a superfície pública reduzida ao mínimo. Inclui checklist de segurança.

## Licença

Sem licença definida — todos os direitos reservados.
