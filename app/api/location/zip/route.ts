import { rejectUnknown } from "@/lib/api/params";
import { lookupZcta, resolveZip } from "@/lib/geo/zcta";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["zip"]);
  const zips = params.getAll("zip");
  if (!unknown.ok || zips.length !== 1 || !/^\d{5}$/.test(zips[0])) {
    return Response.json({ error: "Send one five-digit ZIP." }, { status: 400 });
  }
  return Response.json({ location: lookupZcta(zips[0]), resolution: resolveZip(zips[0]) });
}
