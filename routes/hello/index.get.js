// GET /hello?name=Matthias - greeting from NITRO_HELLO_GREETING, plus a visit counter in KV
import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { useApiKv } from "#plof";

export default defineHandler(async (event) => {
  const { name = "stranger" } = getQuery(event);
  const greeting = process.env.GREETING || "Hello";
  const kv = useApiKv(event);
  const visits = ((await kv.getItem("visits")) ?? 0) + 1;
  await kv.setItem("visits", visits);
  return { message: `${greeting}, ${String(name).slice(0, 50)}!`, visits };
});
