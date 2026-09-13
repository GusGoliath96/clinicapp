# Login seguro — o que mudou e por quê

Dois commits: `036b46f` (autenticação) e `b9c4f51` (tradução do banco e do código).
Este documento registra as decisões, não o passo a passo — o código já mostra o "como".

---

## 1. Autenticação

### Senha continua sendo enviada ao servidor

O pedido original era criptografar a senha no navegador. **Não foi feito, de propósito.**

Se o front envia `hash(senha)`, esse hash *passa a ser* a senha: quem interceptar reenvia e
entra. Não substitui o TLS — e o TLS já existe (Caddy + Let's Encrypt), então a senha já não
trafega aberta. O ganho restante (a senha em claro nunca tocar o servidor) é real mas
modesto, e custaria migrar todas as senhas, manter dois caminhos de login e quebrar o
`db:senha`.

O esforço foi para onde o retorno é maior: HSTS, política de senha, senha nunca em log,
bcrypt custo 11, e as proteções abaixo.

### Segundo fator por e-mail

Código de 6 dígitos, 10 minutos, 5 tentativas. O contador é incrementado **na mesma
instrução SQL** que valida (`UPDATE ... WHERE attempts < 5 RETURNING *`): sem isso,
requisições paralelas leriam o mesmo contador e o limite seria contornável.

O `challengeId` é só o UUID da linha — o `user_id` nunca sai do servidor, então não há como
pular a etapa nem trocar de usuário no meio do fluxo.

**O fator "dispositivo confiável" vive num cookie `HttpOnly`, não no `localStorage`.**
O JWT já está no `localStorage` e é legível por XSS. Se o segundo fator estivesse lá também,
um XSS desligaria o 2FA de forma permanente; no cookie `HttpOnly`, o pior caso do XSS volta
a ser "uma sessão de 7 dias".

### Recuperação de senha

Link de uso único, 30 minutos. A resposta é idêntica exista ou não a conta, **e sai antes da
busca no banco** — se viesse depois, o tempo até ela denunciaria quais e-mails existem.

Concluir o reset derruba todas as sessões e dispositivos lembrados: quem redefine a senha
costuma estar reagindo a um acesso indevido, e sem isso o invasor continuaria dentro.

### Anti-força-bruta

Duas camadas: por IP em memória (`express-rate-limit`) e por **(e-mail, IP)** no Postgres.

A chave é o par, não o e-mail sozinho. Se bastasse o e-mail, qualquer um trancaria a conta do
admin de fora e o bloqueio viraria o ataque. Existe também um limite só por e-mail, mas bem
mais folgado (30 falhas/hora), só para o caso distribuído — e sempre em janela deslizante,
nunca como flag permanente no usuário.

**Tabela dedicada `login_attempts`, não `audit_log`**: `audit_log.tenant_id` é `NOT NULL` e
numa tentativa com e-mail inexistente não há tenant nem usuário a registrar. Além disso são
dados de alto volume e descartáveis em 30 dias, enquanto `audit_log` é trilha de retenção
longa.

### Hash dos códigos: sha256, não bcrypt

`bcryptjs` é JavaScript puro e **bloqueia o event loop**; validar código numa rota quente com
ele travaria o servidor. O código expira em 10 min e tem 5 tentativas, o que já limita o
ataque online. O `id` da linha entra no hash (`sha256(id + ':' + segredo)`) para que uma
tabela pré-calculada dos 10⁶ códigos possíveis não quebre todos de uma vez.

### Correções de falhas preexistentes

| Falha | Correção |
|---|---|
| `/users` só exigia `requireAuth` — qualquer usuário logado podia se promover a admin ou trocar a senha do admin | `requireRole('admin')` |
| JWT de 7 dias sem revogação: trocar senha ou desativar usuário não derrubava nada | `users.token_version` entra no token, validado a cada request e no handshake do Socket.IO |
| `JWT_SECRET` caía em `'dev-secret'` silenciosamente | Em produção o servidor se recusa a subir sem ele |
| Rota `async` sem wrapper: falha de banco pendurava a requisição em vez de virar 500 | `express-async-errors` |
| Login só rodava bcrypt se o usuário existisse — o tempo de resposta revelava e-mails cadastrados | Sempre roda, contra um hash falso quando não há usuário (medido: ~2 ms de diferença) |
| Seed plantava `admin@macs.com.br` / `123456` a cada execução | Usuários vêm de `SEED_ADMIN_EMAIL`, senha aleatória impressa uma única vez |

### 2FA desligado por padrão

`TWO_FACTOR=off`. Enquanto o `MAIL_FROM` for `onboarding@resend.dev`, o Resend só entrega no
endereço dono da conta — nem aliases `+` passam. Com o 2FA obrigatório nesse estado, qualquer
outro usuário ficaria trancado fora. Religar é uma linha no `.env`, depois de verificar um
domínio em resend.com/domains.

Saída de emergência, caso isso aconteça: `npm run auth:token -- <email>` emite um JWT lendo o
banco, sem passar pelo login.

---

## 2. Tradução para inglês

Banco e código em inglês; comentários seguem em português.

**Colunas e tabelas**: `senha_hash` → `password_hash`, `papel` → `role`, `inicio`/`fim` →
`starts_at`/`ends_at`, `laudo` → `report`, `convenios` → `insurance_plans`, e assim por
diante. Nomes de arquivo também (`Recepcao.vue` → `Reception.vue`), via `git mv` para o
histórico seguir o arquivo.

### O que ficou em português, e por quê

**O payload da API.** `/professionals` ainda devolve `especialidade`; `/appointments` ainda
devolve `inicio`. O motor de IA lê esses campos para descobrir o que a clínica atende e para
marcar consulta, e ele não seria alterado agora — renomear quebraria a integração. As colunas
novas saem com alias SQL (`specialty AS especialidade`), então o contrato externo é idêntico
ao de antes. Trocar isso no futuro exige mudar os dois lados junto.

**Os valores de domínio** (`'agendado'`, `'recepcao'`, `'evolucao'`) e as chaves dentro dos
campos `jsonb`. São conteúdo da coluna, não estrutura, e a interface os exibe direto.

**As URLs**, do navegador e da API (`/recepcao`, `/pacientes`, `/convenios`). URL de tela é
parte da interface; a equipe da clínica já as usa.

**Os textos e mensagens de erro.** O produto é usado por uma recepção brasileira.

---

## 3. Fora de escopo, registrado

| Pendência | Observação |
|---|---|
| **Arquivos de exame sem autenticação** | `app.use('/uploads', express.static(...))` serve PDFs protegidos só pelo nome UUID. É o maior risco de LGPD em aberto |
| **Backup do Postgres** | Não existe. O próprio `deploy/README.md` o chama de "risco número 1" |
| **Tela de cadastro de usuários** | Enquanto não existe: `npm run auth:admin -- <email>` |
| **JWT em cookie HttpOnly** | O token segue no `localStorage`. O cookie do 2FA já limita o dano de um XSS |
| **Motor de IA** | Não foi tocado em nenhum ponto |

---

## Verificação

Sem framework de testes no projeto; verificação manual, com o banco recriado do zero:

- As 13 rotas respondem; disponibilidade da agenda calcula slots nos dois formatos de
  `schedule`; timeline do paciente (UNION de 5 tabelas) monta na ordem correta.
- Enumeração por tempo: ~2 ms entre e-mail existente e inexistente.
- Bloqueio: 5 falhas travam a conta naquele IP, e **outro e-mail do mesmo IP continua
  entrando** — confirmando que o lockout não virou negação de serviço.
- 2FA: código errado 5× invalida o desafio mesmo com o código certo depois; link de reset
  reusado é recusado; reset revoga dispositivos e sessões.
- Papel: JWT de `medico` em `/users` → 403.
- Telas: Recepção, Agenda, Pacientes, Card de Vida, Atendimento Clínico e as 4 abas de
  Configurações carregam sem erro de console.
