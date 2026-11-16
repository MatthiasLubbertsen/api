# ---- build ----
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- run ----
FROM node:24-slim AS run
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/app/storage

# The official node image already has user "node" with UID/GID 1000.
COPY --from=build --chown=1000:1000 /app/.output ./.output
# jiti loads mounted routes at runtime (plof/mount.js). It is not bundled, so ship it as-is.
COPY --from=build --chown=1000:1000 /app/node_modules/jiti ./node_modules/jiti
RUN mkdir -p /app/storage && chown 1000:1000 /app/storage

USER 1000:1000
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", ".output/server/index.mjs"]
