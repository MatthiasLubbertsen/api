# AGENTS.md: how to work on Plof

This file is for AI agents (and humans) adding or changing API endpoints in Plof. It is meant to be enough on its own: read it top to bottom once, then use the checklist in section 11.

Plof is a **Nitro v3** server written in **plain JavaScript (ES modules, no TypeScript)**. It hosts many independent APIs in one process. Every API is a folder under `routes/` and is isolated from the others: its own env vars, its own database, its own KV storage and its own files.

---

## 1. Project structure

### 1a. Layout

```
.
├── routes/                    # one folder per API, nothing else
│   └── weather/               # API "weather" -> served under /weather/...
│       ├── reports.get.js     # GET  /weather/reports
│       ├── reports.post.js    # POST /weather/reports
│       └── photos/
│           └── [name].get.js  # GET  /weather/photos/:name
├── migrations/
│   └── weather/
│       └── 001_create_reports.sql
├── plof/                      # Plof core (do not put routes here)
│   ├── index.js               # public helpers, imported as "#plof"
│   ├── env.js                 # per-API env vars (process.env Proxy)
│   ├── context.js             # AsyncLocalStorage with the current API name
│   ├── db.js                  # useApiDb + migration runner
│   ├── kv.js                  # useApiKv
│   ├── files.js               # useApiFiles (fs / s3)
│   ├── cache.js               # defineApiCachedHandler
│   ├── names.js               # API name validation
│   ├── paths.js               # STORAGE_DIR resolution
│   └── ready.js               # startup gate (requests wait for migrations)
├── middleware/00.plof.js      # wraps every request in the API context
├── plugins/00.plof.js         # startup: scope env vars, run migrations
├── nitro.config.js            # validates API names, embeds migrations
├── storage/                   # runtime data (gitignored, created on demand)
├── Dockerfile, docker-compose.yml, .github/workflows/docker.yml
└── .env.example
```

### 1b. How a request flows

1. `middleware/00.plof.js` takes the first path segment (`/weather/reports` -> `weather`) and runs the rest of the request inside an `AsyncLocalStorage` holding `{ api: "weather" }`. Paths whose first segment is not a known API get `{ api: null }`.
2. The route handler runs. Anything it calls (`process.env`, `useApiDb`, `useApiKv`, `useApiFiles`, cached handlers) reads the API name from that context.
3. Requests wait until startup migrations are done; if a migration fails the process exits.

### 1c. Rules

- Plain `.js` ES modules only. No TypeScript, no JSX, no CommonJS (`require`).
- Route code imports Plof helpers from `"#plof"` (a Node subpath import declared in `package.json`), and Nitro/h3 utilities from `"nitro"` and `"nitro/h3"`.
- Never import one API's route file from another API. If two APIs need the same pure helper (no env, no storage), put it in a shared module outside `routes/`, e.g. `lib/`.
- Do not edit `plof/`, `middleware/` or `plugins/` to add an endpoint. You only touch `routes/<api>/`, `migrations/<api>/`, `.env.example` and the docs.

```js
// routes/weather/ping.get.js
import { defineHandler } from "nitro";

export default defineHandler(() => ({ ok: true }));
```

**Common mistakes**
- Creating `routes/ping.get.js` directly in `routes/`. The build refuses: `routes/` may only contain API folders.
- Importing from `"../plof/db.js"` instead of `"#plof"`. It works, but breaks when files move; use `"#plof"`.
- Using `"h3"` directly. Use `"nitro"` (for `defineHandler`, `HTTPError`) and `"nitro/h3"` (for `getQuery`, `getRouterParam`, ...), which are the versions Nitro bundles.

---

## 2. Routes and methods

### 2a. File naming

`routes/<apiname>/<path>.<method>.js` maps to `<METHOD> /<apiname>/<path>`.

