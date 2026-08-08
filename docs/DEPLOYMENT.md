# Deployment

All examples use placeholders. Private keys, credentials, password hashes, and runtime env files must remain outside Git.

## 1. Cloud firewall

Allow inbound UDP 51820 on the Route VM's cloud security list only from the Service VM public `/32`. If Service egress is restricted, allow outbound UDP 51820 only to the Route VM public `/32`. Do not add a public TCP 3000 rule on Service.

## 2. WireGuard

Install WireGuard tools on both VMs. Generate each private key on the VM with mode `0600`; never copy it into this repository or logs. Adapt the templates under `ops/wireguard`, enable `wg-quick@wg0`, and verify:

```bash
sudo wg show
ping -c 3 10.255.255.254
```

## 3. Service host

Install Node.js 24 LTS at a stable system path, create a non-login `vocanb` user, and create:

```text
/opt/vocanb/releases
/opt/vocanb/current -> releases/<build-id>
/var/lib/vocanb
/etc/vocanb/vocanb.env
/etc/vocanb/google-credentials.json
```

Own app/data paths by `vocanb`; keep `/etc/vocanb` root-owned and runtime-readable only where required. Copy `ops/systemd/vocanb.service` to `/etc/systemd/system/`, then enable it after the first release.

The runtime env must set `HOST=10.255.255.254`, `PORT=3000`, `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`, `ORIGIN=https://<domain>`, the auth values, Vertex values, and `DATA_DIR=/var/lib/vocanb`.

## 4. Route Nginx

Confirm the existing wildcard certificate covers the requested domain. Render `ops/nginx/vocanb.conf.example` with the existing certificate paths, back up the current config, then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 5. TeamCity

The build must run only on successful pushes to the repository default branch:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
tar build + package.json + pnpm-lock.yaml + pnpm-workspace.yaml
scp artifact through the WireGuard address
run ops/deploy/release.sh remotely
```

Store the Service SSH key path as a protected TeamCity agent setting or credential. Never echo its contents. The deployment script switches `current` only after dependency installation, restarts the service, checks `/healthz`, and restores the previous symlink on failure.

## 6. Rollback

Point `/opt/vocanb/current` at the previous release, restart `vocanb`, and verify `http://10.255.255.254:3000/healthz`. Persistent data remains in `/var/lib/vocanb` and is not part of a release.
