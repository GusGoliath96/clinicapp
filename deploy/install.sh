#!/usr/bin/env bash
# Instala na VM tudo o que fica FORA das aplicações: Caddy (TLS + reverse proxy) e o
# atualizador do DuckDNS. Idempotente — pode rodar de novo depois de editar o Caddyfile.
#
#   sudo ./deploy/install.sh                  # Caddy + DuckDNS
#   sudo ./deploy/install.sh --com-firewall   # e também configura o ufw
#
# O firewall é opt-in de propósito: `ufw enable` com a regra de SSH errada tranca você
# para fora de uma máquina remota. Se estiver no console físico da VM, pode usar à vontade.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG=/etc/clinica-deploy.env
COM_FIREWALL=0
[[ "${1:-}" == "--com-firewall" ]] && COM_FIREWALL=1

if [[ $EUID -ne 0 ]]; then
	echo "Rode com sudo: sudo $0" >&2
	exit 1
fi

# ---------------------------------------------------------------- configuração
if [[ ! -f "$CONFIG" ]]; then
	echo "ERRO: $CONFIG não existe." >&2
	echo "      sudo cp $AQUI/deploy.env.example $CONFIG && sudo nano $CONFIG" >&2
	exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CONFIG"
set +a

for var in DUCKDNS_SUBDOMINIO DUCKDNS_TOKEN DOMINIO_BASE ACME_EMAIL; do
	if [[ -z "${!var:-}" ]]; then
		echo "ERRO: $var não está definida em $CONFIG" >&2
		exit 1
	fi
done
if [[ "$DUCKDNS_SUBDOMINIO" == "SEUNOME" || "$DUCKDNS_TOKEN" == cole-o-token-* ]]; then
	echo "ERRO: $CONFIG ainda está com os valores de exemplo. Preencha antes de continuar." >&2
	exit 1
fi
chmod 600 "$CONFIG"

echo "==> Domínio base: $DOMINIO_BASE"

# ---------------------------------------------------------------------- Caddy
if ! command -v caddy >/dev/null 2>&1; then
	echo "==> Instalando Caddy (repositório oficial)"
	apt-get update -qq
	apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg rsync
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
		gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' |
		tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
	apt-get update -qq
	apt-get install -y -qq caddy
else
	echo "==> Caddy já instalado ($(caddy version | head -1))"
fi

echo "==> Configurando o serviço do Caddy"
# Drop-in em vez de editar a unit do pacote: sobrevive a `apt upgrade` do Caddy.
mkdir -p /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/override.conf <<'UNIT'
[Service]
# O Caddyfile usa {$DOMINIO_BASE} e {$ACME_EMAIL}; sem isto o serviço sobe com os nomes
# literais e a emissão do certificado falha.
EnvironmentFile=/etc/clinica-deploy.env
UNIT

install -m 644 "$AQUI/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /var/www/clinicapp
chown -R caddy:caddy /var/www/clinicapp
chmod -R a+rX /var/www/clinicapp

echo "==> Validando o Caddyfile"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl daemon-reload
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# -------------------------------------------------------------------- DuckDNS
echo "==> Instalando o atualizador do DuckDNS"
id -u duckdns >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin duckdns
install -m 755 "$AQUI/duckdns-update.sh" /usr/local/bin/duckdns-update.sh
install -m 644 "$AQUI/systemd/duckdns.service" /etc/systemd/system/duckdns.service
install -m 644 "$AQUI/systemd/duckdns.timer" /etc/systemd/system/duckdns.timer
systemctl daemon-reload
systemctl enable --now duckdns.timer

echo "==> Primeira atualização do DNS"
systemctl start duckdns.service
sleep 2
systemctl status duckdns.service --no-pager -l | tail -5 || true

# ------------------------------------------------------------------- firewall
if [[ $COM_FIREWALL -eq 1 ]]; then
	echo "==> Configurando o ufw"
	apt-get install -y -qq ufw
	# SSH primeiro, sempre — inclusive numa porta customizada, se houver.
	porta_ssh=$(grep -oP '^\s*Port\s+\K\d+' /etc/ssh/sshd_config 2>/dev/null | head -1 || true)
	ufw allow "${porta_ssh:-22}/tcp" comment 'SSH'
	ufw allow 80/tcp comment 'HTTP (desafio ACME + redirect)'
	ufw allow 443/tcp comment 'HTTPS'
	# 3000/3100/4000/5432/6379 NÃO entram: são serviços internos, o Caddy chega neles por
	# loopback. Se algum estiver escutando em 0.0.0.0, o ufw é a última barreira.
	ufw --force enable
	ufw status verbose
else
	echo "==> Firewall não configurado (rode com --com-firewall se quiser)"
fi

# ----------------------------------------------------------------------- fim
cat <<FIM

==================================================================
Infra pronta. Falta o que só você pode fazer:

 1. No roteador: encaminhar as portas 80 e 443 (TCP) para o IP desta VM,
    e reservar esse IP por DHCP para ele não mudar.

 2. Conferir que o DNS já responde:
      dig +short app.${DOMINIO_BASE}
    Tem que devolver o seu IP público.

 3. Publicar o frontend:
      ./deploy/publicar-frontend.sh

 4. Subir as aplicações:
      pm2 start deploy/ecosystem.prod.cjs && pm2 save

 5. Testar de FORA da sua rede (dados móveis, não o wi-fi de casa):
      https://app.${DOMINIO_BASE}
      https://motor.${DOMINIO_BASE}/webhook   (deve pedir os parâmetros da Meta)

 Logs do Caddy:   journalctl -u caddy -f
 Logs do DuckDNS: journalctl -u duckdns -f
==================================================================
FIM
