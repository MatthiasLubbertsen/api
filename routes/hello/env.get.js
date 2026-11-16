// GET /hello/env - which per-API env var NAMES this API can see (values are never returned).
// Demo of isolation: NITRO_WEATHER_* vars are invisible here.
import { defineHandler } from "nitro";

export default defineHandler(() => ({
  visible: ["GREETING", "API_KEY", "UNITS"].filter((k) => k in process.env),
}));
