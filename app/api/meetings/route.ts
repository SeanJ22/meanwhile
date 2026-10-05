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
import { wiringForSourceName } from "@/lib/sources/composite/wiring";
import { divisionIdsForZipArea } from "@/lib/ballot/zip-divisions";
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

/**
 * GET /api/meetings?lat=&lng=&radiusKm=
 *
 * The map's only data dependency. It returns normalized meetings plus which
 * rung of the empty-state cascade produced them, so the client can say what it
 * did rather than silently showing a wider area than was asked for.
 *
 * It also attaches the coverage summary: which bodies govern this point and how
 * many of them have a calendar wired. The two answers belong together, because
 * an empty meeting list means nothing until you know whether it is government
 * being quiet or us being blind.
 */

// The registry reads its geometry off the filesystem, which needs Node.
export const runtime = "nodejs";

/**
 * **A COMPLETE ANSWER IS SERVED FROM THE CDN.** (C21, 2026-09-25.)
 *
 * A fresh server instance spent 2-4.5 s answering this route (production,
 * 2026-09-25: median 3.8 s, five of ten over the 3 s bar), and every first
 * visit after a deploy or beyond the warm pool paid it. The answer is a pure
 * function of the query and the published reader data — nothing in it comes
 * from a cookie, a header or the visitor — so one computation can serve every
 * reader who asks the same question, and a CDN hit never starts a function.
 *
 * - `s-maxage=300`: a held answer is at most five minutes old, and the runner
 *   purges the `reader-manifest` tag the moment it publishes
 *   (`scripts/routine-civic-data-reader-repair.mts`), so new data does not
 *   wait for it. `stale-while-revalidate` covers only an answer nothing has
 *   been published over, since a purge removes the object outright. Both sit
 *   far inside the hourly refresh rule (docs/rulings.md §4).
 * - `durable`: shared across Netlify's edge nodes, as the manifest is.
 * - `Netlify-Vary: query` keys the object on EVERY query parameter (order does
 *   not matter). The D40 incident was this CDN dropping a query string from
 *   the key; the Next runtime keys route handlers on its own parameters only
 *   unless told otherwise. Every parameter rather than the four this route
 *   reads, because a request carrying a fifth is refused below, and a key that
 *   ignored it would answer that request from the cache instead.
 * - The browser revalidates every time (`max-age=0`), so a purge reaches it.
 *
 * Only a 200 built whole from the published edge is held: a refusal, a 503, a
 * database-fallback or partial meetings read, and any answer carrying a failed
 * lookup (divisions, coverage, comment access, routing) says `no-store`, so a
 * transient failure is never handed to every reader for five minutes.
 */
const CDN_HELD = {
  "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=3600",
  "Netlify-Cache-Tag": READER_MANIFEST_CACHE_TAG,
  "Netlify-Vary": "query",
  "Cache-Control": "public, max-age=0, must-revalidate",
} as const;
const NOT_HELD = { "Cache-Control": "no-store" } as const;