| File | Route |
| --- | --- |
| `routes/weather/reports.get.js` | `GET /weather/reports` |
| `routes/weather/reports.post.js` | `POST /weather/reports` |
| `routes/weather/reports/[id].get.js` | `GET /weather/reports/:id` |
| `routes/weather/reports/[id].delete.js` | `DELETE /weather/reports/:id` |
| `routes/weather/files/[...path].get.js` | `GET /weather/files/**` (catch-all) |
| `routes/weather/index.get.js` | `GET /weather` |

Methods: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`. A file without a method suffix matches every method; avoid that, always add the method.

### 2b. API names

- Lowercase letters and digits only: `weather`, `billing2`. Regex: `^[a-z0-9]+$`.
- No `_`, no `-`, no uppercase. `_` is reserved as the separator in env var names (`NITRO_<APINAME>_<VAR>`).
- `nitro dev` and `nitro build` throw on startup if a folder in `routes/` or `migrations/` breaks this rule, or if `migrations/<api>/` has no matching `routes/<api>/`.

### 2c. Reading the request

`event.req` is a standard Web `Request`. `event.url` is a parsed `URL`.

```js
import { defineHandler, HTTPError } from "nitro";
import { getQuery, getRouterParam } from "nitro/h3";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id");             // from [id] in the file name
  const { page = "1" } = getQuery(event);             // ?page=2
  const token = event.req.headers.get("x-api-key");   // headers
  const body = await event.req.json();                // JSON body (POST/PUT/PATCH)
  // Other body types: await event.req.text(), await event.req.formData(), await event.req.arrayBuffer()
  return { id, page, body };
});
```

### 2d. Responses

- Return a plain object or array -> JSON response with status 200.
- Set the status with `event.res.status = 201`, headers with `event.res.headers.set("x-foo", "bar")`.
- Return a `Response` for full control (binary data, custom content type).
- Return `null` / nothing for an empty body; prefer `event.res.status = 204` for deletes.

```js
export default defineHandler(async (event) => {
  event.res.status = 201;
  event.res.headers.set("location", `/weather/reports/${id}`);
  return { id };
});
```

**Common mistakes**
- `await readBody(event)` (h3 v1 / Nitro v2). In Plof use `await event.req.json()`.
- Reading the body twice. A `Request` body can only be consumed once; store it in a variable.
- Not validating input. Always check types and lengths before writing to the DB or storage.
- Using `event.node.req` / `event.node.res`. That is Nitro v2; v3 uses Web `Request`/`Response`.

---

## 3. Env vars

### 3a. Naming rule

```
NITRO_<APINAME>_<VAR>=value
```

- `<APINAME>` is the folder name in uppercase: `routes/weather/` -> `NITRO_WEATHER_`.
- `<VAR>` is everything after the API name and can contain `_`: `NITRO_WEATHER_USERS_API_KEY` -> `USERS_API_KEY`.
- Inside a request to `/weather/...`, it is available as `process.env.USERS_API_KEY`. Nowhere else.

### 3b. How scoping works

At startup `plugins/00.plof.js` calls `installScopedEnv()`, which:

1. Moves every `NITRO_*` var out of `process.env` into a private `Map` inside `plof/env.js`. No other module can read it.
2. Replaces `process.env` with a `Proxy`. Inside a request, the proxy adds the current API's vars (without prefix) and hides everything else that starts with `NITRO_`.
3. `Object.keys(process.env)`, `{ ...process.env }` and `"X" in process.env` follow the same rules.

| Where | `process.env.USERS_API_KEY` | `process.env.NITRO_WEATHER_USERS_API_KEY` |
| --- | --- | --- |
| Request to `/weather/...` | `"abc"` | `undefined` |
| Request to `/billing/...` | `undefined` | `undefined` |
| Module top level, plugin, timer | `undefined` + warning | `undefined` + warning |

If an API's var has the same name as a global var (e.g. `NITRO_WEATHER_PORT`), the API's value wins inside that API's requests.

### 3c. Global vars

Anything not starting with `NITRO_` passes through unchanged and is visible everywhere: `PORT`, `HOST`, `NODE_ENV`, `STORAGE_DIR`, `FILES_DRIVER`, `S3_*`. Use `PORT`/`HOST`, not `NITRO_PORT`/`NITRO_HOST` (those get captured and ignored with a warning).

### 3d. Adding a var

1. Add it to `.env.example` under the API's section, with a placeholder value, never a real secret.
2. Add the real value to your local `.env` (gitignored) or to the deployment's env.
3. Read it **inside the handler**.

```js
// .env: NITRO_WEATHER_PROVIDER_TOKEN=...
export default defineHandler(async () => {
  const token = process.env.PROVIDER_TOKEN; // read per request
  if (!token) throw new HTTPError({ status: 500, message: "NITRO_WEATHER_PROVIDER_TOKEN is not set" });
  // ...
});
```

**Common mistakes**
- `const token = process.env.PROVIDER_TOKEN;` at module top level. Outside a request it is `undefined` (and logs a warning). Route modules are also loaded lazily, so a top-level read in a shared module can capture whichever API loaded it first. Always read inside the handler.
- Reading `process.env.NITRO_WEATHER_PROVIDER_TOKEN`. The prefixed name never exists after startup; use the short name.
- Hardcoding secrets or committing `.env`. Only `.env.example` is committed.
- Naming an API `my_api`: the env var `NITRO_MY_API_KEY` would be ambiguous. That is why `_` is banned in API names.
- Expecting isolation to be a security sandbox. It prevents accidents and keeps APIs tidy; all code still runs in one Node process.

---

## 4. Storage layout

### 4a. Default layout

```
storage/                      # STORAGE_DIR, default ./storage (Docker: /app/storage)
└── <apiname>/
    ├── db.sqlite             # SQLite database (unless NITRO_<APINAME>_DATABASE_URL is set)
    ├── kv/                   # KV storage, one file per key
    └── files/                # real files (when FILES_DRIVER=fs)
