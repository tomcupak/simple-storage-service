# Storage

S3-kompatibilní objektové úložiště — vlastní implementace AWS S3 API včetně SigV4 autentizace
a bucket policies, doplněná o management API a webové rozhraní pro správu uživatelů, přístupů
k bucketům a prohlížení souborů.

## Struktura

```
apps/api      Management API pro UI (JWT, JSON, /v1, Swagger na /swagger)
apps/s3       S3-kompatibilní endpoint (SigV4, XML)
libs/domains  Doménová logika, DTO, moduly sdílené oběma aplikacemi
libs/database Drizzle schéma, migrace a helpery pro integrační testy
libs/shared   Obecné helpery bez doménového kontextu
web           React UI (Vite)
docker        Dockerfile (api / s3 / web / standalone) a supervision tree standalone obrazu
deploy        systemd unity pro nasazení bez kontejnerů
```

## Spuštění

```bash
docker compose up -d      # postgres (10400), valkey (10401)
npm install
npm run env:init          # zkopíruje .env.sample do .env
npm run dev               # api (10410) + s3 (10411)
npm run dev:web           # UI (10412)
```

Pod WSL bez zapnuté WSL integrace Docker Desktopu `docker compose` ani `podman compose` nejsou
k dispozici — kontejnery se pak spustí přímo podmanem. Publikování portů přes `-p` vyžaduje
`net.ipv4.conf.lo.route_localnet=1` (jinak DNAT z loopbacku neprojde); pokud ten sysctl nastavit
nelze, funguje `--network host` s posunutým portem:

```bash
podman volume create storage-postgres-data
podman run -d --name storage-postgres --network host \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -e PGPORT=10400 \
  -v storage-postgres-data:/var/lib/postgresql/data \
  -v "$(pwd)/docker/postgres-init.sh:/docker-entrypoint-initdb.d/init.sh:ro,Z" \
  --restart on-failure postgres:17-alpine
podman run -d --name storage-valkey --network host --restart on-failure \
  valkey/valkey:8-alpine valkey-server --port 10401 --appendonly yes
```

Při prvním startu API spustí migrace a založí admin účet podle `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` (výchozí `admin@storage.local` / `admin12345`) — heslo hned změňte.

## Další příkazy

```bash
npm run db                # vygeneruje novou migraci (zeptá se na název)
npm test                  # jest (unit + DB integrační + E2E proti apps/s3)
npm run lint              # eslint nad apps + libs
npm run lint:web          # eslint nad web
npm run orval:web-storage # vygeneruje API klienta z běžícího API
npm run build             # zabalí obě aplikace do dist/apps/<app>/main.js
```

Testy potřebují běžící Postgres: integrační i E2E testy se připojují do databáze `core_test`
(vytváří ji `docker/postgres-init.sh`). Valkey potřeba není — rate limiting se v testech vypíná.

## S3 endpoint

`apps/s3` mluví S3 protokolem na portu 10411 — path-style (`http://localhost:10411/<bucket>/<key>`)
i virtual-host style, pokud je v `.env` vyplněná `S3_ENDPOINT_DOMAIN` (`<bucket>.<domain>`).
Přihlašuje se SigV4 přes access key vytvořený v UI nebo přes `POST /v1/access-keys`.

Provozní endpointy mimo S3 protokol: `GET /_health` (liveness) a `GET /_ready` (readiness —
kontroluje databázi i zapisovatelnost datového adresáře, vrací 503 když něco chybí). Podtržítko
na začátku není platný název bucketu, takže cesty nekolidují.

## Provoz

- **Šifrování at rest (SSE-S3)** je ve výchozím stavu zapnuté. Každý objekt má vlastní klíč,
  zabalený `STORAGE_ENCRYPTION_KEY`; ten klíč **zálohujte** — bez něj jsou data nečitelná.
  Objekty zapsané před zapnutím šifrování zůstávají čitelné, každá verze si nese svůj způsob
  uložení. Odpovědi hlásí `x-amz-server-side-encryption: AES256`.
- **Rate limiting** počítá requesty ve Valkey (sdíleně přes instance). Nedostupný Valkey
  requesty propouští, ne blokuje.
