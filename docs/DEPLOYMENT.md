# Deployment

All examples use placeholders. Private keys, credentials, password hashes, and runtime env files must remain outside Git.

## 1. VCN firewall

Allow Service TCP 3000 only from the Route VM's private address. Do not add a public TCP 3000 rule.

## 2. Service host

Install Node.js 24 LTS at a stable system path, create a non-login `vocanb` user, and create:

```text
/opt/vocanb/releases
/opt/vocanb/current -> releases/<build-id>
/var/lib/vocanb
/etc/vocanb/vocanb.env
/etc/vocanb/google-credentials.json
```

Own app/data paths by `vocanb`; keep `/etc/vocanb` root-owned and runtime-readable only where required. Copy `ops/systemd/vocanb.service` to `/etc/systemd/system/`, then enable it after the first release.

The runtime env must set `HOST=10.0.0.77`, `PORT=3000`, `ADDRESS_HEADER=x-real-ip`, `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`, `ORIGIN=https://<domain>`, `BODY_SIZE_LIMIT=92M`, the auth values, Vertex values, and `DATA_DIR=/var/lib/vocanb`. The service port must remain reachable only from the trusted Nginx host before accepting its address header. Keep the adapter limit above the app's 90MiB file-total limit so multipart overhead is not rejected before the upload action can validate or log it.

## 3. Route Nginx

Confirm the existing wildcard certificate covers the requested domain. Render `ops/nginx/vocanb.conf.example` with the existing certificate paths, back up the current config, then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 4. TeamCity

The build must run only on successful pushes to the repository default branch:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
tar build + package.json + pnpm-lock.yaml + pnpm-workspace.yaml
scp artifact over the OCI VCN
run ops/deploy/release.sh remotely
```

Store the Service SSH key path as a protected TeamCity agent setting or credential. Never echo its contents. The deployment script switches `current` only after dependency installation, restarts the service, checks `/healthz`, and restores the previous symlink on failure.

## 5. Rollback

Point `/opt/vocanb/current` at the previous release, restart `vocanb`, and verify `http://10.0.0.77:3000/healthz`. Persistent data remains in `/var/lib/vocanb` and is not part of a release.
