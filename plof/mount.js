// Mounted APIs: serve routes from the routes/ folder next to the app, read at request time.
// No rebuild or new image needed to add or change an API.
//
//   routes/<api>/<path>.<method>.js          ->  <METHOD> /<api>/<path>
//   routes/<api>/items/[id].get.js           ->  GET /<api>/items/:id
//
// The folder name is the API name, env vars come from NITRO_<API>_<VAR>, and
// useApiKv/useApiFiles/useApiDb work. Files are loaded with jiti and re-read when they
// change. Bundled routes always win over mounted ones (there are none in this repo).
//
// Mounted handlers can import "nitro", "nitro/h3" and "#plof" (the same instances the
// server uses), and npm packages installed in routes/ (run npm install there).
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineHandler, HTTPError } from "nitro";
import * as nitro from "nitro";
import * as nitroH3 from "nitro/h3";
import * as plof from "#plof";
import { runWithApi } from "./context.js";
import { isValidApiName } from "./names.js";

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const DYNAMIC = /^\[([A-Za-z0-9_]+)\]/;

const isFile = (p) => {
  try { return statSync(p).isFile(); } catch { return false; }
};
const isDir = (p) => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};

/**
 * Find the route file for `segs` (path segments after the API name) and `method`.
 * Exact names win over [param] names. Returns { file, params } or null.
 */
function resolveRoute(dir, segs, method, params = {}) {
  if (segs.length === 0) {
    const index = join(dir, `index.${method}.js`);
    return isFile(index) ? { file: index, params } : null;
  }
  const [head, ...rest] = segs;

  const exactFile = join(dir, `${head}.${method}.js`);
  if (rest.length === 0 && isFile(exactFile)) return { file: exactFile, params };
  if (isDir(join(dir, head))) {
    const hit = resolveRoute(join(dir, head), rest, method, params);
    if (hit) return hit;
  }

  for (const entry of readdirSync(dir)) {
    const m = DYNAMIC.exec(entry);
    if (!m) continue;
    const name = m[1];
    const nextParams = { ...params, [name]: head };
    if (rest.length === 0 && entry === `[${name}].${method}.js`) {
      return { file: join(dir, entry), params: nextParams };
    }
    if (rest.length > 0 && entry === `[${name}]` && isDir(join(dir, entry))) {
      const hit = resolveRoute(join(dir, entry), rest, method, nextParams);
      if (hit) return hit;
    }
  }
  return null;
}

/** Decode one URL segment. Rejects anything that could escape the routes folder. */
function decodeSegment(raw) {
  const s = decodeURIComponent(raw);
  if (s === "" || s.startsWith(".") || /[/\\0]/.test(s)) return null;
  return s;
}

const cache = new Map(); // file -> { mtimeMs, handler }

// jiti is loaded at runtime from node_modules (see Dockerfile), not bundled: its babel
// transform is read from a file next to it, which a bundle cannot provide. The name is
// assembled at runtime so the bundler does not see a static import.
const JITI = ["jiti"].join("");
let createJiti;

async function loadHandler(file) {
  const mtimeMs = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.handler;

  createJiti ??= (await import(/* @vite-ignore */ JITI)).createJiti;
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
    virtualModules: { nitro, "nitro/h3": nitroH3, "#plof": plof },
  });
  const mod = await jiti.import(file, { default: true });
  if (typeof mod !== "function") {
    throw new Error(`[plof] ${file} must export default defineHandler(...)`);
  }
  cache.set(file, { mtimeMs, handler: mod });
  return mod;
}

export default defineHandler(async (event) => {
  const root = resolve(process.cwd(), "routes");
  const notFound = () => new HTTPError({ status: 404, message: "Not found" });
  if (!isDir(root)) throw notFound();

  const segments = event.url.pathname.split("/").slice(1).filter((s) => s !== "");
  const decoded = segments.map(decodeSegment);
  if (decoded.some((s) => s === null)) throw notFound();

  const [api, ...rest] = decoded;
  if (!isValidApiName(api) || !isDir(join(root, api))) throw notFound();

  const method = event.req.method.toLowerCase();
  if (!METHODS.has(method)) throw notFound();

  const hit = resolveRoute(join(root, api), rest, method);
  if (!hit) throw notFound();

  let handler;
  try {
    handler = await loadHandler(hit.file);
  } catch (error) {
    console.error(`[plof] Could not load mounted route ${hit.file}:`, error);
    throw new HTTPError({ status: 500, message: "Route failed to load" });
  }

  event.context.params = { ...event.context.params, ...hit.params };
  return runWithApi(api, () => handler(event));
});
