# Simple Storage Service

An S3-compatible object storage server in a single container: the S3 REST API with SigV4
authentication and bucket policies, a management API, and a web UI for users, bucket access and a
file browser. Postgres and Valkey run inside the image, so there is nothing else to deploy.

- **S3 API** — SigV4, path and virtual-host style, multipart upload, versioning, delete markers,
  bucket policies with conditions, presigned URLs, SSE-S3 encryption at rest.
- **Management UI** — users, access keys, bucket access, quotas, policies, a file browser.
- **Management API** — JSON, JWT, OpenAPI document at `/api/swagger`.

---

## Quick start

```bash
docker volume create storage-data

docker run -d --name storage \
  -p 4242:4242 \
  -p 443:443 \
  -v storage-data:/data \
  -e JWT_SECRET="$(openssl rand -base64 36)" \
  -e CRYPTOGRAPHIC_PASSWORD="$(openssl rand -base64 36)" \
  -e STORAGE_ENCRYPTION_KEY="$(openssl rand -base64 36)" \
  -e BOOTSTRAP_ADMIN_PASSWORD="choose-a-real-one" \
  -e S3_PUBLIC_URL="https://s3.example.com" \
  --stop-timeout 30 \
  --restart unless-stopped \
  tomcupak/storage
```

Then open `http://localhost:4242` and sign in as `admin@storage.local` with the password you set.
Create an access key in the UI and point any S3 client at `http://localhost:443`.

**Write those three generated secrets down before you run this.** They are not stored anywhere you
can read them back from, and `STORAGE_ENCRYPTION_KEY` is what every object's data key is wrapped
with — lose it and the payloads in the volume cannot be decrypted by anything, including this
image.

### docker compose

```yaml
services:
  storage:
    image: tomcupak/storage
    ports:
      - "4242:4242"   # management UI (and the management API under /api)
      - "443:443"     # S3 endpoint
    volumes:
      - storage-data:/data
    environment:
      JWT_SECRET: "..."
      CRYPTOGRAPHIC_PASSWORD: "..."
      STORAGE_ENCRYPTION_KEY: "..."
      BOOTSTRAP_ADMIN_PASSWORD: "..."
      S3_PUBLIC_URL: "https://s3.example.com"
    restart: unless-stopped
    stop_grace_period: 30s

volumes:
  storage-data:
```

---

## The volume is not optional

Everything the container keeps lives under `/data`:

| Path | What |
| --- | --- |
| `/data/objects` | object payloads — the actual bytes |
| `/data/postgres` | the Postgres cluster: buckets, keys, versions, policies, users |
| `/data/valkey` | rate-limit counters (disposable) |

They are one unit. Object metadata without payloads is a listing of files that are not there, and
payloads without metadata are unnamed blobs — neither half can be restored from the other, so back
them up and move them together.

The image declares `/data` as a volume, so Docker mounts an anonymous one if you do not name one.
That keeps your data off the container's writable layer, but an anonymous volume is easy to lose
track of and `docker compose down -v` will take it with everything else. **Name the volume.**

### Filesystem, and why the host matters

This container runs a database and a write-heavy blob store on whatever you mount at `/data`. Both
depend on the kernel honouring `fsync`, file locks and rename atomicity the way a local filesystem
does. That means:

- **A Linux host with a native filesystem — ext4, XFS, ZFS, btrfs — is the only configuration this
  image is meant for.** A named Docker volume on such a host is exactly that. So is a bind mount
  from a directory on one.
- **Docker Desktop on Windows or macOS shares files through virtiofs, gRPC-FUSE or 9p.** Object
  throughput drops to a fraction of the disk's, and Postgres is running on storage whose durability
  guarantees it cannot verify. Use it to try the image out, not to keep anything.
- **WSL2**: keep the volume inside the WSL filesystem (a named Docker volume, or a path under
  `/home/...`). A bind mount reaching into `/mnt/c` crosses the same 9p boundary and is far slower.
- **Network filesystems — NFS, SMB/CIFS — do not work for the Postgres cluster.** If object storage
  has to live on a NAS, run the split deployment instead (see *Beyond one container*) and give
  Postgres local disk.

The container reports what it found on startup and warns when it is one of the slow cases:

```
storage: /data is on ext4
```

---

## Ports

| Port | Service | Why this one |
| --- | --- | --- |
| `4242` | Management UI, and the management API proxied under `/api` | |
| `443` | S3 endpoint | The port AWS serves S3 on, so clients need no port in the endpoint URL |
| `10410` | Management API, directly | Only needed if something other than the UI calls it |

The S3 endpoint speaks plain HTTP. Put a TLS-terminating proxy in front of it in production and
set `S3_PUBLIC_URL` to the address clients actually use — presigned links are built from it, and a
signature is computed over the host, so a mismatch fails the request rather than merely looking
wrong. If 443 is already taken on the host, publish another port (`-p 9000:443`) or move the
listener itself (`-e S3_PORT=9000`).

