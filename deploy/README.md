# Deploy público da VM — ClinicaApp + motor de IA

Como colocar os dois sistemas na internet a partir de uma VM em casa, **sem domínio pago e
sem IP fixo**, com HTTPS válido (exigência da Meta para o webhook do WhatsApp).

## Como funciona

```
                    internet
                        │
                        ▼
        DuckDNS  ──► app.SEUNOME.duckdns.org ─┐
      (DNS grátis,      api.SEUNOME.duckdns.org ─┤
       segue o IP)      motor.SEUNOME.duckdns.org ┘
                        │
                        ▼  portas 80/443 encaminhadas pelo roteador
        ┌───────────────────────────────────┐
        │  VM                               │
        │  Caddy  (TLS Let's Encrypt)       │
        │    ├─ app.*   → /var/www/clinicapp (SPA estático)
        │    ├─ api.*   → localhost:3100  ClinicaApp API + Socket.IO
        │    └─ motor.* → localhost:4000  APENAS /webhook e /api/v1/media/*
        │                                   │
        │  Não publicados (só VPN/local):   │
        │    localhost:3000  painel do motor│
        │    localhost:4000  resto da API   │
        │    127.0.0.1:5432/55432/6380  bancos
        └───────────────────────────────────┘
```

Duas ideias governam tudo aqui:

1. **O DuckDNS resolve o IP dinâmico.** Um timer atualiza o registro de 5 em 5 minutos, então
   uma troca de IP causa no máximo 5 minutos de indisponibilidade.
2. **Só vai para a internet o que precisa.** O painel de administração do motor e o
   `POST /api/v1/messages` não são publicados — o ClinicaApp fala com o motor por `localhost`.

## Antes de começar: você tem IP público?

Este plano depende de encaminhar as portas 80/443. Entre no roteador e veja o IP da WAN:

| IP da WAN | Situação | O que fazer |
|---|---|---|
| Igual ao que aparece em `curl https://api.ipify.org` | IP público | Siga este guia |
| `100.64.x.x` a `100.127.x.x` | CGNAT | Peça IP público à operadora (costuma ser grátis) ou use o **Plano B** no fim deste arquivo |

---

## Passo 1 — DuckDNS (2 minutos, grátis)

1. Entre em <https://www.duckdns.org> e faça login (Google/GitHub — sem cartão).
2. Em **domains**, crie um nome, ex.: `macs`. Você fica com `macs.duckdns.org`.
3. Copie o **token** que aparece no topo da página.

Subdomínios abaixo do seu nome resolvem automaticamente para o mesmo IP, então já ganha
`app.macs.duckdns.org`, `api.macs.duckdns.org` e `motor.macs.duckdns.org` sem cadastrar nada.

## Passo 2 — Preparar a VM

Instale as dependências das aplicações (Node, PM2, Docker) e clone os dois repositórios:

```bash
cd ~
gh repo clone GusGoliath96/clinicapp        # ou: git clone https://github.com/...
# o motor de IA vive em outro repositório
```

Os comandos deste guia assumem que você está **na raiz do repositório do ClinicaApp**
(a pasta que contém `backend/`, `frontend/` e `deploy/`). Os scripts se localizam sozinhos
a partir da própria pasta `deploy/`, então o caminho onde você clonou não importa — só o
do motor de IA precisa ser informado, na variável `AI_AGENT_DIR`.

Recomendado também: **Tailscale** (`curl -fsSL https://tailscale.com/install.sh | sh`). Não é
para publicar nada — é para você administrar a VM e abrir o painel do motor
(`http://<ip-tailscale>:3000`) sem expor SSH nem o painel à internet.

## Passo 3 — Configuração do deploy

```bash
cd ~/clinicapp                          # raiz do repositório
sudo cp deploy/deploy.env.example /etc/clinica-deploy.env
sudo nano /etc/clinica-deploy.env      # preencha DUCKDNS_* e DOMINIO_BASE
sudo chmod 600 /etc/clinica-deploy.env
```

## Passo 4 — Instalar Caddy + DuckDNS

```bash
sudo ./deploy/install.sh --com-firewall
```

O script instala o Caddy do repositório oficial, aplica o `Caddyfile`, cria o timer do
DuckDNS e (com a flag) configura o ufw liberando só SSH, 80 e 443. É idempotente: pode
rodar de novo depois de editar o `Caddyfile`.

## Passo 5 — Roteador

1. **Reserva de DHCP** para a VM (para o IP local nunca mudar).
2. **Port forward** `80/TCP` e `443/TCP` → IP da VM.

Confira que o DNS já responde antes de seguir:

```bash
dig +short app.SEUNOME.duckdns.org     # tem que devolver seu IP público
```

O Caddy emite o certificado sozinho no primeiro acesso a cada subdomínio. Se falhar, é quase
sempre a porta 80 fechada — `journalctl -u caddy -f` mostra o erro do desafio ACME.

## Passo 6 — Variáveis das aplicações

Trocando `SEUNOME` pelo seu nome do DuckDNS:

**`backend/.env`** (ClinicaApp)

```ini
PORT=3100
CORS_ORIGIN=https://app.SEUNOME.duckdns.org
JWT_SECRET=<gere: openssl rand -base64 48>
```