```

### 4b. Rules

- Folders are created on first use. Do not create them in code and do not commit them (`storage/` is gitignored).
- Never build paths into `storage/` by hand (`fs.writeFile("storage/weather/...")`). Use `useApiDb`, `useApiKv` and `useApiFiles`; they always resolve to the current API's folder.
- `STORAGE_DIR` changes the root for every API at once.

```js
// Right: the helper picks storage/<current api>/files/
await useApiFiles(event).setItemRaw("exports/report.csv", bytes);
```

**Common mistakes**
- Using `node:fs` directly with a relative path. It depends on the working directory and bypasses per-API isolation and the S3 switch.
- Writing large blobs to KV. Files belong in `useApiFiles`.

---

## 5. Database and migrations

### 5a. useApiDb

```js
import { useApiDb } from "#plof";

const db = await useApiDb(event);                      // note: async, always await it
const { rows } = await db.sql`SELECT * FROM reports WHERE city = ${city}`;
await db.sql`INSERT INTO reports (id, city) VALUES (${id}, ${city})`;
```

`db` is a [db0](https://db0.unjs.io) instance. Template literal values are sent as bound parameters, never interpolated into the SQL string. Other methods: `db.prepare(sql).all(...params)`, `.run(...params)`, `.get(...params)`, and `db.exec(sql)` for raw SQL without parameters.

### 5b. Which database

- Default: SQLite via Node's built-in `node:sqlite`, file `storage/<apiname>/db.sqlite`.
- If `NITRO_<APINAME>_DATABASE_URL` is set, that API uses it instead:
  - `postgres://...` or `postgresql://...` -> PostgreSQL (`pg`)
  - `mysql://...` -> MySQL (`mysql2`, with multiple statements enabled for migrations)
- One connection per API, created on first use and reused.
- Nitro's own database layer is enabled too (`useDatabase()` from `"nitro/database"` points at `storage/_nitro/db.sqlite`), but API code should always use `useApiDb(event)`.

### 5c. Migrations

- Put plain SQL files in `migrations/<apiname>/`. They run on startup, sorted by file name (numeric-aware), each exactly once.
- Applied migrations are tracked in the API's own `_plof_migrations` table (`name`, `applied_at`).
- Each file runs inside `BEGIN`/`COMMIT`. If it fails, it is rolled back (where the database supports transactional DDL), the error is logged and the server exits.
- Migrations are embedded into the build. In `nitro dev`, restart after adding a migration if it does not pick it up.
- Name files with a zero-padded number: `001_create_reports.sql`, `002_add_city_index.sql`.
- Never edit a migration that already ran anywhere. Add a new one.