---

## Required configuration

The container validates these at startup and exits with a list of what is missing rather than
booting with a default that is public knowledge.

| Variable | Minimum | What it protects |
| --- | --- | --- |
| `JWT_SECRET` | 32 chars | Signs management UI sessions — a known value is an admin account |
| `CRYPTOGRAPHIC_PASSWORD` | 32 chars | Encrypts S3 secret keys at rest; they must be recoverable to verify signatures, so they cannot be hashed |
| `STORAGE_ENCRYPTION_KEY` | 32 chars | Wraps every object's data key. Required unless `STORAGE_ENCRYPTION=false` |
| `BOOTSTRAP_ADMIN_PASSWORD` | 12 chars | The admin account created on first boot |
| `S3_PUBLIC_URL` | absolute URL | The origin presigned share links are built against |

```
storage: checking configuration
  [x] JWT_SECRET is not set
  [x] S3_PUBLIC_URL is not set

storage: refusing to start.
```

Do not rotate `STORAGE_ENCRYPTION_KEY` after objects have been written. Encryption is recorded per
object version, so turning encryption on or off is safe at any time — but the key that wrapped a
version's data key has to stay available for as long as that version exists.

---

## All configuration

Everything the applications read from the environment can be set on the container. Defaults are
what the image ships with.

### Addresses and ports

| Variable | Default | |
| --- | --- | --- |
| `WEB_PORT` | `4242` | Port the UI is served on |
| `S3_PORT` | `443` | Port the S3 endpoint listens on |
| `API_PORT` | `10410` | Port the management API listens on |
| `API_PUBLIC_URL` | `/api` | Where the browser calls the management API. Relative keeps it on the UI's origin and needs no CORS; an absolute URL needs `CORS` set |
| `CORS` | — | Comma-separated origins the management API accepts. Only needed with an absolute `API_PUBLIC_URL` |
| `S3_REGION` | `us-east-1` | Region in S3 responses and in the SigV4 credential scope |
| `S3_ENDPOINT_DOMAIN` | — | Base domain for virtual-host style addressing (`<bucket>.<domain>`). Empty means path style only |

### Accounts and sessions

| Variable | Default | |
| --- | --- | --- |
| `BOOTSTRAP_ADMIN_EMAIL` | `admin@storage.local` | Admin account created on first boot |
| `JWT_ACCESS_TTL` | `900` | Access token lifetime, seconds |
| `JWT_REFRESH_TTL` | `2592000` | Refresh token lifetime, seconds |
| `JWT_ISSUER` | `storage` | `iss` claim |

### Storage, uploads and encryption

| Variable | Default | |
| --- | --- | --- |
| `STORAGE_ROOT` | `/data` | The one directory to mount |
| `STORAGE_DATA_PATH` | `/data/objects` | Where payloads are written |
| `STORAGE_ENCRYPTION` | `true` | SSE-S3 at rest. Per version, so it can be changed later |
| `S3_MAX_SINGLE_UPLOAD_BYTES` | `5368709120` | Largest single PUT; bigger objects must use multipart, as in S3 |
| `API_MAX_UPLOAD_BYTES` | `5368709120` | Ceiling on one upload through the management API, enforced while streaming |
| `API_MAX_BODY_BYTES` | `1mb` | Largest JSON/form body. Object payloads bypass the parsers entirely |
| `API_PRESIGN_DEFAULT_SECONDS` | `3600` | Lifetime of a presigned link when the caller does not ask for one |

### Rate limiting

Counted in the embedded Valkey. An unreachable counter store lets requests through rather than
blocking them — it is an accessory, not a dependency.

| Variable | Default | |
| --- | --- | --- |
| `RATE_LIMIT_ENABLED` | `true` | |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Length of the fixed window |
| `RATE_LIMIT_MAX` | `600` | Requests one caller may make per window |

### Garbage collection

Metadata is committed before a blob is deleted, so the store accumulates blobs no row points at.
The sweeper reclaims them and aborts abandoned multipart uploads.

| Variable | Default | |
| --- | --- | --- |
| `GC_ENABLED` | `true` | |
| `GC_CRON` | `17 3 * * *` | Read in `TZ` |
| `GC_MULTIPART_MAX_AGE_HOURS` | `168` | When an unfinished multipart upload is abandoned |
| `GC_BLOB_MIN_AGE_HOURS` | `24` | How old a blob must be to count as orphaned — a payload is written before its row is committed, so a fresh one may be an upload in flight |
| `TZ` | `UTC` | |

### Embedded Postgres

Bound to the container's loopback address and never published. Leave `POSTGRES_PASSWORD` unset and
one is generated on first boot and kept at `/data/.postgres-password`.

