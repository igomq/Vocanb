#!/usr/bin/env bash
set -euo pipefail

source_file=${1:-/tmp/vocanb.env}
target=/etc/vocanb/vocanb.env
temporary=$(mktemp)
secret=

if [[ -f $target ]]; then
    secret=$(sed -n 's/^SESSION_SECRET=//p' "$target" | head -n 1)
fi
if [[ -z $secret ]]; then
    secret=$(openssl rand -base64 48)
fi

awk -v secret="$secret" '
    /^SESSION_SECRET=/ { print "SESSION_SECRET=" secret; next }
    /^BODY_SIZE_LIMIT=/ { print "BODY_SIZE_LIMIT=92M"; body_limit=1; next }
    { print }
    END { if (!body_limit) print "BODY_SIZE_LIMIT=92M" }
' "$source_file" > "$temporary"

if grep -qE '=(|<[^>]+>|__[^_]+__)$$' "$temporary"; then
    echo "runtime env contains an empty or placeholder value" >&2
    rm -f "$temporary"
    exit 1
fi

install -o root -g vocanb -m 640 "$temporary" "$target"
rm -f "$temporary" "$source_file"
