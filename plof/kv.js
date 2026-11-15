import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { requireApi } from "./context.js";
import { apiStoragePath } from "./paths.js";

const instances = new Map();

/**
 * The current API's key-value storage (unstorage), backed by storage/<apiname>/kv/.
 * Each API gets its own storage instance rooted in its own folder, so keys cannot
 * collide with or reach another API's keys. For JSON-sized values only.
 *
 *   const kv = useApiKv(event);
 *   await kv.setItem("settings", { units: "metric" });
 *   const settings = await kv.getItem("settings");
 */
export function useApiKv(event) {
  const api = requireApi(event);
  if (!instances.has(api)) {
    instances.set(
      api,
      createStorage({ driver: fsDriver({ base: apiStoragePath(api, "kv") }) }),
    );
  }
  return instances.get(api);
}
