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

Login de demonstração (do seed): **admin@macs.com.br** / **123456**.

> Se num terminal novo o `node` não for encontrado, carregue o nvm:
> `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`.

Se preferir não instalar o Postgres na máquina, use o `docker-compose.yml` incluído
(`docker compose up -d`) e rode `npm install` + `npm run db:setup` + `npm run dev` em cada
projeto.

Outros comandos:

```bash
cd backend  && npm run db:setup   # re-aplica schema.sql + seed.sql (idempotente)
cd backend  && npm run db:senha -- admin@macs.com.br 'senha-forte'
cd frontend && npm run build      # build estático em frontend/dist/
```

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
