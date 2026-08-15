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

if ! grep -q '^VITE_API_URL=https://' "$FRONT/.env.production" 2>/dev/null; then
	echo "ERRO: $FRONT/.env.production precisa apontar para a URL pública da API" >&2
	echo "      (ex.: VITE_API_URL=https://api.SEUNOME.duckdns.org)" >&2
	echo "      O valor é embutido no bundle no momento do build — não dá para trocar depois." >&2
	exit 1
fi

echo "==> Build do frontend"
cd "$FRONT"
npm ci --omit=dev 2>/dev/null || npm install
npm run build

echo "==> Publicando em $DESTINO"
sudo mkdir -p "$DESTINO"
# --delete para não deixar chunk antigo órfão acumulando a cada build.
sudo rsync -a --delete "$FRONT/dist/" "$DESTINO/"
sudo chown -R caddy:caddy "$DESTINO" 2>/dev/null || sudo chown -R root:root "$DESTINO"
sudo chmod -R a+rX "$DESTINO"

echo "==> Pronto. O Caddy já serve a versão nova (arquivo estático, sem reload)."
