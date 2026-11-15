// Wraps every request in the API context taken from the first path segment:
// /weather/reports -> "weather". Env vars, DB, KV and files all follow this value.
import { defineMiddleware } from "nitro";
import { apiFromPath, runWithApi } from "../plof/context.js";
import { whenReady } from "../plof/ready.js";

export default defineMiddleware(async (event, next) => {
  await whenReady();
  return runWithApi(apiFromPath(event.url.pathname), () => next());
});
