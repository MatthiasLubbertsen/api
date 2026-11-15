import { createHash } from "node:crypto";
import { defineCachedHandler } from "nitro/cache";
import { apiFromPath, currentApi } from "./context.js";

/**
 * defineCachedHandler with a cache key that always starts with the API name.
 *
 *   export default defineApiCachedHandler(async (event) => { ... }, { name: "forecast", maxAge: 60 });
 *
 * Key: "<api>:<name>:<path+query>". `name` is required so two handlers in the same API never
 * share entries. Pass `getKey(event)` to replace the <path+query> part (the API prefix stays).
 *
 * Query params: like Nitro's defineCachedHandler, NO query params reach a cached handler unless
 * listed in `allowQuery` (e.g. allowQuery: ["city"]). Only allowed params go into the key.
 * Headers/cookies listed in `varies`, `allowCookies` or `allowAuthorization` are hashed into
 * the key too, so responses for different values are never mixed.
 */
export function defineApiCachedHandler(handler, opts = {}) {
  if (!opts.name) {
    throw new Error("[plof] defineApiCachedHandler needs a `name` option (unique within the API).");
  }
  const { getKey, name, ...rest } = opts;
  return defineCachedHandler(handler, {
    ...rest,
    name,
    getKey: async (event) => {
      const api = currentApi() ?? apiFromPath(event.url.pathname) ?? "_";
      const part = getKey ? await getKey(event) : event.url.pathname + allowedSearch(event.url, rest.allowQuery);
      return `${api}:${name}:${part}${variesSuffix(event, rest)}`;
    },
  });
}

function allowedSearch(url, allowQuery) {
  if (allowQuery === true) return url.search;
  if (!Array.isArray(allowQuery) || allowQuery.length === 0) return "";
  const params = new URLSearchParams();
  for (const name of [...allowQuery].sort()) {
    for (const value of url.searchParams.getAll(name).sort()) params.append(name, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function short(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

function variesSuffix(event, { varies = [], allowCookies, allowAuthorization }) {
  const headers = [...varies];
  if (allowAuthorization) headers.push("authorization");
  const parts = [...new Set(headers.map((h) => h.toLowerCase()))]
    .sort()
    .map((h) => `${h}.${short(event.req.headers.get(h))}`);
  if (allowCookies?.length) {
    const cookies = (event.req.headers.get("cookie") || "")
      .split(";")
      .map((c) => c.trim())
      .filter((c) => allowCookies.includes(c.split("=")[0]))
      .sort();
    parts.push(`cookie.${short(cookies.join(";"))}`);
  }
  return parts.length ? `:${parts.join(":")}` : "";
}
