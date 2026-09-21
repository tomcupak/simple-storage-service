# TODO

Stav po iteraci 3: S3 i management API jsou funkčně hotové, doplněné o provozní vrstvu —
health/readiness, strukturované logování, rate limiting nad Valkey, garbage collector osiřelých
blobů, šifrování objektů at rest (SSE-S3) a nasazovací artefakty (Dockerfile, systemd, release
pipeline). Testy pokrývají SigV4 proti AWS, blob store, DB integraci i E2E proti `apps/s3`
skutečným AWS SDK klientem. Níže je to, co zbývá.

Legenda: **[S3]** = S3-kompatibilní API (`apps/s3`), **[API]** = management API (`apps/api`),
**[UI]** = webové rozhraní (`web/apps/storage`), **[DOM]** = doménová logika (`libs/domains`).

---

## 1. Rozjetí vývojového prostředí

- [x] Podman servisky (`storage-postgres` na 10400, `storage-valkey` na 10401). WSL integrace
      Docker Desktopu není potřeba — kontejnery běží přímo pod podmanem, `podman compose` ale
      bez ní nefunguje, takže se spouští `podman run` (viz README). Publikování portů přes `-p`
      navíc potřebuje `net.ipv4.conf.lo.route_localnet=1`; bez něj se použije `--network host`
      s posunutým portem (`PGPORT`, `--port`).
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
- [x] Endpoint pro rozpad `userGuid` → e-mail dostupný i správci bucketu:
      `GET /v1/buckets/:name/users` vyžaduje `manage` na daném bucketu a vrací jen
      `{ guid, email, name }` — bez rolí, kvót a časů přihlášení, které zůstávají adminům.
      UI díky tomu umí přístupy editovat i neadminovi.

Vedlejší úprava: `ApiExceptionFilter` (globální, po vzoru `S3ExceptionFilter`) mapuje doménové chyby
na HTTP status + `{ code }`, takže handlery už nemusí obalovat volání služeb do try/catch.

## 5. UI [UI]

Hotové: kompletní správce souborů (upload/download/náhled/sdílení/kopie/mazání), detail bucketu
v záložkách, i18n cs/en, hlášení chyb podle `code`.

- [x] Upload — drag & drop i výběr, více souborů naráz, progress bar per soubor
      (`UploadPanel`). Nahrává se sekvenčně: bajty tečou rovnou na disk, šest paralelních PUTů
      by jen zpomalilo každý z nich a rozbilo smysl progress baru.
      Download přes `transfer.ts` (blob + `saveBlob`), protože generovaný klient neumí
      `responseType: 'blob'` ani `onUploadProgress`.
- [x] Mazání souborů i složek (rekurzivně), vytvoření složky, kopírování a přesun/přejmenování
      (`CopyMoveDialog` — jeden dialog pro obojí, zdroj končící `/` překlíčuje celou složku).
- [x] Náhled obrázků, textu a PDF (`ObjectPreview`, strop 5 MB) a kopírování presigned odkazu
      (`ShareLinkDialog` s volbou platnosti 1 h / 1 den / 7 dní).
- [x] Stránkování prohlížeče přes `continuationToken` (zásobník tokenů → funguje i Předchozí)
      a řazení sloupců. Řazení je vědomě jen v rámci strany — API vydává klíče v bajtovém pořadí
      a token je na to pořadí navázaný, takže globální řazení by znamenalo stáhnout celý bucket.
- [x] Správa přístupů k bucketu (`BucketAccess`) — checkboxy per `BucketPermission`.
      **Omezení:** editace vyžaduje seznam uživatelů, a `GET /v1/users` je jen pro adminy;
      neadmin proto vidí granty read-only (viz TODO v sekci 4 níže).
- [x] Editor bucket policy s validací JSON a šablonami (veřejné čtení, uživatel jen pro čtení,
      vyžadovat HTTPS). Prázdný editor + Uložit = smazání policy.
- [x] Detail bucketu v záložkách (Soubory / Nastavení / Přístupy / Policy): verzování, ACL,
      kvóta, statistiky, historie verzí objektu (`ObjectVersions` — stažení i trvalé smazání verze).
- [x] Profil uživatele se změnou hesla, obsazeným místem a přepínačem jazyka.
- [x] Hlášení chyb podle `code` — `apiErrorKey` mapuje `{ code }` na překlad, neznámý kód spadne
      na obecnou hlášku místo aby prosákl syrový identifikátor.
- [x] i18n (cs/en) — čeština je zdroj pravdy, `en` je `Record<TranslationKey, string>`, takže
      chybějící překlad shodí build. Jazyk se detekuje z prohlížeče a drží v `localStorage`.
- [x] Favicon (SVG), `manifest.webmanifest`, prázdné stavy (`EmptyState`) a skeletony
      (`TableSkeleton`/`BlockSkeleton`, s respektem k `prefers-reduced-motion`).

## 6. Kvalita a provoz

- [x] Testy: `S3SignatureService` proti AWS (`s3.signature.vectors.spec.ts` — kanonický request
      z publikovaného `aws-sig-v4-test-suite` vektoru, podpisy z `@smithy/signature-v4`),
      `StorageService` (write/read/range/concat, šifrování, `maxBytes`, `listBlobs`),
      `BucketsService`, `ObjectsService` a `UsersService` (DB integrační testy proti `core_test`).
      Dohromady 285 testů.
