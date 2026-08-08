#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "run as root" >&2
    exit 1
fi

if ! command -v wg >/dev/null; then
    if command -v dnf >/dev/null; then
        dnf install -y wireguard-tools
    else
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard
    fi
fi

install -d -m 700 /etc/wireguard
if [[ ! -f /etc/wireguard/privatekey ]]; then
    umask 077
    wg genkey > /etc/wireguard/privatekey
fi
wg pubkey < /etc/wireguard/privatekey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
chmod 644 /etc/wireguard/publickey
cat /etc/wireguard/publickey