```sql
-- migrations/weather/002_add_wind.sql
ALTER TABLE reports ADD COLUMN wind_kph REAL;
```

### 5d. Portable SQL

If an API might move from SQLite to Postgres/MySQL, keep migrations portable: `VARCHAR(n)`, `TEXT`, `REAL`, `INTEGER`; use `crypto.randomUUID()` ids instead of `AUTOINCREMENT`/`SERIAL`; store timestamps as ISO strings. Otherwise, write the SQL for the database the API actually uses.

**Common mistakes**
- Forgetting `await` on `useApiDb(event)` (it returns a promise).
- Building SQL with string concatenation: `` db.exec(`... WHERE id = '${id}'`) `` is SQL injection. Use `` db.sql`...${id}` ``.
- Creating tables from route code (`CREATE TABLE IF NOT EXISTS` in a handler). Use a migration.
- Renaming or editing an applied migration file. It will not run again; the change silently never happens.
- Touching another API's tables. Each API has its own database; there is no way (and no reason) to reach across.

---

## 6. KV storage

### 6a. useApiKv

```js
import { useApiKv } from "#plof";

const kv = useApiKv(event);                      // sync, no await needed
await kv.setItem("settings", { units: "metric" });
const settings = await kv.getItem("settings");    // parsed JSON, or null
await kv.removeItem("settings");
const keys = await kv.getKeys("sessions");        // keys under "sessions:"
```

