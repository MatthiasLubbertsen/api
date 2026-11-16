// POST /notes  { "text": "buy milk" }
import { defineHandler, HTTPError } from "nitro";
import { useApiDb } from "#plof";

export default defineHandler(async (event) => {
  const body = await event.req.json().catch(() => {
    throw new HTTPError({ status: 400, message: "Body must be JSON" });
  });
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 500) throw new HTTPError({ status: 400, message: "text is required (max 500 chars)" });

  const note = { id: crypto.randomUUID(), text, created_at: new Date().toISOString() };
  const db = await useApiDb(event);
  await db.sql`INSERT INTO notes (id, text, created_at) VALUES (${note.id}, ${note.text}, ${note.created_at})`;

  event.res.status = 201;
  return note;
});
