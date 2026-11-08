import { loadWebsiteSavedKeys } from "../../../lib/core/keys-entry.ts";
import { readerRoute } from "@/lib/api/reader-route";
import { compressedJson } from "@/lib/api/compressed-json";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { stageTimer } from "@/lib/api/server-timing";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "@/lib/meetings/constants";
import { readerLocation, readerTerritory, readLocationPlace } from "@/lib/reader/location";
import { composeMeetingsAnswer } from "@/lib/reader/meetings-answer";
import { readStatePackage } from "@/lib/reader/state";
import { readReaderMeetingSettings } from "@/lib/meetings/reader-settings";
import { readerCacheHeaders,readerPlaceCacheHeaders } from "@/lib/reader/cache";
import {readerStateResponse} from "@/lib/reader/state-response";
import { readZipLocation } from "@/lib/place-map/locations";
import type { ReaderStateResponse } from "@/lib/reader/client";

export const runtime = "nodejs";

// A ZIP is answered by /api/answer once its state is published; this route then serves only a map view (a point and a radius), and a ZIP whose state is not published yet.
export const GET = readerRoute("/api/meetings", async function GET(request: Request) {
  await loadWebsiteSavedKeys();
  const timing = stageTimer(), params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["lat", "lng", "radiusKm", "zip", "include"]);
  if (!unknown.ok) return refuse(unknown.error);
  if (params.has("include") && params.get("include")!=="state") return refuse("include must be state");
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);
  const zipPoint = zipRead.value ? await readZipLocation(zipRead.value) : null;
  if (zipRead.value && !params.has("lat") && !params.has("lng")) {
    if (!zipPoint) return refuse("That ZIP could not be located");
    params.set("lat", String(zipPoint.lat)); params.set("lng", String(zipPoint.lng));
  }
  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const radiusRead = numeric(params, "radiusKm", { default: DEFAULT_RADIUS_KM });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  const lat = latRead.value, lng = lngRead.value, radiusKm = Math.min(radiusRead.value, MAX_RADIUS_KM);
  const stateAnswerRead = params.get("include")==="state" && zipRead.value ? readerStateResponse(request).then(async response=>{
    const value=await response.json() as ReaderStateResponse;
    return {status:response.status,headers:[...response.headers],value};
  }).catch(()=>
    ({status:503,headers:[["cache-control","no-store"]],value:{error:"The state's information could not be loaded"}})) : Promise.resolve(null);
  try {
    const location = await readerLocation(lat, lng, zipRead.value);
    // A map movement has one state read and one place read in this handler.
    // ZIP entry already starts its independent state endpoint before this read.
    const stateRead = zipRead.value ? Promise.resolve(null) : timing.time("state", () => readStatePackage(location.state));
    const territory = await readerTerritory(location.state);
    const placeRead = timing.time("place", () => readLocationPlace(location, lat, lng, territory));
    const [state, place, settings] = await Promise.all([
      stateRead, placeRead, readReaderMeetingSettings(),
    ]);
    const stateAnswer = await stateAnswerRead;
    const { answer, cachePlaces } = await composeMeetingsAnswer({ location, lat, lng, radiusKm, now: new Date(), place, state, settings, territory, stateResponse: stateAnswer });
    return await compressedJson(request, answer, { headers: { ...(stateAnswer && stateAnswer.status>=400 ? {"Cache-Control":"no-store"}
      : stateAnswer ? readerCacheHeaders({states:location.states,places:cachePlaces})
      : readerPlaceCacheHeaders(cachePlaces)),
      "Netlify-Vary": "query=lat|lng|radiusKm|zip|include", "Server-Timing": timing.header() } });
  } catch (error) {
    console.error("READER_PLACE_LOAD_FAILED", error);
    const stateAnswer = await stateAnswerRead;
    return Response.json({ error: "The place's information could not be loaded", dataState: "STORE_UNREACHABLE", ...(stateAnswer ? {stateResponse:stateAnswer} : {}) },
      { status: 503, headers: { "Cache-Control": "no-store", "Server-Timing": timing.header() } });
  }
});
