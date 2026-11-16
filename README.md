# Plof

A [Nitro v3](https://nitro.build) API server in plain JavaScript that hosts many small APIs side by side. Each API lives in its own folder and is isolated from the others: its own env vars, database, KV storage and files.

```
routes/weather/reports.get.js    ->  GET  /weather/reports
routes/weather/reports.post.js   ->  POST /weather/reports
storage/weather/db.sqlite        (database)
storage/weather/kv/              (key-value data)
storage/weather/files/           (uploaded files)
```

Writing or changing an endpoint? Read [AGENTS.md](./AGENTS.md), it has all the rules.

## Run locally

Requires Node.js 22.22+.

```sh
npm install
cp .env.example .env
npm run dev                         # http://localhost:3000
npm run build && npm start          # production build in .output/
```

## Run with Docker

```sh
cp .env.example .env
mkdir -p storage && sudo chown 1000:1000 storage   # the container runs as UID 1000
docker compose up -d
```

`docker-compose.yml` pulls `ghcr.io/matthiaslubbertsen/api:latest` (built by GitHub Actions on every push to `main` and on `v*` tags). To build locally, swap `image:` for the commented `build:` block. Data lives in `./storage` next to the compose file (a bind mount), so the host folder **must be writable by UID 1000**.

## Add an API

APIs live in `ROUTES_DIR` (`local-routes/` in Docker), not in this repo. No rebuild or new image needed:

1. Create `local-routes/<apiname>/` (lowercase letters and digits only, e.g. `local-routes/billing/`).
2. Add routes as `<name>.<method>.js`, e.g. `local-routes/billing/invoices.get.js` -> `GET /billing/invoices`.
3. Add its env vars to `.env` as `NITRO_<APINAME>_<VAR>`.
4. Use `useApiDb`, `useApiKv`, `useApiFiles` and `defineApiCachedHandler` from `#plof`.

Mounted APIs do not run migrations. Create their tables yourself.

## Mounted APIs (no rebuild)

Routes in `routes/` are bundled into the build. To add an API without a PR, rebuild or a new image, put it in a folder that `ROUTES_DIR` points at:

```
local-routes/billing/invoices.get.js     ->  GET  /billing/invoices
local-routes/billing/items/[id].get.js   ->  GET  /billing/items/:id
```

Same rules as `routes/`: the folder name is the API name, env vars are `NITRO_<APINAME>_<VAR>`, and `useApiKv`, `useApiFiles` and `useApiDb` work. Files are re-read when they change. Mounted handlers can import `nitro`, `nitro/h3` and `#plof`, but not other npm packages, and they do not get migrations from `migrations/`. If a bundled route has the same path, the bundled one wins.

`local-routes/` is git-ignored. Docker mounts it read-only into the container; outside Docker, set `ROUTES_DIR=./local-routes`.

## Env var naming

`NITRO_<APINAME>_<VAR>` is visible as `process.env.<VAR>`, only inside requests to that API:

```
NITRO_WEATHER_USERS_API_KEY=abc  ->  process.env.USERS_API_KEY in routes/weather/ only
```

Other APIs get `undefined`. Non-`NITRO_` vars (`PORT`, `STORAGE_DIR`, `FILES_DRIVER`, `S3_*`, ...) are global. Use `PORT`/`HOST`, not `NITRO_PORT`/`NITRO_HOST`.

## Store files on S3

Files go to `storage/<apiname>/files/` by default. To use any S3-compatible service (AWS S3, Cloudflare R2, MinIO), set:

```sh
FILES_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=plof-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Files are stored under `<apiname>/` in the bucket. Route code does not change.