- **Garbage collector** běží jen v `apps/api` (cron `GC_CRON`): maže bloby, na které už
  neukazuje žádný řádek, a ruší nedokončené multipart uploady starší `GC_MULTIPART_MAX_AGE_HOURS`.
- **Logy** jsou strukturované — jeden JSON řádek na dokončený request (metoda, bucket, klíč,
  access key, doba trvání, chybový kód).

Kompletní seznam proměnných prostředí je v [.env.sample](.env.sample).

## Nasazení

### Standalone kontejner (jeden obraz, celý produkt)

Obě aplikace, UI, Postgres i Valkey v jednom Alpine obrazu — pro nasazení, které chce úložiště,
ne topologii. Procesy hlídá s6-overlay, spouští je v pořadí podle závislostí a jeden SIGTERM je
zase složí.

```bash
docker build -f docker/Dockerfile --target standalone -t storage .

cp .env.standalone.sample .env.standalone   # vyplňte pět povinných hodnot
docker compose -f docker-compose.standalone.yml up -d --build
```

UI běží na **4242** (management API je pod `/api` na stejném originu, takže odpadá CORS),
S3 endpoint na **443** — portu, na kterém S3 provozuje AWS.

Kontejner odmítne nastartovat bez pěti proměnných, které mají v kódu funkční default, a právě
to je problém: `JWT_SECRET`, `CRYPTOGRAPHIC_PASSWORD`, `STORAGE_ENCRYPTION_KEY`,
`BOOTSTRAP_ADMIN_PASSWORD` a `S3_PUBLIC_URL`. Vypíše je všechny najednou a skončí. Ostatní
proměnné z [.env.sample](.env.sample) fungují i tady, plus knoby pro vestavěný Postgres, Valkey
a nginx — kompletní seznam je v [docker/standalone/DOCKERHUB.md](docker/standalone/DOCKERHUB.md).

Všechno perzistentní leží pod jedním rootem `/data` (objekty, Postgres cluster, Valkey), takže
se mountuje a zálohuje jedna věc. **Volume je povinný** a záleží na tom, jaký filesystém pod ním
je: Postgres i blob store potřebují, aby jádro drželo `fsync` a zámky tak, jak to dělá lokální
filesystém. Nativní linuxový FS (ext4, XFS, ZFS) ano — sdílené složky Docker Desktopu na Windows
a macOS (virtiofs, gRPC-FUSE, 9p) ani NFS/SMB ne. Kontejner při startu vypíše, na čem `/data`
leží, a u pomalých případů varuje.

Dokumentace pro Docker Hub je [docker/standalone/DOCKERHUB.md](docker/standalone/DOCKERHUB.md) —
publikuje ji `.github/workflows/release.yml` při vydání a
`.github/workflows/dockerhub-description.yml` při každé změně toho souboru. Popis editovaný ve
webovém UI Docker Hubu tedy příští běh přepíše, což je záměr.

### Oddělené obrazy

Kontejnery — jeden Dockerfile, tři cíle:

```bash
docker build -f docker/Dockerfile --target api -t storage-api .
docker build -f docker/Dockerfile --target s3  -t storage-s3  .
docker build -f docker/Dockerfile --target web -t storage-web .

cp .env.sample .env       # doplňte JWT_SECRET, CRYPTOGRAPHIC_PASSWORD, STORAGE_ENCRYPTION_KEY
docker compose -f docker-compose.prod.yml up -d --build
```

Migrace spouští jen `apps/api`; `apps/s3` schéma očekává hotové a startuje až po něm. Obě
aplikace sdílejí jeden volume s objekty. Adresu API pro prohlížeč nastavíte přes `WEB_API_URL`
(zapíše se do `config.json`, který si UI načítá za běhu).

Bez kontejnerů: `deploy/storage-api.service` a `deploy/storage-s3.service` — postup instalace
je v komentáři na začátku každé unity.

Obrazy staví `.github/workflows/release.yml` při tagu `v*`.

Stav implementace a seznam zbývající práce je v [TODO.MD](TODO.MD), konvence projektu v [CLAUDE.md](CLAUDE.md).
