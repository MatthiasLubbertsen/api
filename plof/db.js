import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/node-sqlite";
import { requireApi, runWithApi } from "./context.js";
import { apiStoragePath } from "./paths.js";

/** @type {Map<string, import("db0").Database>} one connection per API, created lazily. */
const instances = new Map();

function redact(url) {
  return url.replace(/\/\/([^@/]*)@/, "//***@");
}

async function createApiDatabase(api) {
  // Read inside the API's context, so this is NITRO_<APINAME>_DATABASE_URL and nothing else.
  const url = runWithApi(api, () => process.env.DATABASE_URL);

  if (!url) {
    return createDatabase(sqliteConnector({ path: apiStoragePath(api, "db.sqlite") }));
  }

  const protocol = url.split(":")[0].toLowerCase();
  if (protocol === "postgres" || protocol === "postgresql") {
    const { default: postgresConnector } = await import("db0/connectors/postgresql");
    return createDatabase(postgresConnector({ url }));
  }
  if (protocol === "mysql" || protocol === "mysql2") {
    const { default: mysqlConnector } = await import("db0/connectors/mysql2");
    return createDatabase(
      mysqlConnector({ uri: url.replace(/^mysql2:/, "mysql:"), multipleStatements: true }),
    );
  }
  throw new Error(
    `[plof] NITRO_${api.toUpperCase()}_DATABASE_URL has unsupported protocol "${protocol}:" (${redact(url)}). ` +
      `Use postgres://, postgresql:// or mysql://, or unset it for SQLite.`,
  );
}

async function getApiDatabase(api) {
  if (!instances.has(api)) instances.set(api, createApiDatabase(api));
  return instances.get(api);
}

/**
 * The current API's database (a db0 instance).
 *   const db = await useApiDb(event);
 *   const { rows } = await db.sql`SELECT * FROM reports WHERE city = ${city}`;
 */
export async function useApiDb(event) {
  return getApiDatabase(requireApi(event));
}

const MIGRATIONS_TABLE = "_plof_migrations";

/**
 * Run pending migrations for one API. `migrations` is [{ name, sql }] sorted by name.
 * Each file runs once; applied names are tracked in _plof_migrations.
 */
export async function migrateApi(api, migrations) {
  if (migrations.length === 0) return [];
  const db = await getApiDatabase(api);

  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (name VARCHAR(255) PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)`,
  );
  const rows = await db.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all();
  const applied = new Set(rows.map((r) => r.name));

  const ran = [];
  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;
    try {
      await db.exec("BEGIN");
      await db.exec(sql);
      await db
        .prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, ?)`)
        .run(name, new Date().toISOString());
      await db.exec("COMMIT");
    } catch (error) {
      await Promise.resolve(db.exec("ROLLBACK")).catch(() => {});
      throw new Error(`[plof] Migration migrations/${api}/${name} failed: ${error.message}`, {
        cause: error,
      });
    }
    ran.push(name);
  }
  return ran;
}
