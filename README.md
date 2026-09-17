# Storage

S3-kompatibilní objektové úložiště — vlastní implementace AWS S3 API včetně SigV4 autentizace
a bucket policies, doplněná o management API a webové rozhraní pro správu uživatelů, přístupů
k bucketům a prohlížení souborů.

## Struktura

```
apps/api      Management API pro UI (JWT, JSON, /v1, Swagger na /swagger)
apps/s3       S3-kompatibilní endpoint (SigV4, XML)
libs/domains  Doménová logika, DTO, moduly sdílené oběma aplikacemi
libs/database Drizzle schéma a migrace
libs/shared   Obecné helpery bez doménového kontextu
web           React UI (Vite)
```

## Spuštění

```bash
docker compose up -d      # postgres (10400), redis (10401)
npm install
npm run env:init          # zkopíruje .env.sample do .env
npm run dev               # api (10410) + s3 (10411)
npm run dev:web           # UI (10412)
```

Při prvním startu API spustí migrace a založí admin účet podle `BOOTSTRAP_ADMIN_EMAIL` /
`BOOTSTRAP_ADMIN_PASSWORD` (výchozí `admin@storage.local` / `admin12345`) — heslo hned změňte.

## Další příkazy

```bash
npm run db                # vygeneruje novou migraci (zeptá se na název)
npm test                  # jest
npm run lint              # eslint nad apps + libs
npm run lint:web          # eslint nad web
npm run orval:web-storage # vygeneruje API klienta z běžícího API
```

Stav implementace a seznam zbývající práce je v [TODO.MD](TODO.MD), konvence projektu v [CLAUDE.md](CLAUDE.md).
