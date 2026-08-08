#!/usr/bin/env bash
set -euo pipefail

source_node=${1:-/home/Gom/.nvm/versions/node/v24.18.0}

if [[ $EUID -ne 0 ]]; then
    echo "run as root" >&2
    exit 1
fi
if [[ ! -x $source_node/bin/node ]]; then
    echo "Node 24 source installation not found" >&2
    exit 1
fi

id vocanb >/dev/null 2>&1 || useradd --system --home /var/lib/vocanb --shell /usr/sbin/nologin vocanb
rm -rf /opt/node-v24
cp -a "$source_node" /opt/node-v24
install -d -o vocanb -g vocanb -m 750 /opt/vocanb/releases /var/lib/vocanb
install -d -o root -g vocanb -m 750 /etc/vocanb
