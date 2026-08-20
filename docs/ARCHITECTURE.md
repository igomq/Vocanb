# Architecture

```text
Browser
  -> HTTPS
OCI Route VM: Nginx + TeamCity
  -> OCI VCN private network
OCI Service VM 10.0.0.77: SvelteKit adapter-node + systemd
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

Both VMs share an OCI VCN. Nginx reaches the service directly at `10.0.0.77:3000`; the service firewall allows that port only from the Route VM's private address. TCP 3000 is not exposed publicly.
