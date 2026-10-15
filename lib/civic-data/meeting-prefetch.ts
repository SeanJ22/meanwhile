import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import type { RoutineDataStore } from "./store.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { civicPlusEntryRequest } from "../sources/civicplus/index.ts";
import { SOURCE_PREFETCH_MAX_BYTES, type SourcePrefetchRequest } from "../sources/fetch-source.ts";
import { sourceRequestHeaders } from "../sources/http.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { DeadlineRuntimePool } from "../ops/independent-runtime-pass.ts";

const heldReads = new DeadlineRuntimePool(4);

type RootRequest = Omit<SourcePrefetchRequest, "byteCount">;
function publicGet(url: string, headers: HeadersInit): RootRequest {
  return { url: new URL(url).href, headers: [...new Headers(headers)].filter(([name]) => name !== "user-agent"), redirect: "follow" };
}

async function entryRequest(partition: MeetingPartitionContract, now: Date): Promise<RootRequest | null> {
  const wiring = partition.wiring;
  if (!wiring) return null;
  switch (partition.meetingSource) {
    case "civicplus": return civicPlusEntryRequest(wiring);
    case "ical": {
      const { icalFeedUrl, ICAL_ACCEPT } = await import("../sources/ical/index.ts");
      const url = icalFeedUrl(wiring);
      return url ? publicGet(url, sourceRequestHeaders(ICAL_ACCEPT)) : null;
    }
    case "civicclerk": {
      const { civicClerkEntryUrl } = await import("../sources/civicclerk/index.ts");
      return publicGet(civicClerkEntryUrl(wiring.config.apiBase), sourceRequestHeaders("application/json"));
    }
    case "clerksboards": {
      const { boardPageUrl } = await import("../sources/clerksboards/index.ts");
      return publicGet(boardPageUrl(wiring.config.boardId, wiring.config), sourceRequestHeaders("text/html"));
    }
    case "granicus": {
      const { granicusPublisherUrl } = await import("../sources/granicus/index.ts");
      return publicGet(granicusPublisherUrl(wiring.config.publisherUrl), sourceRequestHeaders("text/html"));
    }
    case "legistar": {
      const { legistarClientsFromWiring } = await import("../sources/legistar/client-registry.ts");
      const { API_ROOT, legistarPagePath, legistarEventFilter, legistarRequestHeaders } = await import("../sources/legistar/client.ts");
      const { legistarReadWindow } = await import("../sources/legistar/index.ts");
      const client = legistarClientsFromWiring([wiring])[0]!;
      if (client.eventBodyId === undefined && !client.eventBodyName?.trim()) return null;
      const path = client.eventBodyId === undefined ? legistarPagePath(`${client.slug}/bodies`, "BodyId")
        : legistarPagePath(`${client.slug}/events`, "EventId", legistarEventFilter({ ...legistarReadWindow(now), bodyId: client.eventBodyId }));
      return publicGet(`${API_ROOT}/${path}`, legistarRequestHeaders());
    }
    case "diligent": {
      const { diligentCalendarUrl } = await import("../sources/diligent/index.ts");
      return publicGet(diligentCalendarUrl(wiring, now.getTime()), sourceRequestHeaders("application/json"));
    }
    case "iqm2": {
      const { iqm2CalendarUrl } = await import("../sources/iqm2/index.ts");
      return publicGet(iqm2CalendarUrl(wiring, now.getTime()), sourceRequestHeaders());
    }
    case "apptegy": {
      const { apptegyCalendarUrl } = await import("../sources/apptegy/index.ts");
      return publicGet(apptegyCalendarUrl(wiring, new Date(now.getTime() - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString()), sourceRequestHeaders("application/json"));
    }
    case "novusagenda": {
      if (!wiring.config.bodyMatch?.trim()) return null;
      const { novusCalendarUrl } = await import("../sources/novusagenda/index.ts");
      const from = new Date(now.getTime() - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString();
      const to = new Date(now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString();
      return publicGet(novusCalendarUrl(wiring, from, to).href, sourceRequestHeaders("text/html"));
    }
    default: return null;
  }
}

export async function meetingPrefetchSeed(
  store: Pick<RoutineDataStore, "readPromotion">, partition: MeetingPartitionContract, now = new Date(),
): Promise<SourcePrefetchRequest | undefined> {
  if (!partition.wiring || partition.suspended) return;
  const request = await entryRequest(partition, now);
  if (!request) return;
  let seed: SourcePrefetchRequest | undefined;
  await heldReads.run(now.getTime(), async () => {
    const held = await store.readPromotion<MeetingsSnapshot>("MEETING", partition.scope);
    if (!held || held.sourceId !== partition.sourceId || held.scope !== partition.scope) return;
    const priorAt = new Date(held.payload.generatedAt);
    const priorRequest = Number.isFinite(priorAt.getTime()) ? await entryRequest(partition, priorAt) : null;
    const acquisitions = held.payload.sources.filter(source => source.source === partition.meetingSource).flatMap(source => source.acquisitions ?? []);
    const matches = acquisitions.filter(response => {
      if (response.httpStatus !== 200) return false;
      try { const url = new URL(response.requestedUrl).href; return url === new URL(request.url).href || url === (priorRequest && new URL(priorRequest.url).href); }
      catch { return false; }
    });
    if (!matches.length || matches.some(response => !Number.isSafeInteger(response.byteCount) || response.byteCount < 0 || response.byteCount > SOURCE_PREFETCH_MAX_BYTES)) return;
    seed = { ...request, byteCount: Math.max(...matches.map(response => response.byteCount)) };
  });
  return seed;
}