/**
 * The states a request will most likely read, known before its divisions are
 * (C21): those of the typed ZIP's area, or of the nearest ZIP within 60 km.
 * Only a prefetch hint — the meetings and registrations the request actually
 * reads are chosen from the divisions it resolves, exactly as before.
 */
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

  /*
   * ITEM 1b (2026-08-17): this block used to read
   *
   *   const lat = Number(params.get("lat"));
   *
   * and `Number(null)` is 0, not NaN. A request carrying no coordinates at
   * all — `/api/meetings?zip=85701`, the shape the h session's probe sent —
   * passed both range checks and searched 0°N 0°E, climbing the radius ladder
   * to 150 km in the Gulf of Guinea and answering 200 with a centre, a tier
   * and a `nearZip` of "85701". It also wrote that into the search log.
   *
   * The reader-facing rule is `lib/api/params.ts`: absent or malformed
   * refuses with a stated reason, and an unknown parameter is named back to
   * the caller rather than ignored — because the original request was not a
   * malformed coordinate, it was a caller using a parameter this route does
   * not locate by.
   */
  const KNOWN = ["lat", "lng", "radiusKm", "zip"] as const;
  const unknown = rejectUnknown(params, KNOWN);
  if (!unknown.ok) return refuse(unknown.error);

  const latRead = numericInRange(params, "lat", -90, 90, "refuse");
  if (!latRead.ok) return refuse(latRead.error);
  const lngRead = numericInRange(params, "lng", -180, 180, "refuse");
  if (!lngRead.ok) return refuse(lngRead.error);
  const lat = latRead.value;
  const lng = lngRead.value;

  /*
   * `radiusKm` is genuinely optional — absent means "start at the ladder's
   * first rung", which is a documented default for a parameter the caller
   * never sent. Present-but-unparseable is a different thing and refuses:
   * `?radiusKm=abc` silently becoming 25 km is the same class of defect one
   * size down, an answer about a smaller area than the caller asked for with
   * nothing on screen to say so.
   */
  const radiusRead = numeric(params, "radiusKm", { default: RADIUS_LADDER_KM[0] });
  if (!radiusRead.ok) return refuse(radiusRead.error);
  if (radiusRead.value <= 0) {
    return refuse(`radiusKm must be greater than 0, received ${radiusRead.value}`);
  }
  const radiusKm = Math.min(
    radiusRead.value,
    RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1],
  );

  /*
   * ITEM 1b: a malformed zip refuses rather than silently becoming null.
   * `?zip=8570` — one digit short, a typo a client could ship — used to log a
   * search with no location at all, and a row with a missing location is
   * indistinguishable in the sold store from a reader who panned into open
   * water. Absent is still fine and means "the reader panned, they didn't
   * type"; the nearest ZCTA centroid answers that case below.
   *
   * Read at the door, with the others, so a refused request never runs the
   * search — a refusal that arrives after the work is a refusal the caller
   * paid for.
   */
  const zipRead = matching(params, "zip", /^\d{5}$/, { default: null });
  if (!zipRead.ok) return refuse(zipRead.error);

  /*
   * **THE COLD CHAIN, STARTED AT ONCE.** (C21, 2026-09-25.)
   *
   * A cold instance used to do this one step after another: the manifest, then
   * six authority families, then ~25 geometry files, then the ZIP's shard and
   * registration, then the meetings, then the coverage build. Now everything
   * that reads neither the database nor the request's edge context starts
   * here, before the authority families arrive: the committed geography, the
   * ZIP index shard, the nearest ZIP for a panned map, and — once the manifest
   * names them — the meetings and registrations of the states the ZIP points
   * at. None of that is an answer; each is a read the steps below would make
   * anyway, now already in flight or done when they make it.
   */
  prefetchReaderGeography();
  const nearZipRead = zipRead.value ? Promise.resolve(zipRead.value) : nearestZipWithin60Km(lat, lng).catch(() => null);
  const statesHinted = nearZipRead.then(hintedStates);

  // PDC-9: one edge read serves the whole ready-to-display bundle. The manifest
  // (CDN-cached, no database) carries meetings (via its scope artifacts) AND the
  // comment-access + everyday-routing families, so a normal visit never wakes the
  // database. Each family below prefers the embedded edge value and falls back to
  // its own database read only when the edge has not published it yet.
  const edgeManifest = await timing.time("manifest", () => readReaderManifest().catch(() => null));

  // PDC-9: bind the reader-authority edge bundle (registry-runtime division/
  // coverage/roster bindings, the federal directory, and campaign-site URLs)
  // request-scoped, so divisionsAt/coverageAt below serve them from the edge and
  // never wake Neon. Each family is fetched at most once per version per process.
  // Any family the manifest omits (rollout) falls through to the DB reader.
  //
  // C21: only the families this route reads (`READER_MAP_AUTHORITY_FAMILIES` —
  // not Ask's recorded outcomes, not the comment-access artifact the manifest
  // already embeds). The edge is entered HERE, in this handler's own execution:
  // it is AsyncLocalStorage.enterWith, which on Node 24 never reaches reads
  // chained on a helper that entered it (tests/reader-edge-context.test.ts).
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

  // C21: the coverage graph (rosters, photos, officeholder indexes) builds from
  // here, beside the division lookup and the meetings read, rather than after
  // them. Started after the edge is entered, so it reads the edge; a failure is
  // not held and `coverageAt` below meets it on its own terms.
  const coverageReady = timing.time("coverageGraph", () => prepareCoverage()).catch(() => undefined);

  /*
   * D18: which divisions actually contain this point.
   *
   * The cascade filters by distance, and a meeting held online has none — so
   * without this a virtual sitting is invisible at every radius. This is the
   * exact answer for a body we hold a division for, resolved from the SAME
   * committed geometry the coverage summary and the who-governs card use.
   * It runs before the search because the search needs it, and it degrades to
   * an empty set rather than failing the request: `within()` then falls back
   * to its body-in-view clause, which is a narrower answer and never a wrong
   * one.
   */
  let divisionsAtPoint = new Set<string>();
  /*
   * AUD-04 (2026-08-18): the resolved divisions are KEPT, not just reduced to
   * their ids, so the coverage summary below can reuse them instead of sweeping
   * the same point against the same polygons a second time. One geometry answer
   * reused inside one request; nothing is stored and nothing is joined.
   *
   * It stays null when the lookup FAILED, and that distinction is the whole
   * safety of the change: an empty result from a failed resolution must not be
   * handed to `coverageAt` as though it were an answer, or a lookup failure
   * would render as "no body governs here" — a retrieval failure written into
   * the data as an absence. Null means "resolve it yourself", which is exactly
   * what happened before this change.
   */
  let resolvedDivisions: Division[] | null = null;
  try {
    resolvedDivisions = await timing.time("divisions", () => divisionsAt(lat, lng));
    divisionsAtPoint = new Set(resolvedDivisions.map((d) => d.ocdId));
  } catch (error) {
    console.error("division lookup failed; online meetings fall back to body-in-view", error);
  }

  /*
   * **A ZIP IS AN AREA, AND THIS CARD IS LITERALLY CALLED "WHO GOVERNS HERE".**
   * (NJ Hunt 3 item 3.1, 2026-08-22 — the second instance of `NJ01`.)
   *
   * `NJ01` fixed the ballot page and this surface was left on the old
   * behaviour, because nobody swept the class. Production at 07866 read "4
   * bodies govern the area around 07866" over a list holding Rockaway TOWNSHIP
   * and not Rockaway BOROUGH — a separate municipality inside the same zip,
   * with its own council, its own school district and its own ballot, missing
   * from the card whose whole job is to answer that question.
   *
   * So when the reader TYPED a zip, the divisions are widened to every one
   * whose territory reaches inside it, exactly as the ballot page does.
   *
   * Three things this is careful about:
   *
   * - **Only on a typed zip.** A settled-viewport fetch carries none: the
   *   reader panned rather than named a place, and widening to a zip they did
   *   not type would answer about somewhere they are not.
   * - **Only when the point lookup SUCCEEDED.** A failed resolution stays
   *   null and is passed as null, so a retrieval failure is never written into
   *   the coverage answer as "nothing governs here".
   * - **It can only ADD.** The point's own divisions are the starting set and
   *   are never removed, so nothing a reader saw yesterday disappears today —
   *   the failed-fetch-never-empties-a-full-surface rule, applied to a
   *   resolver change.
   *
   * The online-meeting filter is widened with it, deliberately: a Borough
   * resident's own council meeting held online is a meeting they should see,
   * and this set only ever grows the list.
   */
  /*
   * THE DIVISIONS THE POINT ITSELF RESOLVED, kept apart from the widened set.
   *
   * A body on one of THESE is a body at the reader's own location and nothing
   * about it changes. A body that arrives only through the widening is filtered
   * below — see `widenedInBodies`, and the 61-body measurement that forced it.
   */
  const pointOwnDivisionIds = new Set(divisionsAtPoint);
  if (zipRead.value && resolvedDivisions) {
    const widening = timing.start("widen");
    const areaIds = await divisionIdsForZipArea(
      zipRead.value,
      resolvedDivisions.map((d) => d.ocdId),
    );
    const widened = await divisionsByOcdIds(areaIds);
    widening();
    if (widened.length >= resolvedDivisions.length) {
      resolvedDivisions = widened;
      divisionsAtPoint = new Set(widened.map((d) => d.ocdId));
    }
  }

  // ONE projection read per request (D.1). The search and the freshness meta
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
      // PDC-9: read the runner-published GEOGRAPHIC edge artifacts for this
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

  // A coverage statement we cannot stand behind is worse than none, so a
  // registry that fails to load degrades to the cascade's own answer rather
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

  /*
   * **RULING 71 ON THE CARD THAT ASKS THE QUESTION.** (NJ Hunt 3 item 3.3.)
   *
   * The widening above makes Rockaway Borough APPEAR beside Rockaway Township.
   * On its own that trades one wrong answer for a longer one: eight bodies
   * listed identically, when two of them govern everyone at 07866 and six
   * govern some readers and not others. So each body carries whether its
   * territory covers the whole zip, and only the partial ones get the pill.
   *
   * Only on a TYPED zip, for the same reason the widening is: a reader who
   * panned has named no place, and there is then no zip for a body to be
   * partial about. Absent means not-applicable, never certain — the field is
   * optional precisely so those two cannot be written as the same thing.
   */
  /*
   * **A WIDENED DIVISION BRINGS ITS GOVERNMENTS, NOT ITS COMMITTEE ROOM.**
   * (NJ Hunt 3, caught by `pnpm walk:all` before this reached a reader.)
   *
   * The widening above is right about DIVISIONS and was catastrophically wrong
   * about BODIES. 85641 is Vail; the City of Tucson's territory clips that
   * ZCTA; and Tucson carries 59 curated boards and commissions. The coverage
   * payload at 85641 went from 2 bodies to 61 — a Vail reader handed Tucson's
   * Design Review Board, its Outdoor Lighting Code Committee and its Zoning
   * Examiner Hearings, every one of them wearing a "Could govern you" pill.
   *
   * That is worse than the defect it was fixing. Rockaway Borough was missing a
   * COUNCIL and a SCHOOL BOARD — governments, of a municipality a reader may
   * actually live in. Tucson's Landscape Advisory Committee is not a government
   * of anyone in Vail under any reading of the word, and the card's own code
   * already says so: *a commission isn't a government at all.*
   *
   * So a body arriving ONLY through the widening must be `GOVERNING`. A body on
   * a division the point itself resolved is untouched, which is why 85701 —
   * where Tucson IS the reader's own municipality — still carries all 59.
   *
   * `walk:all` found this as a NAMED REGRESSION (M135, shipped by g15) rather
   * than as a coverage number nobody was reading, which is the whole argument
   * for a standing suite that only ever grows.
   */
  if (coverage && zipRead.value) {
    const before = coverage.bodies.length;
    const kept = coverage.bodies.filter(
      (body) =>
        !body.ocdId || pointOwnDivisionIds.has(body.ocdId) || body.bodyClass === "GOVERNING",
    );
    if (kept.length !== before) {
      /*
       * THE COUNTS ARE RECOMPUTED FROM THE KEPT ARRAY, not carried over.
       *
       * `counts.total` counts every body and would go stale the moment this
       * filter removes one — a number produced by one list standing in front of
       * a different list, which is the stated-N-equals-rendered-rows rule
       * failing in the payload rather than in the component.
       *
       * `counts.governing` is untouched by construction: every GOVERNING body
       * is kept unconditionally above, so the governing pair cannot move. It is
       * still recomputed here rather than assumed, because "cannot move" is an
       * argument and the array is the evidence.
       */
      /*
       * `WIRED_STATUSES` is IMPORTED, never retyped. The first draft of this
       * block hand-wrote `["WIRED", "PARTIAL"]` and the real set is
       * `["LIVE", "MANUAL"]` — two invented statuses that match nothing, which
       * would have reported every body as having no source while the array
       * underneath was unchanged. A second copy of a closed enum is a second
       * thing that can be wrong about it.
       */
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
  // The one projection read above already produced this (D.1) — no second read.
  const meta = snapshotMeta;
  // `meta.carried` rides along untouched (hotfix-0817): the footer's one age is true of
  // the fresh rows only, and the count of rows it is NOT true of has to reach
  // the client or the line keeps speaking for them.
  //
  // D.4 (2026-09-14): the wire snapshot is trimmed to exactly what a reader
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
            // A PARTIAL refusal names its own divisions and nothing else
            // (g3). Before this, a source serving five bodies across three
            // hosts put the "we couldn't reach their calendar source" line on
            // all five whenever one of them refused — telling four readers
            // their government's calendar was unreachable when it was on
            // screen in front of them.
            //
            // A whole-source failure still attributes to every body the
            // source serves. A division-less body (null ocdId) has no
            // division to attribute the failure to; its absence is visible on
            // the body itself.
            ocdIds:
              s.ok && s.unreachableOcdIds
                ? s.unreachableOcdIds
                : wiringForSourceName(s.source).flatMap((row) =>
                    row.ocdId ? [row.ocdId] : [],
                  ),
          })),
      }
    : null;

  // The settled-viewport fetch (2i) carries no zip — the reader panned, they
  // didn't type. Resolve the nearest ZCTA centroid so the notices and the
  // ballot bubble can name the area, and cap it: a center more than 60 km
  // from every centroid (open water, deep wilderness) honestly has no zip.
  // Same orientation-only status as a typed zip — never district truth.
  //
  // C21: started at the top (`nearZipRead`), from the table loaded on demand
  // (`lib/geo/zcta-table.ts`) rather than a 961 KB module every cold start of
  // this route parsed whether or not the request carried a zip.
  const nearZip: string | null = await nearZipRead;
  /*
   * PDC-9: THE SEARCH LOG NO LONGER WRITES ON THE RESPONSE PATH.
   *
   * The SEARCH row was the last database write in the reader's hot path — an
   * `after()`-deferred `logSearchEvent`. On a cold visit that write woke Neon
   * (~2 s) and, in a non-serverless runtime, held the response until it did.
   * It is now sent from the client as a fire-and-forget `sendBeacon` to
   * `/api/log` (the SAME beacon every other reader event already uses:
   * OFFICIAL_OPENED, MEETING_OPENED, …), with the synthetic-run marker riding
   * the body so walk-vs-reader classification is preserved. The reader's answer
   * therefore never waits for, and never wakes the database for, a bookkeeping
   * write — on any runtime. Disclosed on /transparency; see
   * `components/map/map-entry.tsx` and `lib/log/client.ts`.
   */

  /*
   * M81 — which of these bodies actually governs the reader.
   *
   * The division ids the point already resolved into, sent as an ARRAY so the
   * client can badge every card without a second request and without a second
   * geometry source. `null` when the resolution FAILED, which is not the same
   * as an empty list: an empty list treated as an answer would badge every
   * meeting on screen "Nearby, different jurisdiction" — a specific false
   * claim produced by our own lookup failing. Null makes every badge read as
   * the named gap it is.
   */
  const governingOcdIds = resolvedDivisions
    ? resolvedDivisions.map((d) => d.ocdId)
    : null;

  /*
   * **`JUR-2` (2026-08-23) — which of those divisions the ZIP could not
   * settle.**
   *
   * `governingOcdIds` above says which divisions the resolved point sits in.
   * When that point is a ZCTA centroid rather than an address the reader gave,
   * membership is one point standing in for an area that crosses every kind of
   * line there is — and the meeting card was printing "Governs your area" off
   * it. This is the same lattice measurement the ballot page's RULING 71 pill
   * already trusts, so the two surfaces cannot disagree about which town is
   * unsettled.
   *
   * `null` where the zip is outside the committed geometry: the client reads
   * that as "we could not measure it", never as "nothing is partial".
   *
   * Measured on `nearZip`, which is the zip the answer on screen is ABOUT —
   * the requested one where there was one, the nearest ZCTA to a lat/lng
   * otherwise. The coverage pill above measures on the requested zip, and
   * where a request carried one those are the same value. Where it did not,
   * the coverage block is absent too, so there is no second surface to
   * disagree with.
   */
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
}
