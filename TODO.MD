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

Hotové: kompletní evaluátor policy dokumentů včetně podmínek, bucket ACL přes S3 i management API.

- [x] `S3AuthorizationService` skládá `EvaluationRequest` (akce z `S3Types.Action`, ARN zdroje)
      a rozhoduje: policy Deny → `AccessDenied`, policy Allow → pustit, jinak fallback na
      vlastnictví bucketu, `bucket_access` granty a `BucketAcl`.
- [x] Podmínky v policy (`Condition`): `IpAddress`/`NotIpAddress` (IPv4 CIDR i IPv4-mapped IPv6),
      `StringEquals`/`StringLike` a jejich negace, `Bool`, `Numeric*`, `Date*`, `Null`, sufix
      `IfExists`. Kontext skládá `S3RequestService.policyContext` (`aws:SourceIp`,
      `aws:SecureTransport`, `aws:Referer`, `aws:UserAgent`, `s3:prefix`, `s3:delimiter`,
      `s3:max-keys`) + `aws:username`/`aws:userid` z identity. Chybějící klíč shodí pozitivní
      operátor a projde u negovaného; neznámý operátor nikdy nematchuje (nerozšíří Allow).
- [x] Anonymní přístup podle `public-read` / `public-read-write` ACL a public policy.
- [x] `BucketAcl`: `GetBucketAcl`/`PutBucketAcl` přes S3 (`x-amz-acl` i XML tělo; grant list, který
      neodpovídá žádnému canned ACL, se odmítne, ne zaokrouhlí) a `PUT /v1/buckets/:name/acl`
      v management API. `x-amz-acl` se respektuje i při `CreateBucket`.
      `GetBucketAcl` vyžaduje `manage` — `public-read` otevírá objekty, ne konfiguraci přístupu.
- [x] Object ACL — **nepodporuje se**. Per-objektové ACL by znamenalo druhý autorizační model
      vedle policy + `bucket_access`; `?acl` na klíči vrací `NotImplemented`
      (hlídá `S3RequestService.objectSubResource`).
- [x] Testy: matice akce × principal × resource (`policies.service.spec.ts`), podmínky,
      `s3.authorization.service.spec.ts` (ACL fallback, granty, Deny, kontext podmínek).

## 4. Management API [API] [DOM]

Hotové: kompletní správa objektů (upload/download/mazání/složky/kopie/presign), detail a nastavení
bucketu, statistiky, kvóty, správa uživatelů, audit log, paginace.

- [x] Upload souboru z UI — `PUT /v1/buckets/:name/objects?key=`, tělo requestu je přímo payload
      (ne multipart/form-data: ten by se musel nejdřív naparsovat, takhle jde stream rovnou na disk
      a prohlížeč umí progress přes XHR). `apps/api` proto startuje s `bodyParser: false` a parsery
      registruje ručně mimo `config.body.rawPathPattern`.
      Download: `GET .../objects/download?key=&versionId=` se streamem a `Content-Disposition`
      (ASCII i RFC 5987 varianta jména).
- [x] Mazání objektů a složek — `DELETE .../objects?key=` nebo `?prefix=` (rekurzivně).
      Prázdný prefix se odmítá, aby se bucket nevysypal omylem.
- [x] Vytvoření složky (`POST .../objects/folder`, prázdný objekt `application/x-directory`)
      a kopie/přejmenování (`POST .../objects/copy`, `move: true` = přesun; zdrojový klíč
      končící `/` překlíčuje celou složku, včetně pojistky proti přesunu složky do sebe).
- [x] Presigned URL — `POST .../objects/presign`. Podepisuje se **vlastním access klíčem volajícího**
      (`S3SignatureService.presign`), takže odkaz nese přesně jeho oprávnění; management session
      pro S3 endpoint nic neznamená. Bez aktivního klíče vrací `no_usable_access_key`.
- [x] Detail bucketu — `GET /v1/buckets/:name` vrací i `usage`; `PUT .../acl`, `PUT .../versioning`
      (zpět na `disabled` se nedá, jako v S3), `PUT .../quota`, `GET .../usage`.
- [x] Statistiky — `GET /v1/usage/buckets` (adminovi vše, ostatním jen jejich buckety)
      a `GET /v1/usage/users`. Počítají se z metadat při každém volání, ne inkrementálně.
- [x] Kvóty na bucket i uživatele (`quota_bytes`), kontrola v `ObjectsService.put` a `uploadPart` —
      předem podle `Content-Length`, po zápisu ještě jednou podle skutečné velikosti.
      Nad S3 API se hlásí jako `EntityTooLarge`, nad management API jako `bucket_quota_exceeded`.
- [x] Editace uživatele (`PATCH /v1/users/:guid`), deaktivace bez smazání
      (`PUT .../status`, `user_status_type`) a `PUT .../quota`. Posledního aktivního admina nelze
      degradovat ani vypnout; zablokovaný účet neprojde loginem ani refreshem.
- [x] Audit log — tabulka `audit_log`, dekorátor `@Audited(...)` + `AuditInterceptor`,
      výpis `GET /v1/audit` (stránkovaný, s filtry) a `GET /v1/audit/actions`.
- [x] Paginace u výpisů uživatelů a klíčů (`Api.PagingQuery`).

Vedlejší úprava: `ApiExceptionFilter` (globální, po vzoru `S3ExceptionFilter`) mapuje doménové chyby
na HTTP status + `{ code }`, takže handlery už nemusí obalovat volání služeb do try/catch.

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

- [ ] Testy: `S3SignatureService` proti oficiálním AWS test vektorům (dnes je pokrytý jen presign
      round-trip podepsat → ověřit), `StorageService` (write/read/range/concat),
      `BucketsService` a `ObjectsService` (DB integrační testy proti `core_test`).
      Hotovo: `S3ChunkedStream`, `S3RequestService`, `PoliciesService` (matice + podmínky),
      `S3AuthorizationService`, `UsageService` (kvóty) a guardy `ObjectsService` (klíče, prefixy, kopie).
- [ ] E2E test proti `apps/s3` skutečným AWS SDK klientem (`@aws-sdk/client-s3`) — hlavní scénáře.
- [ ] Helpery pro migrace a truncate v `@storage/database` (`libs/database/src/testing`) — zatím neexistují.
- [ ] Health/readiness endpoint pro `apps/s3` (dnes má jen `apps/api`).
- [ ] Strukturované logování requestů (metoda, bucket, klíč, access key, doba trvání).
- [ ] Rate limiting a limity velikosti requestů (redis je připravený v docker-compose, ale nepoužitý).
- [ ] Garbage collector osiřelých blobů (verze smazané z DB, nedokončené multipart uploady starší N dní).
- [ ] Deployment: Dockerfile / systemd unit, build pipeline, konfigurace přes env.
- [ ] Šifrování objektů at rest (SSE-S3) a `x-amz-server-side-encryption` hlavičky.
- security audit (hlavně EPs)

## 7. Poznámky a úpravy
- vyměňme Redis za valkey (redis knihovna je kompatibilní)

