# Three deployable images out of one build.
#
#   docker build -f docker/Dockerfile --target api -t storage-api .
#   docker build -f docker/Dockerfile --target s3  -t storage-s3  .
#   docker build -f docker/Dockerfile --target web -t storage-web .
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
