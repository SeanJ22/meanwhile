import { readerRoute } from "@/lib/api/reader-route";
import { readerMeetingScope } from "@/lib/meetings/reader-scope";
import { haversineKm } from "@/lib/geo/distance";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { meetingListingIdentity } from "@/lib/meetings/listing-identity";
import { nearestZctaAsync } from "@/lib/geo/zcta-table";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index";
import { RADIUS_LADDER_KM, searchMeetings } from "@/lib/meetings/query";
import { snapshotSourceFor } from "@/lib/meetings/registry";
import type { Meeting } from "@/lib/sources/types";
import {
  getActiveSnapshotMeta,
  requireMeetingsProjection,
  snapshotClientMeta,
  type SnapshotClientMeta,
} from "@/lib/meetings/snapshot";
import {
  ensureReaderAuthorityEdge,
  prefetchReaderEdgeStates,
  readReaderEdgeMeetings,
  readReaderManifest,
  READER_MANIFEST_CACHE_TAG,
  READER_MAP_AUTHORITY_FAMILIES,
  servedWholeFromReaderEdge,
} from "@/lib/meetings/edge-serving";
import { stateOfOcdId } from "@/lib/meetings/edge-artifacts";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { CivicDataStoreUnavailableError } from "@/lib/civic-data/read-model";
import { readComposedSourcePlaces } from "@/lib/meetings/prepared-snapshot";
import { divisionIdsForZipArea, POINT_GEOMETRY_PLANS } from "@/lib/ballot/zip-divisions";
import { needsPill, zipCertainty } from "@/lib/geo/zip-certainty";
import { WIRED_STATUSES } from "@/lib/registry/coverage";
import { coverageAt, divisionsAt, divisionsByOcdIds, prefetchReaderGeography, prepareCoverage } from "@/lib/registry/server";
import type { Division } from "@/lib/registry/types";
import { matching, numeric, numericInRange, refuse, rejectUnknown } from "@/lib/api/params";
import { stageTimer } from "@/lib/api/server-timing";
import { currentCommentAccess, type CommentAccess } from "@/lib/registry/comment-access";
import { refreshCommentAccessFromPromoted } from "@/lib/civic-data/curated-reader-read-model";
import {
  currentEverydayRoutingProjection,
  readEverydayRoutingProjection,
} from "@/lib/routing/everyday-data-plane";
import type { EverydayRoutingProjection } from "@/lib/routing/everyday";



// The registry reads its geometry off the filesystem, which needs Node.
export const runtime = "nodejs";