- [x] E2E test proti `apps/s3` skutečným AWS SDK klientem (`@aws-sdk/client-s3`) — buckety,
      objekty, rozsahy, verzování, multipart, presigned URL, autorizace, health.
      **Našel reálnou chybu:** kanonický query string se řadil `localeCompare` místo po bajtech,
      takže každý presigned odkaz z AWS SDK (`x-id`, `x-amz-checksum-mode` vedle `X-Amz-*`)
      končil na 403. Opraveno, regresní test je i v unit suite.
- [x] Helpery pro migrace a truncate v `@storage/database/testing` — `TestDatabase` (migrace
      jednou na worker, `truncate`) a `TestSeed` (jen FK prerekvizity, vrací vložený řádek).
- [x] Health/readiness endpoint pro `apps/s3` — `GET /_health` a `GET /_ready` (databáze +
      zapisovatelnost datového adresáře, 503 když něco chybí). Podtržítko není platný název
      bucketu, takže cesty nekolidují s `/:bucket`.
- [x] Strukturované logování requestů — `RequestLogService` v `@storage/shared`, jeden JSON
      řádek na dokončený request (metoda, cesta, status, bucket, klíč, access key, uživatel,
      IP, bajty, doba trvání, chybový kód). Zapisuje se na `res.on('finish')`, protože payloady
      se streamují a handler skončí dřív než poslední bajt.
- [x] Rate limiting a limity velikosti requestů — `RateLimitService` počítá ve Valkey (fixní
      okno, `INCR` + `EXPIRE`), S3 vrací `SlowDown`, management `{ code: 'rate_limited' }`.
      Nedostupný Valkey requesty propouští. `S3_MAX_SINGLE_UPLOAD_BYTES` / `API_MAX_UPLOAD_BYTES`
      se nově opravdu vynucují — i za běhu streamu, ne jen proti ohlášené `Content-Length`.
- [x] Garbage collector osiřelých blobů — `libs/domains/src/gc`, cron jen v `apps/api`. Maže
      bloby, na které neukazuje žádný řádek (mladší než `GC_BLOB_MIN_AGE_HOURS` vynechává, aby
      nesmazal probíhající upload), a ruší multipart uploady starší `GC_MULTIPART_MAX_AGE_HOURS`.
- [x] Deployment: `docker/Dockerfile` (cíle `api` / `s3` / `web`), `docker-compose.prod.yml`,
      systemd unity v `deploy/`, `.github/workflows/release.yml` staví obrazy na tagu `v*`.
      Konfigurace kompletně přes env — viz `.env.sample`.
      **Vedlejší nález:** `npm run build` byl `nest build`, což v tomhle monorepu bez výchozího
      projektu nevyrobí nic — CI build krok procházel naprázdno. Teď staví obě aplikace.
- [x] Šifrování objektů at rest (SSE-S3) a `x-amz-server-side-encryption` hlavičky — vlastní
      klíč na objekt, zabalený `STORAGE_ENCRYPTION_KEY`, zaznamenaný per verzi (`encryption`,
      `encryption_key`), takže zapnutí/vypnutí nerozbije už uložená data. Payload šifruje
      AES-256-CTR, aby `Range` zůstal úměrný rozsahu; klíče se balí GCM.
- [x] Security audit endpointů. Všechny mají explicitní `@PublicEp()` / `@SecuredEp()` a objektové
      i bucketové operace resolvují bucket s konkrétním oprávněním. Dva reálné nálezy, oba opravené:
      - změna vlastního hesla nevyžadovala současné heslo (ukradený access token stačil na převzetí
        účtu) — `PUT /v1/users/:guid/password` ho teď u self-service změny vyžaduje,
      - změna hesla nerušila existující sessions, takže útočníkův refresh token přežil reset —
        teď se všechny sessions účtu revokují.

      Zbytek prověřen bez nálezu: vlastnictví access keys, `getForUser` hlásí nepřístupný bucket
      jako 404 (nejdou enumerovat), hesla scrypt + `timingSafeEqual`, rotace refresh tokenů,
      kontrola `type: 'access'` v JWT, redakce citlivých polí v audit logu, zákaz degradace
      posledního admina.

## 7. Poznámky a úpravy

- [x] Redis vyměněn za Valkey (`valkey/valkey:8-alpine`, klient `redis` je protokolově
      kompatibilní). Proměnné se jmenují `VALKEY_HOST` / `VALKEY_PORT` / `VALKEY_PASSWORD`.
- [x] Angličtina je default jazyk v UI. Jazyk prohlížeče se už nedetekuje — UI mluví anglicky,
      dokud si uživatel nevybere jinak, a do `localStorage` se ukládá jen ta explicitní volba
      (default zůstane nezapsaný, aby šel později změnit).

---

## 8. Co zbývá

- [ ] Rotace `STORAGE_ENCRYPTION_KEY` — dnes by znamenala, že se starý klíč nesmí zahodit.
      Přebalení uložených klíčů (re-wrap) není implementované.
- [ ] Per-bucket konfigurace šifrování (`PutBucketEncryption`) — dnes je šifrování volba
      nasazení, ne bucketu, a `?encryption` vrací `NotImplemented`.
- [ ] Swagger je na `/swagger` veřejně; v produkci by se hodil přepínač na vypnutí.
- [ ] Rate limiting nepočítá requesty odmítnuté `AuthGuard`em (špatný token), protože guard běží
      první. Pro brute-force hesel to nevadí (login je `@PublicEp()`), pro hádání tokenů ano.
