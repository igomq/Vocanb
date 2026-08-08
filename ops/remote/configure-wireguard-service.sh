#!/usr/bin/env bash
set -euo pipefail

route_public_key=${1:?route public key required}
route_endpoint=${2:?route endpoint required}
service_private_key=$(</etc/wireguard/privatekey)
config=/etc/wireguard/wg0.conf

if [[ -f $config ]]; then
    cp -a "$config" "$config.backup-$(date +%Y%m%d%H%M%S)"
fi

umask 077
printf '%s\n' \
    '[Interface]' \
    'Address = 10.255.255.254/30' \
    "PrivateKey = $service_private_key" \
    '' \
    '[Peer]' \
    "PublicKey = $route_public_key" \
    "Endpoint = $route_endpoint:51820" \
    'AllowedIPs = 10.255.255.253/32' \
    'PersistentKeepalive = 25' > "$config"

systemctl enable --now wg-quick@wg0
