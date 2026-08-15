#!/usr/bin/env bash
# Avisa o DuckDNS do IP atual. Como a internet é residencial sem IP fixo, o endereço muda
# sem aviso (queda de link, reboot do modem) e o domínio precisa acompanhar.
#
# O parâmetro ip= vai VAZIO de propósito: assim o DuckDNS usa o IP de origem da requisição,
# que é exatamente o IP público que o mundo enxerga — sem precisar descobrir por conta.
set -euo pipefail

: "${DUCKDNS_SUBDOMINIO:?defina DUCKDNS_SUBDOMINIO em /etc/clinica-deploy.env}"
: "${DUCKDNS_TOKEN:?defina DUCKDNS_TOKEN em /etc/clinica-deploy.env}"

resposta=$(curl -fsS --retry 3 --retry-delay 5 --max-time 30 \
	"https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMINIO}&token=${DUCKDNS_TOKEN}&ip=")

if [[ "$resposta" != "OK" ]]; then
	# "KO" quase sempre é token errado ou subdomínio que não existe na conta.
	echo "DuckDNS recusou a atualização (resposta: '${resposta}')" >&2
	exit 1
fi

echo "DuckDNS atualizado: ${DUCKDNS_SUBDOMINIO}.duckdns.org"
