# Four deployable images out of one build: three that compose into a deployment, and one that is
# a deployment.
#
#   docker build -f docker/Dockerfile --target api        -t storage-api .
#   docker build -f docker/Dockerfile --target s3         -t storage-s3  .
#   docker build -f docker/Dockerfile --target web        -t storage-web .
#   docker build -f docker/Dockerfile --target standalone -t storage     .
#
# The backend is bundled by webpack into a single `main.js` per app, next to a generated
# package.json listing only what that bundle actually requires at runtime - so each runtime
# stage installs a handful of packages rather than the whole dev tree.

# ---------------------------------------------------------------- build

FROM node:24-alpine AS build
WORKDIR /build

# Dependencies first: they change far less often than the sources, so this layer is reused
# across most rebuilds.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json webpack.common.mjs ./
COPY apps ./apps
COPY libs ./libs
COPY web ./web

RUN npm run build && npm run build:web-storage

# ---------------------------------------------------------------- api

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /build/dist/apps/api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /build/dist/apps/api/main.js ./main.js
# The migrations are SQL files, not code, so the bundle cannot carry them.
COPY --from=build /build/libs/database/src/core/migrations ./migrations
ENV MIGRATIONS_CORE_PATH=/app/migrations

# Object payloads live outside the image; mount a volume here in production.
ENV STORAGE_DATA_PATH=/data/objects
RUN mkdir -p /data/objects && chown -R node:node /data

USER node
EXPOSE 10410
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||10410)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "main.js"]

# ---------------------------------------------------------------- s3

FROM node:24-alpine AS s3
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /build/dist/apps/s3/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /build/dist/apps/s3/main.js ./main.js

# The S3 app never migrates - `apps/api` owns the schema, and two migrators racing on boot is
# a deadlock waiting to happen. It only needs the same data volume.
ENV STORAGE_DATA_PATH=/data/objects
RUN mkdir -p /data/objects && chown -R node:node /data

USER node
EXPOSE 10411
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.S3_PORT||10411)+'/_ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "main.js"]

# ---------------------------------------------------------------- web

FROM nginx:alpine AS web

# `web/vite.config.storage.mts` resolves its outDir against `root: 'apps/storage'`, so the
# bundle lands under `web/dist`, not in the repository's top-level `dist`.
COPY --from=build /build/web/dist/storage /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/web-entrypoint.sh /docker-entrypoint.d/40-storage-config.sh
RUN chmod +x /docker-entrypoint.d/40-storage-config.sh

EXPOSE 80

# ---------------------------------------------------------------- standalone
#
# One container that is the whole product: both applications, the UI, Postgres and Valkey, on
# Alpine. It exists for the deployment that wants object storage, not a topology - a single
# `docker run` with one volume instead of five services to wire together.
#
# The trade-off is deliberate: everything shares a fate. A restart restarts the database with the
# applications, and the container cannot be scaled past one instance - Postgres would fork, the
# blob store would not. A deployment that outgrows that moves to `docker-compose.prod.yml`, which
# is the same code as three images against shared stores.
#
#   docker build -f docker/Dockerfile --target standalone -t storage .

FROM node:24-alpine AS standalone

ARG TARGETARCH

# Postgres is pinned to a major version on purpose: the cluster in the volume is written in the
# on-disk format of the server that created it, and a server one major ahead refuses to open it.
# Bumping this line is a migration, not an upgrade.
RUN apk add --no-cache postgresql17 postgresql17-client valkey nginx ca-certificates tzdata libcap

# s6-overlay is the process supervisor: five processes in one container need something that reaps
# orphans, starts them in dependency order and takes them all down on one SIGTERM. It is not in
# the Alpine repositories, and busybox tar does not handle its archives - hence the two extras,
# removed again in the same layer.
ARG S6_OVERLAY_VERSION=3.2.1.0
RUN apk add --no-cache --virtual .s6-install tar xz \
	&& case "$TARGETARCH" in \
		amd64) s6arch=x86_64 ;; \
		arm64) s6arch=aarch64 ;; \
		arm) s6arch=armhf ;; \
		*) echo "standalone: unsupported architecture '${TARGETARCH}'" >&2; exit 1 ;; \
	esac \
	&& wget -qO /tmp/s6-noarch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" \
	&& wget -qO /tmp/s6-arch.tar.xz "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${s6arch}.tar.xz" \
	&& tar -C / -Jxpf /tmp/s6-noarch.tar.xz \
	&& tar -C / -Jxpf /tmp/s6-arch.tar.xz \
	&& rm -f /tmp/s6-noarch.tar.xz /tmp/s6-arch.tar.xz \
	&& apk del .s6-install

# Fail at build time rather than in someone else's entrypoint: these are the binaries every
# service script assumes, and Alpine keeps the Postgres server ones off the default PATH.
RUN for binary in postgres initdb psql pg_isready valkey-server nginx; do \
		PATH="/usr/libexec/postgresql17:$PATH" command -v "$binary" > /dev/null \
			|| { echo "standalone: '${binary}' is not in the image" >&2; exit 1; }; \
	done \
	&& for account in postgres valkey nginx; do \
		id "$account" > /dev/null 2>&1 \
			|| { echo "standalone: package did not create the '${account}' user" >&2; exit 1; }; \
	done

