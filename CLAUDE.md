# Meta

This file is the source of truth for project conventions. Keep it compact — prose over code examples (code is in the repo), orientation points over exhaustive lists. Update it proactively when you discover a new convention, correct an outdated rule, or find that something here was wrong.

---

# What this project is

An S3-compatible object storage server: an AWS S3 clone with the S3 REST API, SigV4 authentication,
bucket policies, plus a management API and web UI for users, bucket access and a file browser.

---

# Architecture: apps and libs/domains

Apps communicate with each other only over HTTP — never via direct imports of each other's code.

- `apps/api` — management API for the web UI (JWT auth, JSON, versioned `/v1` routes, Swagger).
- `apps/s3` — the S3-compatible endpoint (SigV4 auth, XML, no versioning prefix, AWS route shapes).

They are separate apps because their auth, wire format and error contract have nothing in common:
the S3 app must answer every failure with an S3 `<Error>` XML document, the management API with
`{ code }` JSON. Both read and write the same Postgres database and the same blob store.

`libs/domains` contains **shared business logic and infrastructure** used by both apps: services,
NestJS modules, DTOs, types, auth decorators/guards. Apps keep their logic in `libs/domains` rather
than in the app itself; an app directory holds only controllers, guards, wiring and config.

- `libs/database` — Drizzle schema, migrations, `DbProvider`/`DbModule`.
- `libs/shared` — framework-level helpers without domain context (`Api.createErrorDto`, pagination).

# Object data vs. metadata

Metadata (buckets, keys, versions, sizes, ETags, policies) lives in Postgres. Payload bytes live on
the filesystem under `STORAGE_DATA_PATH`, addressed by the opaque `storagePath` stored on
`object_version` / `multipart_part`. `StorageService` (`libs/domains/src/storage`) is the only code
that touches the filesystem; it never reads the database, and services never build paths themselves.

Payloads are always streamed, never buffered — the S3 app runs with `bodyParser: false` so object
bodies reach the storage service as a raw stream, and SigV4 verification sees the bytes as sent.

# S3 API conventions

- Every response, including errors, is XML built through `S3XmlService`.
- Domain errors reaching the S3 app are translated into `S3Exception` with an S3 error code from
  `S3Types.ErrorCodes`; `S3ExceptionFilter` renders them. Never let a Nest JSON error escape.
  The filter owns the domain-error → S3-code table (`DOMAIN_ERRORS`), so handlers do not wrap
  service calls in try/catch just to remap an error - add the mapping there instead.
- Authentication is SigV4 (`S3SignatureService` + `S3Guard`), which puts a `S3Types.RequestIdentity`
  on `res.locals.s3`. A request without an `Authorization` header is anonymous, not rejected —
  whether it may proceed is the bucket policy's decision.
- Authorisation on the S3 side runs through `S3AuthorizationService`: the bucket policy decides
  first (Deny wins, then Allow), and only when no statement matches does it fall back to bucket
  ownership, the `bucket_access` grants and the canned `BucketAcl`. Handlers call
  `resolveBucket({ req, name, identity, action, key })`, which resolves and authorises in one step.
  `req` is what lets `Condition` blocks be evaluated - leave it out and every request-bound
  condition key (`aws:SourceIp`, `aws:SecureTransport`, `s3:prefix`, ...) counts as missing.
- `Condition` evaluation lives in `PoliciesService`. A missing context key fails a positive
  operator and satisfies a negated one (`StringNotEquals`, `NotIpAddress`, ...); an operator the
  service does not implement never matches, so an unrecognised condition cannot widen an Allow.
- Only canned ACLs (`BucketAcl`) exist, and only on buckets. `PutBucketAcl` takes `x-amz-acl` or
  an XML body that reduces to one canned value - a grant list that does not is rejected rather
  than rounded down. Objects have no ACL: `?acl` on an object key is `NotImplemented`, which
  `S3RequestService.objectSubResource` is there to enforce.

## Routing and request shaping

S3 selects operations by HTTP verb plus a `?subresource` query parameter, which Nest cannot route
on. There is therefore exactly one handler per verb on each of the two controllers
(`S3BucketControllerV1` for `/:bucket`, `S3ObjectControllerV1` for `/:bucket/*key`), and the handler
dispatches on `S3RequestService.subResource(req)`. Every handler must call it - that is what turns
`?acl`, `?tagging` and the rest into `NotImplemented` instead of a wrong success.

Handlers take `@Res()` and write the response themselves (Nest would answer a POST with 201; S3
always uses 200). Request parsing lives in `S3RequestService`, response bodies and headers in
`S3ResponseService` - controllers hold no helpers.

Virtual-host style requests are rewritten to path style by `S3VirtualHostMiddleware`, which only
touches `req.url`: SigV4 canonicalisation reads `req.originalUrl`, i.e. the path the client signed.

## Listing and key order

S3 orders keys by raw UTF-8 bytes, which is not what the database's locale collation does, so every
key comparison in `ObjectsService` is forced to `COLLATE "C"`. Keys and common prefixes both count
towards `max-keys`, so a page is assembled batch by batch: emitting a folder skips everything inside
it, and the continuation token records whether the page ended on a key or on a folder.

