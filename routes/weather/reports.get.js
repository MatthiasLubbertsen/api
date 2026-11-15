// GET /weather/reports?city=Oslo
// Cached for 10 seconds per API + path + ?city (pretend this query is slow).
import { getQuery } from "nitro/h3";
import { defineApiCachedHandler, useApiDb, useApiKv } from "#plof";

export default defineApiCachedHandler(
  async (event) => {
    const { city } = getQuery(event);
    const db = await useApiDb(event);

    const { rows } = city
      ? await db.sql`SELECT * FROM reports WHERE city = ${String(city)} ORDER BY created_at DESC LIMIT 50`
      : await db.sql`SELECT * FROM reports ORDER BY created_at DESC LIMIT 50`;

    // NITRO_WEATHER_UNITS -> process.env.UNITS ("metric" or "imperial").
    const units = process.env.UNITS === "imperial" ? "imperial" : "metric";
    const stats = (await useApiKv(event).getItem("stats")) ?? { totalReports: 0 };

    return {
      units,
      stats,
      generatedAt: new Date().toISOString(),
      reports: rows.map((r) => ({
        id: r.id,
        city: r.city,
        temperature: units === "imperial" ? Math.round((r.temp_c * 9) / 5 + 32) : r.temp_c,
        note: r.note,
        photoUrl: r.photo ? `/weather/${r.photo}` : null,
        createdAt: r.created_at,
      })),
    };
  },
  { name: "reports", maxAge: 10, allowQuery: ["city"] },
);
