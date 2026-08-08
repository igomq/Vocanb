#!/usr/bin/env bash
set -euo pipefail

service_public_key=${1:?service public key required}
route_private_key=$(</etc/wireguard/privatekey)
config=/etc/wireguard/wg0.conf

if [[ -f $config ]]; then
    cp -a "$config" "$config.backup-$(date +%Y%m%d%H%M%S)"
fi

umask 077
printf '%s\n' \
    '[Interface]' \
    'Address = 10.255.255.253/30' \
    'ListenPort = 51820' \
    "PrivateKey = $route_private_key" \
    '' \
    '[Peer]' \
    "PublicKey = $service_public_key" \
    'AllowedIPs = 10.255.255.254/32' > "$config"

if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=51820/udp
    firewall-cmd --reload
fi
systemctl enable --now wg-quick@wg0
