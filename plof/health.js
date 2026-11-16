// GET / - health check. Public, no API context needed.
import { defineHandler } from "nitro";

export default defineHandler(() => ({ status: "ok" }));
