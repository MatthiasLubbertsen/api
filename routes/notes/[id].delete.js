// DELETE /notes/:id
import { defineHandler, HTTPError } from "nitro";
import { getRouterParam } from "nitro/h3";
import { useApiDb } from "#plof";

export default defineHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const db = await useApiDb(event);
  const { rows } = await db.sql`SELECT id FROM notes WHERE id = ${id}`;
  if (rows.length === 0) throw new HTTPError({ status: 404, message: "Note not found" });
  await db.sql`DELETE FROM notes WHERE id = ${id}`;
  event.res.status = 204;
  return null;
});
