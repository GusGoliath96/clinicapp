#!/usr/bin/env bash
#
# Setup completo do ClinicaApp MVP-A (sem Docker).
# Instala Node.js (via nvm), PostgreSQL (apt), cria o banco, gera os .env,
# instala as dependências do backend e frontend e aplica schema + seed.
#
# Uso:  cd sistema && ./setup.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Config do banco (bate com backend/.env.example) ────────────────────────
DB_NAME=clinicapp
DB_USER=clinicapp
DB_PASS=clinicapp
NODE_VERSION="--lts"
NVM_VERSION="v0.40.1"

# ─── Helpers ────────────────────────────────────────────────────────────────
info() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# sudo só quando não somos root
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo" || die "Precisa de sudo (ou rodar como root) para instalar pacotes do sistema."
fi

command -v apt-get >/dev/null 2>&1 || die "Este script assume Ubuntu/Debian (apt-get). Ajuste manualmente em outra distro."

# ─── 1. Node.js via nvm ─────────────────────────────────────────────────────
# Atenção: o nvm NÃO é compatível com 'set -u' (referencia variáveis não
# inicializadas). Desligamos o nounset ao carregá-lo/usá-lo.
export NVM_DIR="$HOME/.nvm"
load_nvm() { set +u; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; set -u; }

load_nvm
if command -v node >/dev/null 2>&1; then
  ok "Node.js já presente: $(node -v)"
else
  info "Instalando nvm + Node.js (LTS)..."
  command -v curl >/dev/null 2>&1 || { $SUDO apt-get update -y && $SUDO apt-get install -y curl; }
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  fi
  set +u
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  set -u
  ok "Node.js instalado: $(node -v)"
fi

# ─── 2. PostgreSQL ──────────────────────────────────────────────────────────
if command -v psql >/dev/null 2>&1; then
  ok "PostgreSQL já presente: $(psql --version)"
else
  info "Instalando PostgreSQL..."
  $SUDO apt-get update -y
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y postgresql postgresql-contrib
  ok "PostgreSQL instalado."
fi

info "Garantindo que o PostgreSQL está rodando..."
$SUDO systemctl enable --now postgresql 2>/dev/null \
  || $SUDO service postgresql start 2>/dev/null \
  || warn "Não consegui iniciar o serviço automaticamente — inicie o PostgreSQL manualmente."

# ─── 3. Banco + usuário (idempotente) ───────────────────────────────────────
info "Criando banco '$DB_NAME' e usuário '$DB_USER'..."
psql_admin() { $SUDO -u postgres psql -v ON_ERROR_STOP=1 "$@"; }

if ! psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  psql_admin -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
  ok "Usuário '$DB_USER' criado."
else
  ok "Usuário '$DB_USER' já existe."
fi

if ! psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  ok "Banco '$DB_NAME' criado."
else
  ok "Banco '$DB_NAME' já existe."
fi

# ─── 4. Arquivos .env ───────────────────────────────────────────────────────
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" backend/.env
  ok "backend/.env criado (JWT_SECRET aleatório gerado)."
else
  ok "backend/.env já existe (mantido)."
fi

if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  ok "frontend/.env criado."
else
  ok "frontend/.env já existe (mantido)."
fi

# ─── 5. Dependências ────────────────────────────────────────────────────────
info "Instalando dependências do backend..."
( cd backend && npm install )
ok "Backend pronto."

info "Instalando dependências do frontend..."
( cd frontend && npm install )
ok "Frontend pronto."

# ─── 6. Schema + seed ───────────────────────────────────────────────────────
info "Aplicando schema + seed no banco..."
( cd backend && npm run db:setup )

# ─── Fim ────────────────────────────────────────────────────────────────────
cat <<EOF

$(ok "Setup concluído!")

Para rodar (dois terminais):

  cd backend  && npm run dev     # http://localhost:3000
  cd frontend && npm run dev     # http://localhost:5173

Login demo:  admin@macs.com.br  /  123456

EOF

if ! command -v node >/dev/null 2>&1 || [ -n "${NVM_DIR:-}" ]; then
  warn "Se 'node' não for encontrado num terminal novo, carregue o nvm:"
  echo '      export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
  echo '  (o instalador do nvm normalmente já adiciona isso ao seu ~/.bashrc)'
fi