It is an [unstorage](https://unstorage.unjs.io) instance rooted at `storage/<apiname>/kv/`. Each API gets its own instance, so keys can never collide with or reach another API's keys.

### 6b. Rules

- JSON-sized data only: settings, sessions, counters, small records (think: under ~100 KB).
- Use `:` to namespace keys: `session:<id>`, `latest:oslo`. They become sub folders on disk.
- Values are serialized as JSON. Dates become strings.
- No TTL/expiry built in. Store an `expiresAt` and check it, or use the database.
- Read-modify-write is not atomic. Use the database for anything that needs transactions or exact counters under concurrency.

**Common mistakes**
- Storing uploads or base64 blobs in KV. Use `useApiFiles`.
- Keys containing `..` or user input without validation. Normalize user input (e.g. lowercase, `[a-z0-9-]`) before using it as a key.
- Expecting `getItem` to throw for a missing key. It returns `null`.

---

## 7. File storage (fs and S3)

### 7a. useApiFiles

```js
import { useApiFiles } from "#plof";

const files = useApiFiles(event);
await files.setItemRaw("photos/oslo.jpg", bytes);   // Uint8Array / Buffer / ArrayBuffer
const data = await files.getItemRaw("photos/oslo.jpg"); // Uint8Array, or null if missing
await files.hasItem("photos/oslo.jpg");
await files.removeItem("photos/oslo.jpg");
await files.getKeys("photos");                      // ["photos/oslo.jpg", ...]
```

Serve a file:

```js
const bytes = await useApiFiles(event).getItemRaw(`photos/${name}`);
if (!bytes) throw new HTTPError({ status: 404, message: "Not found" });
return new Response(bytes, { headers: { "content-type": "image/jpeg" } });
```

### 7b. Backends

| `FILES_DRIVER` | Where `photos/oslo.jpg` ends up |
| --- | --- |
| `fs` (default) | `storage/<apiname>/files/photos/oslo.jpg` |
| `s3` | `s3://$S3_BUCKET/<apiname>/photos/oslo.jpg` |

S3 works with any S3-compatible service (AWS S3, Cloudflare R2, MinIO, ...) and needs `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. These are global vars, shared by all APIs; the `<apiname>/` prefix keeps APIs apart. Route code is identical for both drivers.

On S3 you can pass object headers: `files.setItemRaw(name, bytes, { headers: { "Content-Type": "image/png" } })`. The fs driver ignores them.

### 7c. File name rules

Every name goes through `assertSafeFileName` and is rejected with a 400 if it:
- is empty, longer than 512 chars, or absolute (`/x`, `\x`, `C:...`)
- contains `\`, `:` or a null byte
- has an empty, `.` or `..` segment
- has a segment with characters outside `A-Z a-z 0-9 . _ -` (or starting with `.`)

The extension is kept exactly as given. Best practice: generate the name yourself (`photos/${crypto.randomUUID()}.${ext}`) and only take the extension from user input, after validating it.

**Common mistakes**
- Using the uploaded file name as-is. It may contain spaces, unicode or `../`; it will be rejected. Generate names.
- Calling `getItem`/`setItem` (non-raw). Those are for JSON; files must use `getItemRaw`/`setItemRaw`.
- Branching on `process.env.FILES_DRIVER` in route code. Never needed; the helper handles it.
- Storing files without a size limit. Check `bytes.length` before saving.

---

## 8. Caching

### 8a. defineApiCachedHandler

Use it for slow `GET` routes. It wraps Nitro's `defineCachedHandler` and makes the cache key `<api>:<name>:<path>?<allowed query>`, so two APIs can never share a cache entry.

```js
import { getQuery } from "nitro/h3";
import { defineApiCachedHandler, useApiDb } from "#plof";

export default defineApiCachedHandler(
  async (event) => {
    const { city } = getQuery(event);          // only works because "city" is in allowQuery
    const db = await useApiDb(event);
    const { rows } = await db.sql`SELECT * FROM reports WHERE city = ${city}`;
    return { rows };
  },
  { name: "reports", maxAge: 60, allowQuery: ["city"] },
);
```

### 8b. Options

- `name` (required): unique within the API.
- `maxAge`: seconds the entry is fresh. `swr: true` (off by default) serves the stale entry while refreshing it in the background.
- `allowQuery`: query params that reach the handler and vary the key. **By default no query params reach a cached handler.** `true` allows all.
- `varies`: request headers that reach the handler and vary the key (e.g. `["accept-language"]`).
- `allowCookies`, `allowAuthorization`: cookies / `Authorization` header that reach the handler and vary the key.
- `getKey(event)`: replaces the `<path>?<query>` part. The `<api>:<name>:` prefix is always kept.

The cache is in-memory (per process). It is cleared on restart.

### 8c. When not to cache

- `POST`, `PUT`, `PATCH`, `DELETE`: never.
- Per-user data, unless the user identity is in the key (`allowAuthorization` / `allowCookies`), and even then prefer not to.
- Fast routes. Caching adds complexity; only cache what is slow (external API calls, heavy queries).

**Common mistakes**
- Using `getQuery(event)` in a cached handler without `allowQuery`. You get `{}` and every query shares one entry.
- Reading `authorization` or cookies in a cached handler without allowing them. They are stripped.
- Using plain `defineCachedHandler` from `"nitro/cache"`. Its key does not include the API name; use `defineApiCachedHandler`.
- Expecting a write to show up immediately on a cached GET. It shows after `maxAge`; keep `maxAge` short for data that changes.

---

## 9. Error handling

### 9a. Throw HTTPError

```js
import { defineHandler, HTTPError } from "nitro";

export default defineHandler(async (event) => {
  const body = await event.req.json().catch(() => {
    throw new HTTPError({ status: 400, message: "Body must be JSON" });
  });
  if (!body.city) throw new HTTPError({ status: 400, message: "city is required" });
  // ...
});
```

The client gets JSON: `{ "error": true, "status": 400, "message": "city is required" }`.

### 9b. Status codes

`400` bad input, `401` missing/wrong credentials, `403` not allowed, `404` not found, `409` conflict, `413` too large, `422` valid JSON but semantically wrong, `500` server misconfiguration (e.g. missing env var).

### 9c. Unexpected errors

Any other thrown error becomes a `500` with body `{ "error": true, "status": 500, "unhandled": true }`. The message is not sent to the client; it is logged on the server. Do not wrap everything in `try/catch` just to rethrow; catch only to turn a known failure into a proper `HTTPError`.

**Common mistakes**
- `return { error: "..." }` with status 200. Throw an `HTTPError` so the status code is right.
- Putting secrets or SQL in error messages. Messages for `4xx` reach the client.
- Swallowing errors with an empty `catch {}`.

---

## 10. Docker and deployment

### 10a. Image

- `Dockerfile` is multi-stage: `node:24-slim` runs `npm ci && npm run build`, then a slim `node:24-slim` stage runs only `.output/` as UID/GID 1000 (`node` user).
- Inside the container: `PORT=3000`, `STORAGE_DIR=/app/storage`, `NODE_ENV=production`.
- Everything the server needs (routes, migrations, dependencies) is bundled into `.output/`. No `node_modules` in the final image.

### 10b. docker-compose

```yaml
services:
  plof:
    image: ghcr.io/matthiaslubbertsen/api:latest   # or the commented build: block
    env_file: .env
    environment: { PORT: "3000" }
    ports: ["${HOST_PORT:-3000}:3000"]
    volumes: ["./storage:/app/storage"]              # bind mount, not a named volume
```

Before the first start: `mkdir -p storage && sudo chown 1000:1000 storage`. Otherwise SQLite/KV/files fail with `EACCES`.

### 10c. CI

`.github/workflows/docker.yml` builds on pushes to `main` and on `v*` tags and pushes to `ghcr.io/<owner>/<repo>` with the built-in `GITHUB_TOKEN`:
- `latest` for `main`
- the short commit SHA for every build
- the version for tags (`v1.2.3` -> `1.2.3`)

Build cache uses GitHub Actions cache (`type=gha`).

### 10d. Deploying a change

1. Commit routes + migrations + `.env.example`.
2. Merge to `main` (or push a `v*` tag). CI publishes the image.
3. On the server: add new env vars to `.env`, then `docker compose pull && docker compose up -d`. Migrations run on start.

**Common mistakes**
- Named volume instead of the bind mount: data ends up somewhere in `/var/lib/docker` instead of `./storage`.
- Host `storage/` owned by root: the container (UID 1000) cannot write.
- Setting `PORT` in `.env` and expecting the host port to change. Compose forces the container port to 3000; set `HOST_PORT` for the host side.
- Forgetting to add new `NITRO_<APINAME>_*` vars to the server's `.env`.

---

## 11. Checklist: adding a new endpoint

1. **API folder.** Use an existing `routes/<api>/` or create one: lowercase letters and digits only.
2. **Route file.** `routes/<api>/<path>.<method>.js`, always with a method suffix. Dynamic segments as `[param]`.
3. **Handler.** `export default defineHandler(async (event) => { ... })` (or `defineApiCachedHandler(..., { name, maxAge, allowQuery })` for slow GETs). Imports from `"nitro"`, `"nitro/h3"`, `"#plof"` only.
4. **Input.** Body via `await event.req.json()` (once). Validate every field; throw `HTTPError` with `400` on bad input.
5. **Env vars.** Read inside the handler as `process.env.<VAR>`. Add `NITRO_<APINAME>_<VAR>=placeholder` to `.env.example`. No secrets in code.
6. **Database.** `const db = await useApiDb(event)`, queries with `` db.sql`...${value}` ``. New tables/columns go in a new `migrations/<api>/NNN_name.sql`; never edit an applied one.
7. **KV.** `useApiKv(event)` for small JSON only.
8. **Files.** `useApiFiles(event).setItemRaw/getItemRaw` with generated names; check size limits.
9. **Caching.** Only GET, only slow routes, `name` set, every needed query param in `allowQuery`.
10. **Errors.** `HTTPError` with the right status; no secrets in messages.
11. **Verify.** `npm run build` succeeds (catches bad API names and missing migration folders), then `npm run dev` and call the endpoint with `curl`, including a bad-input case.
12. **Docs.** If you added an API or env var, update `.env.example` (and README if the API is user-facing).
