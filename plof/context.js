import { AsyncLocalStorage } from "node:async_hooks";
import { HTTPError } from "nitro";
import { apis } from "#plof/manifest";

// Holds { api } for the current request. Set by middleware/00.plof.js for every
// request, and by Plof itself when it does per-API work at startup (migrations).
const apiStorage = new AsyncLocalStorage();

const knownApis = new Set(apis);

/** Run `fn` with `api` as the current API (env vars, DB, KV and files follow it). */
export function runWithApi(api, fn) {
  return apiStorage.run({ api }, fn);
}

/** True when called inside a request (or a runWithApi block). */
export function inApiContext() {
  return apiStorage.getStore() !== undefined;
}

/** Name of the current API, or null outside a request / for paths that are not an API. */
export function currentApi() {
  return apiStorage.getStore()?.api ?? null;
}

/** First path segment of a request URL, if it names a known API. */
export function apiFromPath(pathname) {
  const segment = pathname.split("/")[1] || "";
  return knownApis.has(segment) ? segment : null;
}

/**
 * Resolve the API for an event. Helpers take `event` so route code reads naturally,
 * but the source of truth is the request's AsyncLocalStorage (same value).
 */
export function requireApi(event) {
  const api = currentApi() ?? (event?.url ? apiFromPath(event.url.pathname) : null);
  if (!api) {
    throw new HTTPError({
      status: 500,
      message: "[plof] No API context. Plof helpers only work inside routes/<api>/ handlers.",
    });
  }
  return api;
}

export function listApis() {
  return [...apis];
}
