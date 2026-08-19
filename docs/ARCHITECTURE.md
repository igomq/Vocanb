# Architecture

```text
Browser
  -> HTTPS
OCI Route VM: Nginx + TeamCity
  -> WireGuard 10.255.255.252/30
Azure Service VM: SvelteKit adapter-node + systemd
  -> user-scoped atomic JSON and image files
  -> Vertex AI global / gemini-3.7-flash via ADC
```

## Application boundaries

- `hooks.server.ts` verifies the signed HttpOnly session before any `/app` route runs.
- Passwords are verified with Node `crypto.scrypt`; only the hash is configured at runtime.
- Vertex AI is imported and called only from `$lib/server`; the browser receives neither credentials nor provider errors.
- Uploads are size/type/decoder validated, EXIF-rotated, bounded to 2400px, converted to JPEG, and stored under random UUID names.
- Runtime data lives under `DATA_DIR/users/<derived-user-id>`. Titles never become paths.
- Every vocabulary mutation is serialized in-process and persisted through write + fsync + atomic rename. This is intentionally a single-instance design.
- Test sessions snapshot their word text and order so random tests cannot mutate the master list and history survives later edits.

## Data layout

```text
DATA_DIR/
  users/<user-id>/
    index.json
    vocabularies/<vocabulary-id>.json
    uploads/<vocabulary-id>/<image-id>.jpg
```

JSON documents carry `schemaVersion: 1`. A future schema change must migrate a copy before replacing the original atomically.

## Network decision

The Service VM initiates a point-to-point WireGuard connection to the Route VM. Only peer `/32` routes are advertised; the clouds' overlapping `10.0.0.0/24` underlay networks are never routed through the tunnel.

- Route: `10.255.255.253/30`
- Service: `10.255.255.254/30`
- Nginx upstream: `10.255.255.254:3000`

The application binds to the Service WireGuard address. TCP 3000 is not exposed publicly.