O `CORS_ORIGIN` agora aceita lista separada por vírgula, se você quiser manter o
`http://localhost:5173` do dev funcionando em paralelo.

**`frontend/.env.production`**

```ini
VITE_API_URL=https://api.SEUNOME.duckdns.org
```

Esse valor é **embutido no bundle durante o build** — mudar depois exige rebuild.

**`ai_agent/.env`** (motor)

```ini
PUBLIC_BASE_URL=https://motor.SEUNOME.duckdns.org
META_APP_SECRET=<App Secret do Meta App>
META_WEBHOOK_VERIFY_TOKEN=<string que você inventa; a mesma vai no painel da Meta>

# SSRF: em produção o egresso privado fecha, e o ClinicaApp entra por allowlist.
TOOLS_EGRESS_ALLOW_PRIVATE=0
TOOLS_EGRESS_PRIVATE_ALLOWLIST="localhost:3100,127.0.0.1:3100"
```

> A allowlist foi criada exatamente para isto: sem ela você teria que escolher entre deixar
> o egresso privado aberto (um tenant aponta uma tool para o Postgres e lê o resultado pelo
> chat) ou perder a integração com o ClinicaApp, que só é alcançável por endereço privado
> por rodar na mesma VM.

## Passo 7 — Subir tudo

```bash
cd /home/gus/Documentos/ai_agent && npm run infra:up && npm install
npm run prisma:migrate && npm run build --workspace apps/web

cd ~/clinicapp/backend && npm install && npm run db:setup
cd ~/clinicapp && ./deploy/publicar-frontend.sh

pm2 start deploy/ecosystem.prod.config.cjs
pm2 save && pm2 startup      # rode o comando que o startup imprimir
```

## Passo 8 — Webhook da Meta

No painel do Meta App → WhatsApp → Configuration:

- **Callback URL**: `https://motor.SEUNOME.duckdns.org/webhook`
- **Verify token**: o mesmo `META_WEBHOOK_VERIFY_TOKEN` do `.env`

Clique em *Verify and save*. A Meta faz um `GET` com o token; se der erro, veja
`pm2 logs motor-api`.

## Passo 9 — Testar de fora

**Do celular com wi-fi desligado** (de dentro da sua rede o roteador pode não fazer
hairpin NAT e você vê um falso negativo):

- `https://app.SEUNOME.duckdns.org` → tela de login do ClinicaApp
- `https://motor.SEUNOME.duckdns.org/api/v1/messages` → **404** (correto: não é público)
- `https://motor.SEUNOME.duckdns.org:3000` → não conecta (correto: painel não é publicado)

---

## Checklist de segurança antes de mostrar para o Diego

- [ ] **Senha do admin trocada.** O seed cria `admin@macs.com.br` / `123456`:
      `cd backend && npm run db:senha -- admin@macs.com.br 'senha-forte'`
- [ ] `JWT_SECRET` gerado (o default do código é `dev-secret`)
- [ ] `TOOLS_EGRESS_ALLOW_PRIVATE=0` + allowlist no motor
- [ ] Bancos escutando só em loopback (já corrigido nos dois `docker-compose.yml`) —
      confira com `sudo ss -tlnp | grep -E '5432|55432|6380'`
- [ ] `ufw status` mostrando só SSH, 80 e 443
- [ ] Backup do Postgres do ClinicaApp — **não existe ainda**, e a partir do momento em que
      há dados reais de paciente isso vira o risco número 1. Prontuário perdido não volta.

## Manutenção

| Situação | O que acontece |
|---|---|
| IP muda | O timer do DuckDNS corrige em ≤5 min. `journalctl -u duckdns -f` |
| Certificado expira | O Caddy renova sozinho (~30 dias antes). Nada a fazer |
| Mudou o frontend | `./deploy/publicar-frontend.sh` |
| Mudou o backend | `pm2 restart clinicapp-api` |
| Mudou o Caddyfile | `sudo ./deploy/install.sh` (valida e recarrega) |
| **Comprou o domínio da clínica** | Aponte um A record para o IP, troque `DOMINIO_BASE` em `/etc/clinica-deploy.env`, ajuste `CORS_ORIGIN`/`VITE_API_URL`/`PUBLIC_BASE_URL`, rode `install.sh` e `publicar-frontend.sh`. O Caddy emite os certificados novos sozinho |

---

## Plano B — Tailscale Funnel (se estiver atrás de CGNAT)

Funciona sem abrir porta nenhuma e sem IP público, com HTTPS válido num hostname
`*.ts.net`. Em troca: tráfego relayado (mais lento) e URL feia.

```bash
sudo tailscale up
sudo tailscale funnel --bg --set-path /webhook 4000    # webhook da Meta
sudo tailscale funnel status                           # mostra o hostname público
```

O hostname sai no formato `vm.tailXXXX.ts.net` — use-o no lugar de
`motor.SEUNOME.duckdns.org` no painel da Meta e em `PUBLIC_BASE_URL`. O Funnel só aceita as
portas 443, 8443 e 10000, então o ClinicaApp precisa entrar por caminho
(`--set-path /api 3100`) em vez de subdomínio, e o `VITE_API_URL` muda junto.

O resto deste guia (envs, PM2, checklist de segurança) continua valendo igual.
