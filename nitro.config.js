import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "nitro";
import { assertValidApiName } from "./plof/names.js";

const root = import.meta.dirname;

/** Every folder in routes/ is an API. Refuse to start (dev or build) if one is named wrong. */
function scanApis() {
  const dir = join(root, "routes");
  if (!existsSync(dir)) return [];
  const apis = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    if (!statSync(join(dir, entry)).isDirectory()) {
      throw new Error(
        `[plof] routes/${entry} is a file. routes/ may only contain API folders (routes/<apiname>/...).`,
      );
    }
    assertValidApiName(entry, "routes/");
    apis.push(entry);
  }
  return apis.sort();
}

/** migrations/<api>/*.sql, sorted by file name. Embedded into the build so .output/ is self-contained. */
function scanMigrations(apis) {
  const dir = join(root, "migrations");
  const result = {};
  if (!existsSync(dir)) return result;
  for (const api of readdirSync(dir)) {
    if (api.startsWith(".")) continue;
    assertValidApiName(api, "migrations/");
    if (!apis.includes(api)) {
      throw new Error(`[plof] migrations/${api}/ has no matching routes/${api}/ folder.`);
    }
    const files = readdirSync(join(dir, api))
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    result[api] = files.map((name) => ({ name, sql: readFileSync(join(dir, api, name), "utf8") }));
  }
  return result;
}

const apis = scanApis();

export default defineConfig({
  serverDir: "./",
  compatibilityDate: "2026-11-01",
  experimental: {
    database: true,
  },
  // Nitro's own database layer stays enabled (useDatabase from "nitro/database" works), but
  // Plof APIs use useApiDb(event), which picks SQLite/Postgres/MySQL per API at runtime.
  database: {
    default: { connector: "node-sqlite", options: { path: "./storage/_nitro/db.sqlite" } },
  },
  ignore: ["plof/**", "migrations/**", "storage/**"],
  virtual: {
    "#plof/manifest": () =>
      `export const apis = ${JSON.stringify(apis)};\n` +
      `export const migrations = ${JSON.stringify(scanMigrations(apis))};\n`,
  },
  devServer: {
    watch: ["migrations", "plof"],
  },
});
