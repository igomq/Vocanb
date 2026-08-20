#!/usr/bin/env bash
set -euo pipefail

domain=${1:?domain required}
certificate=${2:?certificate path required}
certificate_key=${3:?certificate key path required}
target=/etc/nginx/conf.d/vocanb.conf
backup=

if [[ -f $target ]]; then
    backup="$target.backup-$(date +%Y%m%d%H%M%S)"
    cp -a "$target" "$backup"
fi

printf '%s\n' \
    'server {' \
    '    listen 80;' \
    "    server_name $domain;" \
    '    return 301 https://$host$request_uri;' \
    '}' \
    '' \
    'server {' \
    '    listen 443 ssl http2;' \
    "    server_name $domain;" \
    "    ssl_certificate $certificate;" \
    "    ssl_certificate_key $certificate_key;" \
    '    client_max_body_size 100m;' \
    '    location / {' \
    '        proxy_pass http://10.0.0.77:3000;' \
    '        proxy_http_version 1.1;' \
    '        proxy_set_header Host $host;' \
    '        proxy_set_header X-Real-IP $remote_addr;' \
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
    '        proxy_set_header X-Forwarded-Proto $scheme;' \
    '        proxy_read_timeout 300s;' \
    '        proxy_send_timeout 300s;' \
    '    }' \
    '}' > "$target"

if ! nginx -t; then
    if [[ -n $backup ]]; then
        cp -a "$backup" "$target"
    else
        rm -f "$target"
    fi
    exit 1
fi
systemctl reload nginx
