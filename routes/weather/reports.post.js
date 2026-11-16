// POST /weather/reports
// Body: { "city": "Oslo", "tempC": 3.5, "note": "windy", "photo": { "name": "oslo.jpg", "base64": "..." } }
// Header: x-api-key: <NITRO_WEATHER_API_KEY>
import { defineHandler, HTTPError } from "nitro";
import { useApiDb, useApiKv, useApiFiles } from "#plof";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export default defineHandler(async (event) => {
  // NITRO_WEATHER_API_KEY, visible here as API_KEY. Read it inside the handler, never at module top level.
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new HTTPError({ status: 500, message: "NITRO_WEATHER_API_KEY is not configured" });
  if (event.req.headers.get("x-api-key") !== apiKey) {
    throw new HTTPError({ status: 401, message: "Missing or wrong x-api-key header" });
  }

  const body = await event.req.json().catch(() => {
    throw new HTTPError({ status: 400, message: "Body must be JSON" });
  });

  const city = typeof body?.city === "string" ? body.city.trim() : "";
  const tempC = Number(body?.tempC);
  if (!city || city.length > 100) throw new HTTPError({ status: 400, message: "city is required (max 100 chars)" });
  if (!Number.isFinite(tempC)) throw new HTTPError({ status: 400, message: "tempC must be a number" });
  const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;

  const id = crypto.randomUUID();

  // Files: store the photo under photos/<id>.<ext>, keeping the original extension.
  let photo = null;
  if (body.photo) {
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(String(body.photo.name ?? ""))?.[1];
    if (!ext) throw new HTTPError({ status: 400, message: "photo.name needs a file extension" });
    const bytes = Buffer.from(String(body.photo.base64 ?? ""), "base64");
    if (bytes.length === 0) throw new HTTPError({ status: 400, message: "photo.base64 is empty" });
    if (bytes.length > MAX_PHOTO_BYTES) throw new HTTPError({ status: 413, message: "photo is larger than 5 MB" });
    photo = `photos/${id}.${ext}`;
    await useApiFiles(event).setItemRaw(photo, bytes);
  }

  // Database: storage/weather/db.sqlite (or NITRO_WEATHER_DATABASE_URL).
  const db = await useApiDb(event);
  const createdAt = new Date().toISOString();
  await db.sql`INSERT INTO reports (id, city, temp_c, note, photo, created_at)
               VALUES (${id}, ${city}, ${tempC}, ${note}, ${photo}, ${createdAt})`;

  // KV: small JSON record with the latest report per city, plus a counter.
  const kv = useApiKv(event);
  await kv.setItem(`latest:${city.toLowerCase()}`, { id, tempC, createdAt });
  await kv.setItem("stats", { totalReports: ((await kv.getItem("stats"))?.totalReports ?? 0) + 1 });

  event.res.status = 201;
  return { id, city, tempC, note, photo, createdAt };
});
