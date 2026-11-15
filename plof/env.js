// Per-API environment variables.
//
// At startup every NITRO_* var is moved out of process.env into `scoped` (a Map that
// never leaves this module) and process.env is replaced with a Proxy:
//
//   NITRO_WEATHER_USERS_API_KEY=abc
//   -> inside a request to /weather/...   process.env.USERS_API_KEY === "abc"
//   -> inside a request to /other/...     process.env.USERS_API_KEY === undefined
//   -> outside any request                undefined + a warning explaining why
//
// Everything that is not NITRO_* (PORT, NODE_ENV, STORAGE_DIR, S3_*, ...) passes through.

import { currentApi, inApiContext, listApis } from "./context.js";
import { isValidApiName } from "./names.js";

const PREFIX = "NITRO_";

/** @type {Map<string, Map<string, string>>} api name -> (VAR -> value). Module-private. */
const scoped = new Map();

let installed = false;
const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Split NITRO_WEATHER_USERS_API_KEY into ["weather", "USERS_API_KEY"]. */
function parseKey(key) {
  const rest = key.slice(PREFIX.length);
  const i = rest.indexOf("_");
  if (i <= 0 || i === rest.length - 1) return null;
  const api = rest.slice(0, i).toLowerCase();
  if (!isValidApiName(api)) return null;
  return [api, rest.slice(i + 1)];
}

function capture(key, value) {
  const parsed = parseKey(key);
  if (!parsed) {
    warnOnce(
      `bad:${key}`,
      `[plof] Ignoring env var ${key}: NITRO_* vars must look like NITRO_<APINAME>_<VAR> ` +
        `(e.g. NITRO_WEATHER_API_KEY). Use PORT/HOST instead of NITRO_PORT/NITRO_HOST.`,
    );
    return;
  }
  const [api, name] = parsed;
  if (!scoped.has(api)) scoped.set(api, new Map());
  scoped.get(api).set(name, String(value));
}

function varsFor(api) {
  return (api && scoped.get(api)) || undefined;
}

/** Is `name` a scoped var of any API? Used only to explain undefined reads. */
function isScopedNameSomewhere(name) {
  for (const vars of scoped.values()) if (vars.has(name)) return true;
  return false;
}

function explainUndefined(prop) {
  if (typeof prop !== "string") return;
  if (prop.startsWith(PREFIX)) {
    // Only explain names that belong to a real API. Nitro itself probes NITRO_HOST,
    // NITRO_SSL_CERT etc. at boot; those are not worth a warning.
    const parsed = parseKey(prop);
    if (!parsed || !listApis().includes(parsed[0])) return;
    warnOnce(
      `raw:${prop}`,
      `[plof] process.env.${prop} is undefined: Plof moves all NITRO_* vars out of process.env at startup. ` +
        `Inside a request to the owning API, read it without the prefix ` +
        `(NITRO_<APINAME>_FOO -> process.env.FOO).`,
    );
  } else if (!inApiContext() && isScopedNameSomewhere(prop)) {
    warnOnce(
      `outside:${prop}`,
      `[plof] process.env.${prop} is undefined here: per-API vars (NITRO_<APINAME>_${prop}) only exist ` +
        `inside a request handled by routes/<apiname>/. You are reading it outside a request ` +
        `(module top level, plugin, timer?). Move the read into the handler.`,
    );
  }
}

export function installScopedEnv() {
  if (installed) return;
  installed = true;

  const realEnv = process.env;
  for (const key of Object.keys(realEnv)) {
    if (!key.startsWith(PREFIX)) continue;
    capture(key, realEnv[key]);
    delete realEnv[key];
  }

  const known = new Set(listApis());
  for (const api of scoped.keys()) {
    if (!known.has(api)) {
      console.warn(
        `[plof] Env vars found for API "${api}" (NITRO_${api.toUpperCase()}_*) but there is no routes/${api}/ folder.`,
      );
    }
  }

  const proxy = new Proxy(realEnv, {
    get(target, prop) {
      if (typeof prop === "string") {
        const vars = varsFor(currentApi());
        if (vars?.has(prop)) return vars.get(prop);
        if (prop.startsWith(PREFIX)) {
          explainUndefined(prop);
          return undefined;
        }
      }
      const value = Reflect.get(target, prop);
      if (value === undefined) explainUndefined(prop);
      return value;
    },
    has(target, prop) {
      if (typeof prop === "string") {
        if (varsFor(currentApi())?.has(prop)) return true;
        if (prop.startsWith(PREFIX)) return false;
      }
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = new Set(Reflect.ownKeys(target));
      const vars = varsFor(currentApi());
      if (vars) for (const name of vars.keys()) keys.add(name);
      return [...keys];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string") {
        const vars = varsFor(currentApi());
        if (vars?.has(prop)) {
          return { value: vars.get(prop), writable: true, enumerable: true, configurable: true };
        }
        if (prop.startsWith(PREFIX)) return undefined;
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set(target, prop, value) {
      // Late NITRO_* writes get scoped too, so nothing can leak back into the global env.
      if (typeof prop === "string" && prop.startsWith(PREFIX)) {
        capture(prop, value);
        return true;
      }
      return Reflect.set(target, prop, value);
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string" && prop.startsWith(PREFIX)) {
        const parsed = parseKey(prop);
        if (parsed) scoped.get(parsed[0])?.delete(parsed[1]);
        return true;
      }
      return Reflect.deleteProperty(target, prop);
    },
  });

  process.env = proxy;
}
