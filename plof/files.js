import { createStorage, prefixStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import s3Driver from "unstorage/drivers/s3";
import { HTTPError } from "nitro";
import { requireApi } from "./context.js";
import { apiStoragePath } from "./paths.js";

// File storage for real files (uploads, images, PDFs), scoped per API.
//
//   FILES_DRIVER=fs (default)  -> storage/<apiname>/files/<name>
//   FILES_DRIVER=s3            -> s3://$S3_BUCKET/<apiname>/<name>
//
// Route code is identical for both: useApiFiles(event).setItemRaw / getItemRaw.

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate a file name like "photos/2024/cat.png". Rejects "..", ".", absolute paths,
 * backslashes, drive letters, ":" and anything outside [A-Za-z0-9._-] per segment.
 * Returns the name unchanged (the extension is kept as-is).
 */
export function assertSafeFileName(name) {
  const fail = (why) => {
    throw new HTTPError({ status: 400, message: `Invalid file name ${JSON.stringify(name)}: ${why}` });
  };
  if (typeof name !== "string" || name.length === 0) fail("must be a non-empty string");
  if (name.length > 512) fail("too long");
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) fail("absolute paths are not allowed");
  if (name.includes("\\") || name.includes(":") || name.includes("\0")) fail("contains forbidden characters");
  for (const segment of name.split("/")) {
    if (segment === "" || segment === "." || segment === "..") fail('empty, "." and ".." segments are not allowed');
    if (!SEGMENT_RE.test(segment)) fail("each path segment may only use letters, digits, '.', '_' and '-'");
  }
  return name;
}

function filesDriverName() {
  return (process.env.FILES_DRIVER || "fs").toLowerCase();
}

let s3Root;
function s3Storage() {
  if (s3Root) return s3Root;
  const missing = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(`[plof] FILES_DRIVER=s3 but these env vars are missing: ${missing.join(", ")}`);
  }
  s3Root = createStorage({
    driver: s3Driver({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    }),
  });
  return s3Root;
}

function createApiFileStorage(api) {
  const driver = filesDriverName();
  if (driver === "fs") return createStorage({ driver: fsDriver({ base: apiStoragePath(api, "files") }) });
  if (driver === "s3") return prefixStorage(s3Storage(), api); // keys become <api>/<name>
  throw new Error(`[plof] Unknown FILES_DRIVER "${driver}". Use "fs" or "s3".`);
}

const instances = new Map();

function toName(key) {
  return key.replaceAll(":", "/");
}

/**
 * The current API's file storage. All names go through assertSafeFileName.
 *
 *   const files = useApiFiles(event);
 *   await files.setItemRaw("photos/cat.png", bytes);
 *   const bytes = await files.getItemRaw("photos/cat.png"); // null if missing
 */
export function useApiFiles(event) {
  const api = requireApi(event);
  if (!instances.has(api)) instances.set(api, createApiFileStorage(api));
  const storage = instances.get(api);

  return {
    /** Store bytes (Uint8Array/Buffer/ArrayBuffer). `opts` is passed to the driver (S3: { headers }). */
    setItemRaw: (name, data, opts) => storage.setItemRaw(assertSafeFileName(name), data, opts),
    /** Read bytes, or null when the file does not exist. */
    getItemRaw: async (name) => {
      const value = await storage.getItemRaw(assertSafeFileName(name));
      if (value === null || value === undefined) return null;
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    hasItem: (name) => storage.hasItem(assertSafeFileName(name)),
    removeItem: (name) => storage.removeItem(assertSafeFileName(name)),
    getMeta: (name) => storage.getMeta(assertSafeFileName(name)),
    /** List file names, optionally under a folder ("photos"). Returns "photos/cat.png" style names. */
    getKeys: async (folder = "") => {
      if (folder) assertSafeFileName(folder);
      return (await storage.getKeys(folder)).map(toName);
    },
  };
}