const CDN_HELD = {
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-Cache-Tag": READER_MANIFEST_CACHE_TAG,
  "Netlify-Vary": "query",
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;
const NOT_HELD = { "Cache-Control": "no-store" } as const;

/** The states a request will most likely read, known before its divisions are. Only a prefetch hint. */
async function hintedStates(zip: string | null): Promise<string[]> {
  const entry = await zipDivisionEntry(zip).catch(() => null);
  return [...new Set((entry?.ids ?? []).map((id) => stateOfOcdId(id)).filter((s): s is string => s !== null))];
}

/** The nearest ZCTA to a point, capped at 60 km: a centre in open water or deep wilderness honestly has no zip. */
async function nearestZipWithin60Km(lat: number, lng: number): Promise<string | null> {
  const near = await nearestZctaAsync(lat, lng);
  return near && haversineKm(lat, lng, near.lat, near.lng) <= 60 ? near.zip : null;
}

export const GET = readerRoute("/api/meetings", async function GET(request: Request) {
  const timing = stageTimer();
  const params = new URL(request.url).searchParams;

  /* `Number(null)` is 0, not NaN: absent or malformed coordinates refuse with a stated reason (`lib/api/params.ts`), and an unknown parameter is named back. */
  const KNOWN = ["lat", "lng", "radiusKm", "zip"] as const;
  const unknown = rejectUnknown(params, KNOWN);
  if (!unknown.ok) return refuse(unknown.error);

  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const lat = latRead.value;
  const lng = lngRead.value;

  /* An absent `radiusKm` starts at the ladder's first rung; a present but unparseable one refuses. */
  const radiusRead = numeric(params, "radiusKm", { default: RADIUS_LADDER_KM[0] });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) {
    return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  }
  const radiusKm = Math.min(
    radiusRead.value,
    RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1],
  );

  /* A malformed zip refuses rather than becoming null; an absent one means the reader panned. Read at the door so a refused request never runs the search. */
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);

  /* Everything that reads neither the database nor the request's edge context starts here, before the authority families arrive. */
  prefetchReaderGeography();
  const nearZipRead = zipRead.value ? Promise.resolve(zipRead.value) : nearestZipWithin60Km(lat, lng).catch(() => null);

  const edgeManifest = await timing.time("manifest", () => readReaderManifest().catch(() => null));

  if (edgeManifest?.authorityArtifacts) {
    const entering = timing.time("authority", () =>
      ensureReaderAuthorityEdge(edgeManifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null),
    );
    const authorityEdge = await entering;
    if (authorityEdge) enterReaderAuthorityEdge(authorityEdge);
  }
  if (edgeManifest) prefetchReaderEdgeStates(edgeManifest, await nearZipRead.then(hintedStates));

  let commentAccess: readonly CommentAccess[] = [];
  let commentAccessDataState: "PROMOTED" | "FIRST_SEED" | "STORE_UNREACHABLE" = "FIRST_SEED";
  let commentAccessDataDetail: string | null = null;
  try {
    if (edgeManifest?.commentAccess !== undefined) {
      commentAccess = edgeManifest.commentAccess as readonly CommentAccess[];
      commentAccessDataState = "PROMOTED";
      commentAccessDataDetail = `Comment-access served from the reader edge manifest (sequence ${edgeManifest.sequence}).`;
    } else {
      if (process.env.NODE_ENV === "production") {
        const version = await refreshCommentAccessFromPromoted();
        commentAccessDataState = "PROMOTED";
        commentAccessDataDetail = `Canonical comment-access projection ${version} was read.`;
      }
      commentAccess = currentCommentAccess();
    }
  } catch (error) {
    // Comment rules are independent of meeting acquisition. Withhold only
    // this optional family and let the canonical meetings projection answer.
    commentAccessDataState = "STORE_UNREACHABLE";
    commentAccessDataDetail = error instanceof Error ? error.message : "The comment-access projection could not be read.";
  }
  let everydayRouting: EverydayRoutingProjection | null = null;
  let everydayRoutingDataState: "PROMOTED" | "FIRST_SEED" | "NOT_RECORDED" | "STORE_UNREACHABLE" | "INVALID" = "FIRST_SEED";
  let everydayRoutingDataDetail: string | null = null;
  try {
    if (edgeManifest?.everydayRouting !== undefined) {
      everydayRouting = (edgeManifest.everydayRouting as EverydayRoutingProjection | null) ?? null;
      everydayRoutingDataState = everydayRouting ? "PROMOTED" : "NOT_RECORDED";
      everydayRoutingDataDetail = `Everyday-routing served from the reader edge manifest (sequence ${edgeManifest.sequence}).`;
    } else if (process.env.NODE_ENV === "production") {
      const read = await readEverydayRoutingProjection();
      if (read.kind === "PROMOTED") {
        everydayRouting = read.value;
        everydayRoutingDataState = "PROMOTED";
        everydayRoutingDataDetail = `Canonical everyday-routing projection ${read.metadata.versionId} was read.`;
      } else if (read.kind === "NOT_RECORDED" || read.kind === "STORE_UNREACHABLE") {
        everydayRoutingDataState = read.kind;
        everydayRoutingDataDetail = read.detail;
      } else {
        everydayRoutingDataState = "INVALID";
        everydayRoutingDataDetail = "The everyday-routing pointer did not resolve to a promoted projection.";
      }
    } else {
      everydayRouting = currentEverydayRoutingProjection();
    }
  } catch (error) {
    // Direct-owner routing is independent of meetings and every other source.
    // Withhold only this optional projection; never reopen the tracked seed.
    everydayRoutingDataState = "INVALID";
    everydayRoutingDataDetail = error instanceof Error
      ? error.message
      : "The everyday-routing projection could not be read.";
  }

  const coverageReady = timing.time("coverageGraph", () => prepareCoverage()).catch(() => undefined);


  let divisionsAtPoint = new Set<string>();
  /* Null when the lookup failed, never empty: `coverageAt` must not read a failed resolution as "no body governs here". */
  let resolvedDivisions: Division[] | null = null;
  try {
    resolvedDivisions = await timing.time("divisions", () => divisionsAt(lat, lng));
    divisionsAtPoint = new Set(resolvedDivisions.map((d) => d.ocdId));
  } catch (error) {
    console.error("division lookup failed; online meetings fall back to body-in-view", error);
  }


  /* The divisions the point itself resolved, kept apart from the widened set (see `widenedInBodies`). */
  const pointOwnDivisionIds = new Set(divisionsAtPoint);
  if (zipRead.value && resolvedDivisions) {
    const widening = timing.start("widen");
    const areaIds = await divisionIdsForZipArea(
      zipRead.value,
      resolvedDivisions.map((d) => d.ocdId),
      undefined, POINT_GEOMETRY_PLANS,
    );
    const widened = await divisionsByOcdIds(areaIds, { zip: zipRead.value });
    widening();
    resolvedDivisions = widened;
    divisionsAtPoint = new Set(widened.map((d) => d.ocdId));
  }

  const meetingSourceName = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";
  let result;
  let snapshotMeta: SnapshotClientMeta | null = null;
  // Whether the meetings came whole from the published edge: the first of the
  // conditions for letting the CDN hold this answer (`CDN_HELD`).
  let meetingsWholeFromEdge = false;
  let heldMeetings: readonly Meeting[] = [];
  try {
    if (meetingSourceName === "snapshot") {
      const readerStates = resolvedDivisions
        ? [...new Set(
            resolvedDivisions
              .map((d) => stateOfOcdId(d.ocdId))
              .filter((s): s is string => s !== null),
          )]
        : [];
      const read = await timing.time("meetings", () => readReaderEdgeMeetings({
        manifest: edgeManifest,
        includeAgenda: false,
        ...(readerStates.length > 0 ? { states: readerStates } : {}),
        ...(resolvedDivisions?.length ? { ocdIds: resolvedDivisions.map(division => division.ocdId) } : {}),
        nearby: { lat, lng, radiusKm: Math.max(radiusKm, ...RADIUS_LADDER_KM) },
      }));
      meetingsWholeFromEdge = servedWholeFromReaderEdge(read);
      const snapshot = requireMeetingsProjection(read);
      heldMeetings = snapshot.meetings;
      result = await timing.time("search", () => searchMeetings(
        lat,
        lng,
        radiusKm,
        new Date(),
        divisionsAtPoint,
        snapshotSourceFor(snapshot),
      ));
      snapshotMeta =
        read.kind === "PROMOTED" || read.kind === "BOOTSTRAP"
          ? snapshotClientMeta(read.value, read)
          : null;
      if (snapshotMeta && meetingsWholeFromEdge && edgeManifest?.carriedSummary) {
        snapshotMeta.carried = edgeManifest.carriedSummary;
      }
    } else {
      result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionsAtPoint);
      snapshotMeta = await getActiveSnapshotMeta();
    }
  } catch (error) {
    if (error instanceof CivicDataStoreUnavailableError) {
      return Response.json(
        {
          error: "the meetings corpus is not available right now",
          dataState: "STORE_UNREACHABLE",
          code: error.result.code,
          detail: error.result.detail,
        },
        { status: 503, headers: { ...NOT_HELD, "Server-Timing": timing.header() } },
      );
    }
    return Response.json(
      {
        error: "the meetings projection could not be validated",
        dataState: "STORE_UNREACHABLE",
        code: "MEETINGS_PROJECTION_INVALID",
        detail: error instanceof Error ? error.message : "unknown meetings projection error",
      },
      { status: 503, headers: { ...NOT_HELD, "Server-Timing": timing.header() } },
    );
  }

  let coverage = null;
  try {
    await coverageReady;
    coverage = await timing.time("coverage", () => coverageAt(
      lat,
      lng,
      result.meetings.length,
      resolvedDivisions ?? undefined,
      heldMeetings,
    ));
  } catch (error) {
    console.error("coverage lookup failed", error);
  }

  /* On a typed zip, each body carries whether its territory covers the whole zip. Absent means not applicable, never certain. */
  /* A body arriving only through the widening must be `GOVERNING`; bodies on the point's own divisions are untouched. */
  if (coverage && zipRead.value) {
    const before = coverage.bodies.length;
    const kept = coverage.bodies.filter(
      (body) =>
        !body.ocdId || pointOwnDivisionIds.has(body.ocdId) || body.bodyClass === "GOVERNING",
    );
    if (kept.length !== before) {
      /* The counts are recomputed from the kept array, never carried over. */
      /* `WIRED_STATUSES` is imported, never retyped. */
      const governingKept = kept.filter((b) => b.bodyClass === "GOVERNING");
      coverage = {
        ...coverage,
        bodies: kept,
        counts: {
          ...coverage.counts,
          total: kept.length,
          withSource: kept.filter((b) => WIRED_STATUSES.has(b.coverageStatus)).length,
          withoutSource: kept.filter((b) => !WIRED_STATUSES.has(b.coverageStatus)).length,
          lookedAt: kept.filter((b) => b.lookedAt).length,
          governing: {
            total: governingKept.length,
            withSource: governingKept.filter((b) => WIRED_STATUSES.has(b.coverageStatus)).length,
          },
        },
      };
    }
  }

  if (coverage && zipRead.value) {
    const certainty = await zipCertainty(zipRead.value);
    if (certainty) {
      coverage = {
        ...coverage,
        bodies: coverage.bodies.map((body) =>
          body.ocdId && needsPill(certainty.certaintyOf(body.ocdId))
            ? { ...body, couldGovern: true }
            : body,
        ),
      };
    }
  }

  const meta = snapshotMeta;
  // A whole-source failure is attributed to the places the published composition says the source serves.
  const composed = meta?.sources.some((s) => !s.ok && !s.unreachableOcdIds) ? await readComposedSourcePlaces() : null;
  const snapshot = meta
    ? {
        version: 2 as const,
        generatedAt: meta.generatedAt,
        ...(meta.carried ? { carried: meta.carried } : {}),
        failed: meta.sources
          .filter((s) => !s.ok || (s.unreachableOcdIds?.length ?? 0) > 0)
          .map((s) => ({
            source: s.source,
            ocdIds:
              s.ok && s.unreachableOcdIds
                ? s.unreachableOcdIds
                : [...(composed?.get(s.source) ?? [])],
          })),
      }
    : null;

  const nearZip: string | null = await nearZipRead;
  /* The search log is written by the client's `sendBeacon` to `/api/log`, never on the response path. */

  /* The division ids the point resolved into; `null` when the resolution failed, which is not an empty list. */
  const governingOcdIds = resolvedDivisions
    ? resolvedDivisions.map((d) => d.ocdId)
    : null;

  /* Which of those divisions the ZIP could not settle, measured on `nearZip`; `null` where the zip is outside the committed geometry. */
  const partialOcdIds = (await zipCertainty(nearZip))?.partial ?? null;

  const held =
    meetingsWholeFromEdge &&
    resolvedDivisions !== null &&
    coverage !== null &&
    commentAccessDataState !== "STORE_UNREACHABLE" &&
    everydayRoutingDataState !== "STORE_UNREACHABLE" &&
    everydayRoutingDataState !== "INVALID";

  return Response.json({
    ...result,
    readerScope: readerMeetingScope({ heldMeetings: heldMeetings ?? result.meetings, shownMeetings: result.meetings, bodies: coverage?.bodies ?? [], ownDivisionIds: resolvedDivisions ? pointOwnDivisionIds : null, radiusKm: result.radiusKm, requestedRadiusKm: result.requestedRadiusKm, now: new Date(), listingIdentity: meetingListingIdentity(heldMeetings ?? result.meetings, canonicalBodyIdentity) }),
    commentAccess,
    commentAccessDataState,
    commentAccessDataDetail,
    everydayRouting,
    everydayRoutingDataState,
    everydayRoutingDataDetail,
    listingIdentity: meetingListingIdentity(result.meetings, canonicalBodyIdentity),
    coverage,
    snapshot,
    nearZip,
    governingOcdIds,
    partialOcdIds,
  }, {
    headers: { ...(held ? CDN_HELD : NOT_HELD), "Server-Timing": timing.header() },
  });
});