# Quotas and usage

`libs/domains/src/usage` owns both "how much is stored" and "may this write happen". Usage is
derived from the metadata on every call rather than tracked incrementally, so it cannot drift out
of step with versions, delete markers and multipart aborts. `ObjectsService` calls
`assertQuota` twice per write: once on the announced `Content-Length` to refuse an over-quota
upload before streaming it, and once on the real size afterwards (deleting the blob on failure),
because a declared length is a claim rather than a guarantee.

# Audit log

Management operations are recorded declaratively: a handler carries `@Audited(AuditAction.x)` and
`AuditInterceptor` (registered globally in `apps/api`) writes one entry per call, on success and
on failure alike. The entry is assembled from the request, so handlers stay free of logging code.
Body and query end up in `detail` with `AuditTypes.REDACTED_FIELDS` masked - the log is readable
by admins and must never become a place to recover a password or a key from.

# Config files

Each app has a single `config` object exported from `app.config.ts`. Always embed new configuration
as a nested property inside that object — never export additional standalone config objects from the
same file. Shared env parsing lives in `ConfigProvider` (`libs/domains/src/config`), spread into the
app config.

# DB migrations

Migration files (`*.sql`, `*_snapshot.json`, `_journal.json`) are **never edited manually** — they
are always generated. If a change is needed, discard the current generated files and regenerate.

## Naming migrations

Always pass `--name` when generating so the file name describes the change:

```bash
npm run db   # prompts for the name, then runs drizzle-kit generate
```

Use snake_case describing what changed (e.g. `add_object_lock_columns`, `remove_bucket_acl`).

## Squashing migrations

Squashing is the only permitted exception to the no-manual-edits rule. Perform it on request
("squash migrations to N").

**Precondition:** migration N must already be applied on all environments including production.

Migrations live in `libs/database/src/core/migrations/`. Drizzle tracks applied migrations by
timestamp (`when` in the journal = `created_at` in `drizzle.__drizzle_migrations`). The hash is only
written on insert and never validated retroactively — so replacing the SQL content of an
already-applied migration file is safe.

**Steps:**

1. Concatenate SQL files `0000_*.sql` through `000{N-1}_*.sql`, append the original content of
   `000N_*.sql`, using `\n--> statement-breakpoint\n` as the separator. Overwrite `000N_*.sql`.
2. In `meta/_journal.json` remove all entries with `idx` 0 through N-1. The entry for N stays
   unchanged (`idx`, `when`, and `tag` must not change).
3. Delete SQL files `0000_*.sql` through `000{N-1}_*.sql`.
4. Delete snapshots `meta/0000_snapshot.json` through `meta/000{N-1}_snapshot.json`.

**Why existing DBs are safe:** Drizzle fetches only the last applied record and runs only migrations
where `folderMillis > lastDbMigration.created_at`. The squashed migration keeps its original
timestamp, so it is skipped on an existing DB and runs in full on a fresh one.

# Types files

Constants and types in `<entity>.types.ts` files must be wrapped in a namespace named after the
module (e.g. `BucketsTypes`, `PoliciesTypes`). This keeps IDE auto-imports grouped and unambiguous.

# Services

Helper functions in service files must be private methods on the class — never standalone functions
at module level outside the class.

# Controllers

Controllers must contain only endpoint handler methods — no helper functions and no module-level
constants.

- Helper functions → domain service (`libs/domains/src/<domain>/<entity>.service.ts`) or
  `libs/shared` for logic without domain context
- Constants → domain service or `<entity>.types.ts`

## Error response decorators

Use `Api.createErrorDto` from `@storage/shared` to define typed error response classes in the DTO
namespace, then reference them in controller decorators via `{ type: ... }`.

**In the DTO file** (`<entity>.dto.ts`, in `libs/domains/src/<domain>/`):

```ts
export namespace SomeDto {
  export enum ErrorCodes {
    SOME_ERROR = 'some_error',
  }

  export class SomeBadRequestError extends Api.createErrorDto([ErrorCodes.SOME_ERROR]) {}
}
```

**In the controller**: `@ApiBadRequestResponse({ type: SomeDto.SomeBadRequestError })`.

Never use `{ description: '...' }` alone — always `{ type: ... }` with a typed error DTO so Swagger
shows the possible error codes.

## Constraint violations

Drizzle wraps query failures in a `DrizzleQueryError` and keeps the driver's error as `cause`,
so a postgres error code is one level down. Use `isUniqueViolation` / `drizzleErrorCode` from
`@storage/database` rather than reading `err.code` directly - that reads `undefined` off the
wrapper and turns every constraint violation into a 500.

## Service error signalling

Services signal domain errors by throwing typed error classes, **not** by returning discriminated
unions or `null`/`false` for failure cases. Define them in `<entity>.types.ts` inside the module
namespace (e.g. `BucketsTypes.BucketNotFoundError` with a `code` property).

Both apps translate them centrally, so handlers do **not** wrap service calls in try/catch just to
remap an error - a new domain error only has to be listed in the filter to reach clients:

