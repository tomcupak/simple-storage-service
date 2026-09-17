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
- Authentication is SigV4 (`S3SignatureService` + `S3Guard`), which puts a `S3Types.RequestIdentity`
  on `res.locals.s3`. A request without an `Authorization` header is anonymous, not rejected —
  whether it may proceed is the bucket policy's decision.
- Authorisation on the S3 side is the policy engine (`PoliciesService.evaluate`), never the
  management-level `BucketPermission` grants, which only govern the UI.

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

## Service error signalling

Services signal domain errors by throwing typed error classes, **not** by returning discriminated
unions or `null`/`false` for failure cases. Define them in `<entity>.types.ts` inside the module
namespace (e.g. `BucketsTypes.BucketNotFoundError` with a `code` property).

The controller catches them and maps to HTTP exceptions via `Api.gatewayException(...)`, ending with
`throw err` so unexpected errors propagate normally. In `apps/s3` the same domain errors map to
`S3Exception` instead.

# Non-null assertions

Avoid the non-null assertion operator (`!`) except where TypeScript's control-flow analysis genuinely
cannot narrow the type and a `null`/`undefined` value is structurally impossible at that point.
Prefer explicit checks (`?? fallback`, `if (!x) throw ...`, or a typed guard).

# DTOs

Every `@ApiProperty()` decorator must include an explicit `type` option. Use primitive strings
(`'string'`, `'integer'`, `'boolean'`) for scalars, a class reference for nested objects, or `enum`
for enum fields (where `type` can be omitted). Never leave `@ApiProperty()` empty or with only
`nullable`/`required`/`description` options.

# Frontend

- `web/apps/storage` — the React app; `web/shared` holds cross-app CSS and types.
- Plain CSS with the tokens in `web/shared/index.css`; no CSS framework.
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

`node` is not on PATH by default — prefix every jest invocation:

```bash
PATH="/root/.nvm/versions/node/v24.10.0/bin:$PATH" node_modules/.bin/jest --testPathPatterns="<pattern>" --no-coverage
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
