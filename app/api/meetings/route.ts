import { readerMeetingScope } from "@/lib/meetings/reader-scope";
import { haversineKm } from "@/lib/geo/distance";
import { canonicalBodyIdentity } from "@/lib/ask/body-identity";
import { meetingListingIdentity } from "@/lib/meetings/listing-identity";
import { nearestZctaAsync } from "@/lib/geo/zcta-table";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index";
import { searchMeetings } from "@/lib/meetings/query";
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from "@/lib/meetings/constants";
import { getRegistryRuntimeReadModel } from "@/lib/registry/runtime-read-model";
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
import { currentCommentAccess, readCommentAccessFacts, type CommentAccess } from "@/lib/registry/comment-access";
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

export async function GET(request: Request) {
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

  const radiusRead = numeric(params, "radiusKm", { default: DEFAULT_RADIUS_KM });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) {
    return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  }
  const radiusKm = Math.min(
    radiusRead.value,
    MAX_RADIUS_KM,
  );

  /* A malformed zip refuses rather than becoming null; an absent one means the reader panned. Read at the door so a refused request never runs the search. */
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);

  /* Everything that reads neither the database nor the request's edge context starts here, before the authority families arrive. */
  prefetchReaderGeography();
  const nearZipRead = zipRead.value ? Promise.resolve(zipRead.value) : nearestZipWithin60Km(lat, lng).catch(() => null);
  const statesHinted = nearZipRead.then(hintedStates);

  // One edge read serves the whole ready-to-display bundle. The manifest
  // (CDN-cached, no database) carries meetings (via its scope artifacts) AND the
  // comment-access + everyday-routing families, so a normal visit never wakes the
  // database. Each family below prefers the embedded edge value and falls back to
  // its own database read only when the edge has not published it yet.
  const edgeManifest = await timing.time("manifest", () => readReaderManifest().catch(() => null));

  // Bind the reader-authority edge bundle (registry-runtime division/
  // coverage/roster bindings, the federal directory, and campaign-site URLs)
  // request-scoped, so divisionsAt/coverageAt below serve them from the edge and
  // never wake Neon. Each family is fetched at most once per version per process.
  // Any family the manifest omits (rollout) falls through to the DB reader.
  //
  // Only the families this route reads (`READER_MAP_AUTHORITY_FAMILIES`:
  // not Ask's recorded outcomes, not the comment-access artifact the manifest
  // already embeds). The edge is entered HERE, in this handler's own execution:
  // it is AsyncLocalStorage.enterWith, which never reaches reads
  // chained on a helper that entered it.
  if (edgeManifest?.authorityArtifacts) {
    const entering = timing.time("authority", () =>
      ensureReaderAuthorityEdge(edgeManifest, undefined, READER_MAP_AUTHORITY_FAMILIES).catch(() => null),
    );
    prefetchReaderEdgeStates(edgeManifest, await statesHinted);
    const authorityEdge = await entering;
    if (authorityEdge) enterReaderAuthorityEdge(authorityEdge);
  } else if (edgeManifest) {
    prefetchReaderEdgeStates(edgeManifest, await statesHinted);
  }

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
        const { versionId } = await readCommentAccessFacts();
        commentAccessDataState = "PROMOTED";
        commentAccessDataDetail = `Comment rules read from live facts (${versionId}).`;
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

  // The coverage graph (rosters, photos, officeholder indexes) builds from
  // here, beside the division lookup and the meetings read, rather than after
  // them. Started after the edge is entered, so it reads the edge; a failure is
  // not held and `coverageAt` below meets it on its own terms.
  const coverageReady = timing.time("coverageGraph", () => prepareCoverage()).catch(() => undefined);

  let divisionsAtPoint = new Set<string>();
  /* Null when the lookup failed, never empty: `coverageAt` must not read a failed resolution as "no body governs here". */
  let resolvedDivisions: Division[] | null = null;
  try {
    resolvedDivisions = await timing.time("divisions", () => divisionsAt(lat, lng));
    divisionsAtPoint = new Set(resolvedDivisions.map((d) => d.ocdId));
  } catch (error) {
    console.error("division lookup failed", error);
  }

  /*
   * On a typed zip, the divisions are widened to every one whose territory reaches inside it. Only when the
   * point lookup succeeded. A selected source plan replaces its old district family atomically.
   */
  /* The divisions the point itself resolved, kept apart from the widened set (see `widenedInBodies`). */
  const pointOwnDivisionIds = new Set(divisionsAtPoint);
  if (zipRead.value && resolvedDivisions) {
    const zipArea = timing.start("zipArea");
    const areaIds = await divisionIdsForZipArea(
      zipRead.value,
      resolvedDivisions.map((d) => d.ocdId),
      undefined, POINT_GEOMETRY_PLANS,
    );
    const zipDivisions = await divisionsByOcdIds(areaIds, { zip: zipRead.value });
    zipArea();
    resolvedDivisions = zipDivisions;
    divisionsAtPoint = new Set(zipDivisions.map((d) => d.ocdId));
  }

  // One projection read per request. The search and the freshness meta
  // both derive from the SAME composed snapshot, instead of each reading,
  // validating and composing the 124-partition projection independently — two
  // full passes for one request. The `WTP_MEETING_SOURCE` diagnostic seam
  // (mock/composite, non-production only) does not read the canonical
  // projection, so it keeps its own path.
  const meetingSourceName = process.env.WTP_MEETING_SOURCE?.trim() || "snapshot";
  let result;
  let snapshotMeta: SnapshotClientMeta | null = null;
  // Whether the meetings came whole from the published edge: the first of the
  // conditions for letting the CDN hold this answer (`CDN_HELD`).
  let meetingsWholeFromEdge = false;
  let heldMeetings: readonly Meeting[] = [];
  try {
    if (meetingSourceName === "snapshot") {
      // Read the runner-published geographic edge artifacts for this
      // ZIP's state(s) — one small edge fetch, no database wake, no 124-partition
      // compose. The scopes are the states the resolved divisions name (plus the
      // national `us` bucket); when the division lookup failed we pass none and
      // the reader loads every published scope rather than guess. Fallback chain
      // is edge → DB prepared row → live compose, so the result shape is
      // identical and the freshness meta below is unchanged.
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
        ocdIds: resolvedDivisions?.map(division => division.ocdId) ?? [],
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
        undefined,
        resolvedDivisions ? getRegistryRuntimeReadModel().registry.bodies : [],
      ));
      snapshotMeta =
        read.kind === "PROMOTED" || read.kind === "BOOTSTRAP"
          ? snapshotClientMeta(read.value, read)
          : null;
    } else {
      result = await searchMeetings(lat, lng, radiusKm, new Date(), divisionsAtPoint, undefined, undefined,
        resolvedDivisions ? getRegistryRuntimeReadModel().registry.bodies : []);
      heldMeetings = result.meetings;
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

  // A coverage statement we cannot stand behind is worse than none, so a
  // registry that fails to load leaves the meeting answer intact rather
  // than failing the whole request or guessing.
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

  // When the snapshot serves the answer, say how old it is and which sources
  // it is missing — a failed source's bodies would otherwise show nothing
  // with no hint that the gap is ours and temporary.
  // The one projection read above already produced this; no second read.
  const meta = snapshotMeta;
  // A whole-source failure is attributed to the places the published composition says the source serves.
  const composed = meta?.sources.some((s) => !s.ok && !s.unreachableOcdIds) ? await readComposedSourcePlaces() : null;
  // `meta.carried` rides along untouched: the footer's one age is true of
  // the fresh rows only, and the count of rows it is NOT true of has to reach
  // the client or the line keeps speaking for them.
  //
  // The wire snapshot is trimmed to exactly what a reader
  // surface reads — the age, the carried-rows summary, and the failed sources
  // attributed to bodies. `meta.sources` (124 rows) and `meta.partitions` (124
  // rows) together ran ~40-50 KB of every response and no client reads either;
  // they are used here to build `failed`, then dropped. `version` lets a later
  // format change be detected rather than guessed from shape.
  const snapshot = meta
    ? {
        version: 2 as const,
        generatedAt: meta.generatedAt,
        ...(meta.carried ? { carried: meta.carried } : {}),
        failed: meta.sources
          .filter((s) => !s.ok || (s.unreachableOcdIds?.length ?? 0) > 0)
          .map((s) => ({
            source: s.source,
            // A PARTIAL refusal names its own divisions and nothing else.
            // A whole-source failure still attributes to every body the
            // source serves. A division-less body (null ocdId) has no
            // division to attribute the failure to; its absence is visible on
            // the body itself.
            ocdIds:
              s.ok && s.unreachableOcdIds
                ? s.unreachableOcdIds
                : [...(composed?.get(s.source) ?? [])],
          })),
      }
    : null;

  // The settled-viewport fetch carries no zip: the reader panned, they
  // didn't type. Resolve the nearest ZCTA centroid so the notices and the
  // ballot bubble can name the area, and cap it: a center more than 60 km
  // from every centroid (open water, deep wilderness) honestly has no zip.
  // Same orientation-only status as a typed zip — never district truth.
  // Started at the top (`nearZipRead`), from the table loaded on demand
  // (`lib/geo/zcta-table.ts`).
  const nearZip: string | null = await nearZipRead;
  /* The search log is written by the client's `sendBeacon` to `/api/log`, never on the response path. */

  /* The division ids the point resolved into; `null` when the resolution failed, which is not an empty list. */
  const governingOcdIds = resolvedDivisions
    ? resolvedDivisions.map((d) => d.ocdId)
    : null;

  /* Which of those divisions the ZIP could not settle, measured on `nearZip`; `null` where the zip is outside the committed geometry. */
  const partialOcdIds = (await zipCertainty(nearZip))?.partial ?? null;

  // The CDN holds only a whole answer (see `CDN_HELD`): meetings served whole
  // from the published edge, divisions and coverage resolved, and neither
  // optional family withheld for a failed read.
  const held =
    meetingsWholeFromEdge &&
    resolvedDivisions !== null &&
    coverage !== null &&
    commentAccessDataState !== "STORE_UNREACHABLE" &&
    everydayRoutingDataState !== "STORE_UNREACHABLE" &&
    everydayRoutingDataState !== "INVALID";

  return Response.json({
    ...result,
    readerScope: readerMeetingScope({ heldMeetings: heldMeetings, bodies: coverage?.bodies ?? [], ownDivisionIds: resolvedDivisions ? divisionsAtPoint : null, now: new Date(), listingIdentity: meetingListingIdentity(heldMeetings, canonicalBodyIdentity) }),
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
}