- `apps/api`: `ApiExceptionFilter` maps the error class to an HTTP status and answers with the
  error's own `code`, which is also what the DTO `ErrorCodes` enums are built from.
- `apps/s3`: `S3ExceptionFilter` maps it to an `S3Types.ErrorCode` and renders the XML `<Error>`.

A handler still uses `Api.gatewayException(...)` where the mapping depends on the endpoint rather
than on the error - for instance answering "not yours" as a 404 so guids cannot be enumerated.

# Non-null assertions

Avoid the non-null assertion operator (`!`) except where TypeScript's control-flow analysis genuinely
cannot narrow the type and a `null`/`undefined` value is structurally impossible at that point.
Prefer explicit checks (`?? fallback`, `if (!x) throw ...`, or a typed guard).

# DTOs

A numeric field that can arrive in a **query string** needs `@Type(() => Number)`: the app's
`ValidationPipe` transforms but does not convert implicitly, so `@IsInt()` alone rejects every
`?limit=10` as "not an integer". Body fields parsed from JSON already arrive typed.

Every `@ApiProperty()` decorator must include an explicit `type` option. Use primitive strings
(`'string'`, `'integer'`, `'boolean'`) for scalars, a class reference for nested objects, or `enum`
for enum fields (where `type` can be omitted). Never leave `@ApiProperty()` empty or with only
`nullable`/`required`/`description` options.

# Object upload through the management API

`PUT /v1/buckets/:name/objects?key=` takes the object payload as the raw request body, so an
upload of any size streams straight to `StorageService`. `apps/api` therefore boots with
`bodyParser: false` and registers the JSON/urlencoded parsers by hand, skipping
`config.body.rawPathPattern` - otherwise a `.json` file arriving as `application/json` would be
parsed and its stream drained before the handler ever saw it.

# Frontend

- `web/apps/storage` — the React app; `web/shared` holds cross-app CSS and types.
- Plain CSS with the tokens in `web/shared/index.css`; no CSS framework.
- Every user-facing string goes through `t()` from `src/i18n`. Czech is the source of truth and
  English is typed as `Record<TranslationKey, string>`, so a key without its counterpart fails
  the build rather than falling back silently.
- API failures are rendered by code, not by message: `apiErrorKey` maps the `{ code }` body to an
  `error.*` translation, and an unknown code falls back to the generic one. Components hold the
  thrown error in state and pass it to `<ErrorText error={...} />` instead of a message string.
- Object payloads bypass the generated client: `src/api/transfer.ts` calls the same endpoints
  through the shared Axios instance because uploads need `onUploadProgress` and downloads need
  `responseType: 'blob'`, neither of which Orval's fixed-config mutator can express.
- The API client is generated by Orval (`npm run orval:web-storage`) from the running management
  API's Swagger document, with `customInstance.ts` as the mutator. Until generation is wired up,
  `web/apps/storage/src/api/client.ts` is a hand-written stand-in with the same shape — see TODO.MD.
- Auth state lives in `web/apps/storage/src/store/auth.tsx`; access tokens in `localStorage`, with
  refresh-token rotation on load.

# Unit tests

- Framework: Jest + NestJS Testing (`@nestjs/testing`)
- Name the file `<name>.service.spec.ts` next to the tested file
- Test in isolation: mock dependencies via `{ provide: X, useValue: mockX }`
- Define mocks as `const mockX = { method: jest.fn() }` at module level
- `jest.clearAllMocks()` in `beforeEach`
- Prefer `expect.objectContaining()` over exact full-object matching
- For error handling: assert the thrown typed error class (e.g. `rejects.toThrow(SomeTypes.SomeError)`)
- Use helper factory functions (`makeBucket`, `makeDocument`) for repeated test objects
- ESLint is relaxed for spec files (see `eslint.config.mjs`)
- Private methods: test through the public interface — exception is methods with non-trivial
  combinatorial logic (SigV4 canonicalisation, policy wildcard matching) where the public-method
  setup adds unnecessary boilerplate; use `service['privateMethod'](...)` in that case

**Service instantiation** — two equally valid patterns: direct (`new MyService(mockDep as any)`) or
via `Test.createTestingModule` when DI resolution matters.

# DB integration tests

Use when you need to verify actual DB behavior: upsert conflict resolution, unique constraints,
query filtering. Place them in the **same `.spec.ts` file**, after the unit tests, in a
`describe('DB', ...)` block. DB connects to `core_test` (localhost:10400 by default, same Postgres
container as dev). Seed helpers insert only the FK prerequisites a test needs and return the row via
`.returning()`.

# Running Jest (WSL)

`node` is not on PATH by default — prefix every jest invocation with the nvm bin directory of the
current user (`ls ~/.nvm/versions/node` shows which versions exist; the repo needs >= 24.10):

```bash
PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH" node_modules/.bin/jest --testPathPatterns="<pattern>" --no-coverage
```

Note: `--testPathPattern` (singular) is deprecated; use `--testPathPatterns` (plural).

# Ports

| Service | Port |
| --- | --- |
| Postgres | 10400 |
| Redis | 10401 |
| Management API | 10410 |
| S3 API | 10411 |
| Web UI (vite) | 10412 |
