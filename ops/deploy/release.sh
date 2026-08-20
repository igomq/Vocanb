#!/usr/bin/env bash
set -euo pipefail

archive=${1:?artifact path required}
build_id=${2:?build id required}
releases=/opt/vocanb/releases
release="$releases/$build_id"
previous=
if [[ -L /opt/vocanb/current ]]; then
    previous=$(readlink -f /opt/vocanb/current || true)
fi

install -d -o vocanb -g vocanb "$release"
tar -xzf "$archive" -C "$release"
chown -R vocanb:vocanb "$release"
cd "$release"
sudo -u vocanb env PATH=/opt/node-v24/bin:/usr/bin:/bin /opt/node-v24/bin/corepack pnpm --dir "$release" install --prod --frozen-lockfile
ln -sfn "$release" /opt/vocanb/current
systemctl restart vocanb

if ! curl --fail --silent --show-error --retry 10 --retry-delay 2 --retry-connrefused http://10.0.0.77:3000/healthz >/dev/null; then
    if [[ -n "$previous" ]]; then
        ln -sfn "$previous" /opt/vocanb/current
        systemctl restart vocanb
    fi
    exit 1
fi

find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr \
    | tail -n +6 \
    | cut -d' ' -f2- \
    | xargs -r rm -rf --
