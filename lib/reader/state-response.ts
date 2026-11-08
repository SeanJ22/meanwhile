import { loadWebsiteSavedKeys } from "../core/keys-entry.ts";
import { readZipPlace, withPlaceMapReads, type PlaceEntry } from "../place-map/reader";
import { stateOfficesForStates } from "../reference/state-offices";
import { readStatePackage } from "../reader/state";
import { requireRegistryState } from "../civic-data/state-scopes";
import { withReaderRoute } from "../db/reader-route";
import { readerStateCacheHeaders } from "../reader/cache";
import { composeStateAnswer } from "./state-answer";

export async function readerStateResponse(request: Request) {
  await loadWebsiteSavedKeys();
  return withPlaceMapReads(() => stateResponse(request));
}

async function stateResponse(request: Request) {
  const params = new URL(request.url).searchParams;
  const zip = params.get("zip");
  if (zip !== null && !/^\d{5}$/.test(zip)) return Response.json({ error: "A five digit ZIP is required" }, { status: 400 });
  let indexed: PlaceEntry | null;
  try { indexed = zip ? await readZipPlace(zip) : null; }
  catch { return Response.json({ error: "The place map could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const input = params.get("state") ?? indexed?.states?.[0] ?? "";
  let state: string;
  try { state = requireRegistryState(input.replace(/^US-/i, "")); }
  catch { return Response.json({ error: "A US state or territory is required" }, { status: 400 }); }
  try {
    const divisionIds = indexed?.ids ?? [];
    const value = await withReaderRoute("/api/reader/state", () => readStatePackage(state, divisionIds, zip ?? undefined, { earlyDistricts: true }));
    const answer = composeStateAnswer(state, zip, indexed, value, stateOfficesForStates([state]));
    return Response.json(answer, { headers: {
      ...readerStateCacheHeaders(state),
      "Netlify-Vary": "query=state|zip",
      "ETag": `"${value.version}:${zip ?? state}"`,
    } });
  } catch {
    return Response.json({ error: "The state's information could not be loaded" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
