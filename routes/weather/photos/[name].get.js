// GET /weather/photos/<name> - serves a stored photo (same code for fs and S3).
import { defineHandler, HTTPError } from "nitro";
import { getRouterParam } from "nitro/h3";
import { useApiFiles } from "#plof";

const TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

export default defineHandler(async (event) => {
  const name = getRouterParam(event, "name");
  const bytes = await useApiFiles(event).getItemRaw(`photos/${name}`); // validates the name
  if (!bytes) throw new HTTPError({ status: 404, message: "Photo not found" });

  const ext = name.split(".").pop().toLowerCase();
  return new Response(bytes, {
    headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
  });
});