| Variable | Default | |
| --- | --- | --- |
| `POSTGRES_DB` | `core` | |
| `POSTGRES_USER` | `postgres` | |
| `POSTGRES_PASSWORD` | generated | Reapplied on every boot, so changing it here changes it |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_POOL` | `8` | Connections each application keeps open |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | |
| `POSTGRES_MAX_CONNECTIONS` | `100` | |
| `POSTGRES_EXTRA_ARGS` | — | Passed to the server verbatim, e.g. `-c work_mem=16MB` |
| `PGDATA` | `/data/postgres` | |

### Embedded Valkey

Run as a cache, not a store: no snapshots, and a ceiling it evicts under rather than grows into
the host.

| Variable | Default | |
| --- | --- | --- |
| `VALKEY_PORT` | `6379` | |
| `VALKEY_PASSWORD` | — | |
| `VALKEY_APPENDONLY` | `no` | |
| `VALKEY_MAXMEMORY` | `128mb` | |
| `VALKEY_MAXMEMORY_POLICY` | `allkeys-lru` | |
| `VALKEY_DATA_PATH` | `/data/valkey` | |

### Web server

| Variable | Default | |
| --- | --- | --- |
| `WEB_WORKER_PROCESSES` | `auto` | |
| `WEB_WORKER_CONNECTIONS` | `1024` | |
| `WEB_ACCESS_LOG` | `off` | `/dev/stdout storage` logs one line per request served |
| `WEB_ERROR_LOG_LEVEL` | `warn` | |
| `WEB_PROXY_TIMEOUT` | `1h` | How long nginx waits on the management API — an upload of several gigabytes is one request |

`NODE_OPTIONS` reaches both applications, if you need to cap heap size on a small host.

---

## Operating it

### Health

| Endpoint | |
| --- | --- |
| `GET :443/_health` | Liveness — the process answers |
| `GET :443/_ready` | Readiness — database reachable and data directory writable, `503` when not |

The image's own `HEALTHCHECK` probes the UI, the management API and `/_ready` together, so
`docker ps` shows `unhealthy` when any one of them is down.

### Logs

One JSON line per finished request from each application, on stdout, with the method, bucket, key,
access key, duration and error code. Startup prints what each service is doing, in order:

```
storage: configuration ok
storage: /data is on ext4
postgres: initialising a new cluster in /data/postgres
postgres: database core ready
api: starting on port 10410
api: ready
s3: starting on port 443
web: UI on port 4242, management API at /api
```

### Backups

Stop the container, copy `/data`, start it again. A copy taken while Postgres is running is a
torn snapshot unless your filesystem can do an atomic one. For a hot backup, `pg_dump` the `core`
database and copy `/data/objects` separately — in that order, so the dump can only be older than
the blobs it names, never newer.

### Tags

| Tag | |
| --- | --- |
| `latest` | the newest stable release |
| `1.2.0`, `1.2` | a release, and the newest patch of that minor |
| `beta` | the newest prerelease. Never the same image as `latest` |
| `1.2.0-beta.1` | one specific prerelease |
| `sha-abc1234` | one specific commit |

A prerelease never moves `latest`, `1.2` or `1`, so following `latest` will not pull a beta.

### Upgrading

Pull the new tag and recreate the container against the same volume. The management API runs the
migrations on start, before it begins listening, and the S3 endpoint waits for it.

The Postgres major version is fixed in the image, because the cluster in the volume is written in
that server's on-disk format. A release that moves to a new major says so in its notes and needs a
dump and restore.

### Shutdown

One `SIGTERM` takes the whole tree down in order, Postgres last and with a fast shutdown. Give it
room — `--stop-timeout 30`, or `stop_grace_period: 30s` in compose — rather than the default ten
seconds.

---

## Security notes

- The S3 endpoint and the management API run as an unprivileged user inside the container. Only
  the supervisor and the database's own init run as root.
- Nothing accepts anonymous access by default. An S3 request without an `Authorization` header is
  anonymous rather than rejected, and whether it may proceed is the bucket policy's decision —
  which, with no policy, is no.
- Postgres and Valkey listen on `127.0.0.1` inside the container and are not published. Note that
  `--network host` makes that the host's loopback: do not use it.
- Both endpoints speak plain HTTP. Terminate TLS in front of them.

---

## Beyond one container

This image trades scale for simplicity, and the trade is one-directional: everything shares a
fate, and it cannot run as more than one instance — Postgres would fork and the blob store would
not. When that stops being acceptable, the same code ships as three separate images (`api`, `s3`,
`web`) that share a Postgres and a data volume, and those do scale horizontally.

---

## Source

Built from `docker/Dockerfile`, target `standalone`. Issues, the split deployment and the full
documentation are in the repository.
