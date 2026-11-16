import { resolve, join } from "node:path";

/** Storage root. STORAGE_DIR (default ./storage), resolved against the working directory. */
export function storageRoot() {
  return resolve(process.env.STORAGE_DIR || "./storage");
}

/** storage/<api>/ plus optional sub paths. `api` is always a validated API name. */
export function apiStoragePath(api, ...parts) {
  return join(storageRoot(), api, ...parts);
}
