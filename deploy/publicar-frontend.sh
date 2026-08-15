#!/usr/bin/env bash
# Build do SPA do ClinicaApp + publicação em /var/www/clinicapp (a raiz que o Caddy serve).
#
#   ./deploy/publicar-frontend.sh
#
# Rode toda vez que mudar o frontend. Precisa de sudo só para o passo de cópia.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT="$AQUI/../frontend"
DESTINO=/var/www/clinicapp

# O VITE_API_URL é embutido no bundle no momento do build — um valor errado só aparece
# como "erro de rede" no login, depois de publicado. Por isso a checagem é aqui, antes.
#
# Duas formas são válidas: caminho relativo ("/api", quando o SPA e a API saem do mesmo
# hostname) ou URL absoluta https (quando a API tem hostname próprio). O que não pode é
# apontar para localhost — no navegador do usuário isso é a máquina DELE, não a VM.
API_URL=$(grep -E '^VITE_API_URL=' "$FRONT/.env.production" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')

if [[ -z "$API_URL" ]]; then
	echo "ERRO: VITE_API_URL não está definida em $FRONT/.env.production" >&2
	exit 1
elif [[ "$API_URL" == *localhost* || "$API_URL" == *127.0.0.1* ]]; then
	echo "ERRO: VITE_API_URL aponta para localhost ($API_URL)." >&2
	echo "      O SPA roda no navegador de quem acessa — localhost ali é a máquina dele." >&2
	exit 1
elif [[ "$API_URL" != /* && "$API_URL" != https://* ]]; then
	echo "ERRO: VITE_API_URL inválida ($API_URL)." >&2
	echo "      Use um caminho relativo (/api) ou uma URL https completa." >&2
	exit 1
elif [[ "$API_URL" == https://* ]]; then
	# Host sem nenhum ponto é o `hostname` da máquina, não um nome público — erro fácil
	# de cometer (basta rodar `hostname` e colar). Passaria no build e só apareceria como
	# "erro de rede" no login, porque o navegador de quem acessa não resolve esse nome.
	host=${API_URL#https://}
	host=${host%%/*}
	if [[ "$host" != *.* ]]; then
		echo "ERRO: \"$host\" não é um nome público — parece o \`hostname\` da máquina." >&2
		echo "      Use o nome completo (ex.: maquina.tailXXXX.ts.net) ou, melhor," >&2
		echo "      o caminho relativo /api quando o SPA e a API saem do mesmo host." >&2
		exit 1
	fi
fi
echo "==> VITE_API_URL: $API_URL"

echo "==> Build do frontend"
cd "$FRONT"
# Instalação COMPLETA, com devDependencies: o vite é quem faz o build e vive em
# devDependencies. Um --omit=dev aqui derruba a build com "vite: not found".
# O que não vai para produção é o resultado — o dist/ é estático e não carrega nada disto.
if [[ -f package-lock.json ]]; then
	npm ci
else
	npm install
fi
npm run build

echo "==> Publicando em $DESTINO"
sudo mkdir -p "$DESTINO"
# --delete para não deixar chunk antigo órfão acumulando a cada build.
sudo rsync -a --delete "$FRONT/dist/" "$DESTINO/"
sudo chown -R caddy:caddy "$DESTINO" 2>/dev/null || sudo chown -R root:root "$DESTINO"
sudo chmod -R a+rX "$DESTINO"

echo "==> Pronto. O Caddy já serve a versão nova (arquivo estático, sem reload)."
