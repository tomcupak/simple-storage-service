# TODO

Stav po iteraci 2: vývojové prostředí běží (podman, migrace, bootstrap admin, Orval klient, CI),
S3 API umí kompletní objektové operace včetně multipartu, verzování, presigned URL a CORS.
Níže je to, co zbývá doimplementovat k funkčnímu API a UI.

Legenda: **[S3]** = S3-kompatibilní API (`apps/s3`), **[API]** = management API (`apps/api`),
**[UI]** = webové rozhraní (`web/apps/storage`), **[DOM]** = doménová logika (`libs/domains`).

---

## 1. Rozjetí vývojového prostředí

- [x] Podman servisky (`storage-postgres` na 10400, `storage-redis` na 10401). WSL integrace
      Docker Desktopu není potřeba — kontejnery běží přímo pod podmanem, `podman compose` ale
      bez ní nefunguje, takže se spouští `podman run` (viz README).
- [x] `.env` doplněn — `JWT_SECRET` a `CRYPTOGRAPHIC_PASSWORD` vygenerované náhodně.
- [x] První start `npm run dev:api` — migrace proběhly, bootstrap admin založen
      (`admin@storage.local` / `admin12345`).
- [x] Orval klient vygenerován do `web/apps/storage/src/api/schema/`; `client.ts` je nad ním už jen
      tenká fasáda (krátké aliasy operací + reexport typů).
- [x] CI: `.github/workflows/ci.yml` — lint (BE i web), testy, build BE i webu, Postgres service.

## 2. S3 API — objektové operace [S3] [DOM]

Hotové: SigV4 (hlavička i presigned), XML kodek, chybový filtr, kompletní bucket i objektové operace.

- [x] Routing pro path-style (`/:bucket/*key`) i virtual-host style (`<bucket>.<S3_ENDPOINT_DOMAIN>`)
      — `S3VirtualHostMiddleware` přepisuje `req.url`, `req.originalUrl` zůstává pro SigV4.
- [x] `CreateBucket` (PUT /:bucket), `DeleteBucket`, `HeadBucket`, `GetBucketLocation`.
- [x] `ListObjectsV2` (prefix, delimiter, max-keys, continuation-token, start-after) + `ListObjects` (v1).
- [x] `PutObject` — stream do `StorageService`, zápis `object` + `object_version`, ETag, `Content-MD5`
      kontrola, `x-amz-meta-*` metadata. `x-amz-storage-class` se přijímá, ale ukládá se vždy
      `STANDARD` (jiná třída v DB enumu neexistuje).
- [x] `GetObject` — `Range` requesty (206), podmíněné hlavičky (`If-Match`/`If-None-Match`/
      `If-Modified-Since`/`If-Unmodified-Since`), `?versionId=`, response-override query parametry.
- [x] `HeadObject`, `DeleteObject` (delete marker u verzovaného bucketu), `DeleteObjects` (POST ?delete).
- [x] `CopyObject` (`x-amz-copy-source`), včetně copy mezi buckety a metadata directive.
- [x] Multipart upload: `CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`, `CompleteMultipartUpload`
      (přes `StorageService.concat`, multipart ETag `-N`), `AbortMultipartUpload`, `ListParts`,
      `ListMultipartUploads`.
- [x] Verzování: `PutBucketVersioning` / `GetBucketVersioning`, `ListObjectVersions`,
      mazání konkrétní verze, chování `suspended` stavu.
- [x] `GetBucketPolicy` / `PutBucketPolicy` / `DeleteBucketPolicy` přes S3 API (JSON body).
- [x] Presigned URL (`X-Amz-Algorithm` v query, `X-Amz-Expires`) — ověření podpisu z query stringu.
- [x] `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` — `S3ChunkedStream` dekóduje a zároveň ověřuje podpis
      každého chunku; podporován i `STREAMING-UNSIGNED-PAYLOAD-TRAILER`.
- [x] CORS konfigurace bucketu (`GetBucketCors`/`PutBucketCors`/`DeleteBucketCors`) a preflight (OPTIONS).
- [x] Neimplementované operace vracet jako `NotImplemented`, ne 404 (`S3Types.UNIMPLEMENTED_SUBRESOURCES`).

## 3. Autorizace a policies [DOM] [S3]

Hotové: evaluátor policy dokumentů (Allow/Deny/wildcards/NotAction/NotResource) + validace.

- [x] `S3AuthorizationService` skládá `EvaluationRequest` (akce z `S3Types.Action`, ARN zdroje)
      a rozhoduje: policy Deny → `AccessDenied`, policy Allow → pustit, jinak fallback na
      vlastnictví bucketu, `bucket_access` granty a `BucketAcl`.
- [ ] Podmínky v policy (`Condition`): `IpAddress`, `StringEquals`, `StringLike`, `Bool aws:SecureTransport`,
      `s3:prefix`, `s3:max-keys` — dnes se `Condition` ignoruje.
- [x] Anonymní přístup podle `public-read` / `public-read-write` ACL a public policy.
- [ ] Endpoint pro nastavení `BucketAcl` (dnes se dá měnit jen přímo v DB, `?acl` vrací `NotImplemented`).
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
      Hotovo: `S3ChunkedStream` a `S3RequestService` (parsování rozsahů, podmínek, copy-source).
- [ ] E2E test proti `apps/s3` skutečným AWS SDK klientem (`@aws-sdk/client-s3`) — hlavní scénáře.
- [ ] Helpery pro migrace a truncate v `@storage/database` (`libs/database/src/testing`) — zatím neexistují.
- [ ] Health/readiness endpoint pro `apps/s3` (dnes má jen `apps/api`).
- [ ] Strukturované logování requestů (metoda, bucket, klíč, access key, doba trvání).
- [ ] Rate limiting a limity velikosti requestů (redis je připravený v docker-compose, ale nepoužitý).
- [ ] Garbage collector osiřelých blobů (verze smazané z DB, nedokončené multipart uploady starší N dní).
- [ ] Deployment: Dockerfile / systemd unit, build pipeline, konfigurace přes env.
- [ ] Šifrování objektů at rest (SSE-S3) a `x-amz-server-side-encryption` hlavičky.