# Neither application ever runs as root, and neither owns the stores' files.
RUN addgroup -g 10001 -S storage \
	&& adduser -u 10001 -S -G storage -h /app -s /sbin/nologin storage

WORKDIR /app

# Both bundles run out of one node_modules. The two generated dependency lists come from the same
# lockfile, so the merge is a union - and the script stops the build if it ever is not.
COPY --from=build /build/dist/apps/api/package.json ./api/package.json
COPY --from=build /build/dist/apps/s3/package.json ./s3/package.json
COPY docker/standalone/merge-package-json.mjs /tmp/merge-package-json.mjs
RUN node /tmp/merge-package-json.mjs /app/package.json /app/api/package.json /app/s3/package.json \
	&& npm install --omit=dev --no-audit --no-fund \
	&& npm cache clean --force \
	&& rm -f /tmp/merge-package-json.mjs /app/api/package.json /app/s3/package.json

COPY --from=build /build/dist/apps/api/main.js ./api/main.js
COPY --from=build /build/dist/apps/s3/main.js ./s3/main.js
# The migrations are SQL files, not code, so the bundle cannot carry them.
COPY --from=build /build/libs/database/src/core/migrations ./migrations
# `web/vite.config.storage.mts` resolves its outDir against `root: 'apps/storage'`, so the bundle
# lands under `web/dist`, not in the repository's top-level `dist`.
COPY --from=build /build/web/dist/storage /usr/share/nginx/html

# The supervision tree and the scripts it runs. `chmod` is explicit because a checkout on a
# filesystem without a permission bit would otherwise produce an image whose services cannot run.
COPY docker/standalone/rootfs /
# The rootfs mirrors the container's filesystem, so it contains a `bin` directory - which a
# Visual-Studio-flavoured `.gitignore` excludes as `[Bb]in/`, and which once left every boot
# script out of the repository. Say that, instead of failing on a glob that matched nothing.
RUN if [ ! -f /usr/local/bin/storage-env-check ]; then \
		echo 'standalone: docker/standalone/rootfs is incomplete in the build context - check .gitignore and .dockerignore' >&2; \
		exit 1; \
	fi \
	&& chmod +x /usr/local/bin/storage-* /etc/s6-overlay/s6-rc.d/*/run

# The S3 endpoint listens on 443, the port AWS serves S3 on, and 443 is privileged. The capability
# sits on the binary rather than on the container so the applications still run as `storage`:
# `--cap-add` or `--user root` would hand the same right to everything else in the image.
RUN setcap cap_net_bind_service=+ep /usr/local/bin/node

ENV NODE_ENV=production
ENV TZ=UTC
# `/command` is where s6-overlay keeps its tools: the service scripts run under `with-contenv`,
# which replaces the PATH with the container's own, so it has to be in that one. Alpine keeps the
# Postgres server binaries out of the default PATH entirely.
ENV PATH=/command:/usr/libexec/postgresql17:$PATH

# A failing oneshot - a missing secret, an unwritable volume, a database that never came up -
# takes the container down instead of leaving it half-started and answering health checks.
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
ENV S6_KILL_GRACETIME=10000
ENV S6_SERVICES_GRACETIME=10000

# Everything persistent lives under one root, because the three stores are only meaningful
# together: a bucket listing whose blobs are gone is not a state anything can recover from.
ENV STORAGE_ROOT=/data \
	STORAGE_DATA_PATH=/data/objects \
	PGDATA=/data/postgres \
	VALKEY_DATA_PATH=/data/valkey \
	MIGRATIONS_CORE_PATH=/app/migrations

# Published surfaces. API_PUBLIC_URL is relative by default: the UI calls back to the origin it
# was served from and nginx proxies /api/ to the management API, so nothing in the image has to
# know the container's public address - and the browser needs no CORS.
ENV WEB_PORT=4242 \
	API_PORT=10410 \
	S3_PORT=443 \
	API_PUBLIC_URL=/api \
	WEB_WORKER_PROCESSES=auto \
	WEB_WORKER_CONNECTIONS=1024 \
	WEB_ACCESS_LOG=off \
	WEB_ERROR_LOG_LEVEL=warn \
	WEB_PROXY_TIMEOUT=1h

# The embedded stores. Both bind to the loopback address and neither is published.
ENV POSTGRES_HOST=127.0.0.1 \
	POSTGRES_PORT=5432 \
	POSTGRES_DB=core \
	POSTGRES_USER=postgres \
	POSTGRES_POOL=8 \
	POSTGRES_SHARED_BUFFERS=256MB \
	POSTGRES_MAX_CONNECTIONS=100 \
	POSTGRES_EXTRA_ARGS=

ENV VALKEY_HOST=127.0.0.1 \
	VALKEY_PORT=6379 \
	VALKEY_APPENDONLY=no \
	VALKEY_MAXMEMORY=128mb \
	VALKEY_MAXMEMORY_POLICY=allkeys-lru

# Declared so that a `docker run` without `-v` still writes to a volume rather than into the
# container's own writable layer, where it would be both slow and thrown away with the container.
# It is not a substitute for naming one - see docker/standalone/DOCKERHUB.md.
VOLUME /data

EXPOSE 4242 443 10410

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
	CMD /usr/local/bin/storage-healthcheck

ENTRYPOINT ["/init"]
