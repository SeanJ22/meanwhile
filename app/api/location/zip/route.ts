import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { rejectUnknown } from "@/lib/api/params";
import { resolveZipLocation } from "@/lib/place-map/locations";

export const runtime = "nodejs";

// Only for a ZIP whose state has no published files yet (reader/zip3 and /api/answer answer the rest); this route goes when every state is published.
export async function GET(request: Request): Promise<Response> {
  await loadWebsiteSavedKeys();
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["zip"]);
  const zips = params.getAll("zip");
  if (!unknown.ok || zips.length !== 1 || !/^\d{5}$/.test(zips[0])) {
    return Response.json({ error: "Send one five-digit ZIP." }, { status: 400 });
  }
  const resolution = await resolveZipLocation(zips[0]);
  return Response.json({ location: resolution.ok ? resolution.centroid : null, resolution });
}
