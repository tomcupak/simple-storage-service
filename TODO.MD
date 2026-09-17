# TODO

Stav po iteraci 1: stojí monorepo, obě BE aplikace se buildí a startují, UI se buildí, DB schéma
a první migrace jsou vygenerované. Níže je to, co zbývá doimplementovat k funkčnímu API a UI.

Legenda: **[S3]** = S3-kompatibilní API (`apps/s3`), **[API]** = management API (`apps/api`),
**[UI]** = webové rozhraní (`web/apps/storage`), **[DOM]** = doménová logika (`libs/domains`).

---

## 1. Rozjetí vývojového prostředí

- [ ] Zapnout WSL integraci v Docker Desktop (v této distribuci `docker` nebyl dostupný), pak
      `docker compose up -d` — postgres (10400) + redis (10401).
- [ ] `npm run env:init` a doplnit `.env` (hlavně `JWT_SECRET`, `CRYPTOGRAPHIC_PASSWORD`).
- [ ] První start `npm run dev:api` — automaticky spustí migrace a založí bootstrap admina
      (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`, výchozí `admin@storage.local` / `admin12345`).
- [ ] Vygenerovat Orval klienta: `npm run orval:web-storage` (vyžaduje běžící API) a nahradit jím
      ruční `web/apps/storage/src/api/client.ts`.
- [ ] CI: lint + testy + build (zatím není).

## 2. S3 API — objektové operace [S3] [DOM]

Hotové: SigV4 ověření, XML kodek, chybový filtr, `ListBuckets`.

- [ ] Routing pro path-style (`/:bucket/*key`) i virtual-host style (`<bucket>.<S3_ENDPOINT_DOMAIN>`)
      — middleware, který z hostname vytáhne bucket a přepíše request na path-style.
- [ ] `CreateBucket` (PUT /:bucket), `DeleteBucket`, `HeadBucket`, `GetBucketLocation`.
- [ ] `ListObjectsV2` (prefix, delimiter, max-keys, continuation-token, start-after) + `ListObjects` (v1).
- [ ] `PutObject` — stream do `StorageService`, zápis `object` + `object_version`, ETag, `Content-MD5`
      kontrola, `x-amz-meta-*` metadata, `x-amz-storage-class`.
- [ ] `GetObject` — `Range` requesty (206), podmíněné hlavičky (`If-None-Match`, `If-Modified-Since`),
      `?versionId=`, response-override query parametry.
- [ ] `HeadObject`, `DeleteObject` (delete marker u verzovaného bucketu), `DeleteObjects` (POST ?delete).
- [ ] `CopyObject` (`x-amz-copy-source`), včetně copy mezi buckety a metadata directive.
- [ ] Multipart upload: `CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`, `CompleteMultipartUpload`
      (přes `StorageService.concat`, multipart ETag `-N`), `AbortMultipartUpload`, `ListParts`,
      `ListMultipartUploads`.
- [ ] Verzování: `PutBucketVersioning` / `GetBucketVersioning`, `ListObjectVersions`,
      mazání konkrétní verze, chování `suspended` stavu.
- [ ] `GetBucketPolicy` / `PutBucketPolicy` / `DeleteBucketPolicy` přes S3 API (JSON body).
- [ ] Presigned URL (`X-Amz-Algorithm` v query, `X-Amz-Expires`) — ověření podpisu z query stringu.
- [ ] `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` — dekódování chunked signed body (AWS CLI ho posílá defaultně).
- [ ] CORS konfigurace bucketu (`GetBucketCors`/`PutBucketCors`) a obsluha preflightu.
- [ ] Neimplementované operace vracet jako `NotImplemented`, ne 404.

## 3. Autorizace a policies [DOM] [S3]

Hotové: evaluátor policy dokumentů (Allow/Deny/wildcards/NotAction/NotResource) + validace.

- [ ] Guard/interceptor, který pro každý S3 request složí `EvaluationRequest` (akce podle HTTP metody
      a query parametru, ARN zdroje) a rozhodne: policy Deny → `AccessDenied`, policy Allow → pustit,
      jinak fallback na vlastnictví bucketu a `BucketAcl`.
- [ ] Podmínky v policy (`Condition`): `IpAddress`, `StringEquals`, `StringLike`, `Bool aws:SecureTransport`,
      `s3:prefix`, `s3:max-keys` — dnes se `Condition` ignoruje.
- [ ] Anonymní přístup podle `public-read` / `public-read-write` ACL a public policy.
- [ ] Object ACL (`GetObjectAcl`/`PutObjectAcl`) — rozhodnout, zda podporovat, nebo vracet `NotImplemented`.
- [ ] Testy: matice akce × principal × resource proti referenčním AWS příkladům.

## 4. Management API [API] [DOM]

Hotové: login/refresh/logout/me, uživatelé (list/create/password/delete), buckety (list/create/delete/grants),
access keys (list/create/status/delete), policy (get/put/delete), výpis objektů a verzí.

- [ ] Upload souboru z UI (`POST /v1/buckets/:name/objects`, multipart/form-data → `StorageService`)
      a download (`GET .../objects/download?key=`), včetně streamování a `Content-Disposition`.
- [ ] Mazání objektů a složek (rekurzivní mazání podle prefixu) z UI.
- [ ] Vytvoření „složky" (prázdný objekt končící `/`) a přejmenování/kopie objektu.
- [ ] Generování presigned URL pro sdílení souboru z UI.
- [ ] Detail bucketu: velikost a počet objektů, nastavení verzování, ACL, region.
- [ ] Statistiky: obsazené místo per bucket / per uživatel (podklad pro kvóty).
- [ ] Kvóty na bucket a uživatele (sloupce v DB + kontrola při `PutObject`).
- [ ] Editace uživatele (jméno, role), deaktivace bez smazání.
- [ ] Audit log operací (kdo, kdy, co) + endpoint pro jeho výpis.
- [ ] Paginace u výpisů uživatelů a klíčů (`Api.PagingQuery` už je k dispozici).

## 5. UI [UI]

Hotové: login, layout, seznam bucketů, jednoduchý prohlížeč (prefixy + soubory), access keys, uživatelé.

- [ ] Upload souborů (drag & drop, progress, více souborů naráz) a download.
- [ ] Mazání souborů/složek, vytvoření složky, kopírování/přesun.
- [ ] Náhled souborů (obrázky, text, PDF) a kopírování presigned odkazu.
- [ ] Stránkování prohlížeče (`continuationToken`) a řazení sloupců.
- [ ] Správa přístupů k bucketu: modál s uživateli a jejich `BucketPermission` (API už existuje).
- [ ] Editor bucket policy (JSON textarea s validací + předpřipravené šablony: public read, read-only uživatel).
- [ ] Detail bucketu: verzování, ACL, statistiky, historie verzí objektu.
- [ ] Změna vlastního hesla a profil uživatele.
- [ ] Hlášení chyb z API podle `code` (dnes se ukazují obecné hlášky).
- [ ] i18n (cs/en) — texty jsou zatím natvrdo česky v komponentách.
- [ ] Favicon, manifest, prázdné stavy, loading skeletony.

## 6. Kvalita a provoz

- [ ] Testy: `S3SignatureService` proti oficiálním AWS test vektorům, `StorageService` (write/read/range/concat),
      `BucketsService` a `ObjectsService` (DB integrační testy proti `core_test`).
- [ ] E2E test proti `apps/s3` skutečným AWS SDK klientem (`@aws-sdk/client-s3`) — hlavní scénáře.
- [ ] Helpery pro migrace a truncate v `@storage/database` (`libs/database/src/testing`) — zatím neexistují.
- [ ] Health/readiness endpoint pro `apps/s3` (dnes má jen `apps/api`).
- [ ] Strukturované logování requestů (metoda, bucket, klíč, access key, doba trvání).
- [ ] Rate limiting a limity velikosti requestů (redis je připravený v docker-compose, ale nepoužitý).
- [ ] Garbage collector osiřelých blobů (verze smazané z DB, nedokončené multipart uploady starší N dní).
- [ ] Deployment: Dockerfile / systemd unit, build pipeline, konfigurace přes env.
- [ ] Šifrování objektů at rest (SSE-S3) a `x-amz-server-side-encryption` hlavičky.
