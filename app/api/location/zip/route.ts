import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { rejectUnknown } from "@/lib/api/params";
import { zipLocationAnswer } from "@/lib/place-map/locations";
import { readerCacheHeaders, withReaderZipTag } from "@/lib/reader/cache";
import { readZipAnswer } from "@/lib/reader/zip-answer";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["zip"]);
  const zips = params.getAll("zip");
  if (!unknown.ok || zips.length !== 1 || !/^\d{5}$/.test(zips[0])) {
    return Response.json({ error: "Send one five-digit ZIP." }, { status: 400 });
  }
  const zip = zips[0];
  const published = await readZipAnswer(zip);
  // A ZIP not yet published is answered from the database; this goes once every ZIP is published.
  if (!published) await loadWebsiteSavedKeys();
  const body = published?.location ?? await zipLocationAnswer(zip);
  // Only a located ZIP is kept by the CDN; "not covered" can change as soon as the place map does.
  const located = (body as { location?: unknown }).location != null;
  return Response.json(body, located ? { headers: { ...withReaderZipTag(readerCacheHeaders({}), zip), "Netlify-Vary": "query=zip" } } : undefined);
}
