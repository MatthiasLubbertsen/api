// GET /notes - newest 50 notes
import { defineHandler } from "nitro";
import { useApiDb } from "#plof";

export default defineHandler(async (event) => {
  const db = await useApiDb(event);
  const { rows } = await db.sql`SELECT * FROM notes ORDER BY created_at DESC LIMIT 50`;
  return { notes: rows };
});
