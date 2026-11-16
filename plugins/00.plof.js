// Plof startup: scope env vars, then run each API's migrations.
// Runs once when the server boots, before any request is handled.
import { definePlugin } from "nitro";
import { migrations } from "#plof/manifest";
import { installScopedEnv } from "../plof/env.js";
import { migrateApi } from "../plof/db.js";
import { setReady } from "../plof/ready.js";

export default definePlugin(() => {
  installScopedEnv();

  setReady(
    (async () => {
      for (const [api, files] of Object.entries(migrations)) {
        const ran = await migrateApi(api, files);
        for (const name of ran) console.info(`[plof] migrated ${api}: ${name}`);
      }
    })().catch((error) => {
      console.error(error);
      console.error("[plof] Startup failed, refusing to serve requests.");
      process.exit(1);
    }),
  );
});
