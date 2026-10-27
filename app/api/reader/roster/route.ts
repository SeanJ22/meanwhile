import { readerRoute } from "@/lib/api/reader-route";
import { matching, refuse, rejectUnknown } from "@/lib/api/params";
import { factReader } from "@/lib/facts/db";
import { readBodyRoster, placeBodyRoster, readerRosterKey } from "@/lib/reader/body-roster";
import { buildPlacePackage } from "@/lib/reader/place-builder";
import { registryJurisdictions } from "@/lib/civic-data/state-scopes";
import { shareReaderValues } from "@/lib/reader/shared";
import { readerCacheHeaders } from "@/lib/reader/cache";

export const runtime = "nodejs";

export const GET = readerRoute("/api/reader/roster", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["hash", "body"]);
  if (!unknown.ok) return refuse(unknown.error);
  const hash = matching(params, "hash", /^[a-f0-9]{64}$/, { default: null });
  if (!hash.ok) return refuse(hash.error);
  const bodyParams = new URLSearchParams(params);
  if (!bodyParams.has("body") && request.headers.has("x-reader-body")) bodyParams.set("body", request.headers.get("x-reader-body")!);
  const body = matching(bodyParams, "body", /^.{1,512}$/, { default: null });
  if (!body.ok) return refuse(body.error);
  if (!hash.value && !body.value) return refuse("body or hash is required");
  try {
    const query = factReader();
    if (!query) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
    let roster = hash.value ? await readBodyRoster(query, hash.value) : null;
    let state = body.value ? registryJurisdictions(body.value)[0] ?? "" : "";
    // A first visit can precede the runner's first build. Read only that body's selected facts.
    if (!roster) {
      if (!body.value) return Response.json({ error: "This body's members could not be loaded" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      const [entity] = await query(`SELECT id,state FROM entity WHERE id=coalesce(
        (SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=$1),$1)`, [body.value]);
      state = String(entity?.state ?? state);
      if (!state) return Response.json({ error: "This body's members could not be loaded" }, { status: 404, headers: { "Cache-Control": "no-store" } });
      const place = await buildPlacePackage({ state, divisionIds: [], bodyIds: [String(entity?.id ?? body.value)], includeAgenda: false, includeRoster: true }, query);
      roster = placeBodyRoster(place, String(entity?.id ?? body.value));
      if (hash.value && readerRosterKey(roster) !== hash.value)
        return Response.json({ error: "This body's members have changed. Please reopen the place." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const headers = { ...(hash.value ? { "Cache-Control": "public, max-age=31536000, immutable",
      "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000" } : readerCacheHeaders({ states: [state] })),
      ETag: `"${readerRosterKey(roster)}"`, "Netlify-Vary": "query=hash|body" };
    if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
    return Response.json(shareReaderValues(roster), { headers });
  } catch (error) {
    console.error("READER_ROSTER_LOAD_FAILED", error);
    return Response.json({ error: "This body's members could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
});
