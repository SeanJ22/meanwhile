import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { databaseReadOnlySql } from "@/lib/reader/database.ts";
import type { NextRequest } from "next/server";

import { loadLearningTrends } from "@/app/(admin)/_mw/data/learning-trends.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readPlaceOwed } from "@/lib/control-plane/admin-view/place-owed-read.ts";
import { readPlaceHistory } from "@/lib/control-plane/admin-view/place-history-read.ts";
import { readScoreboardPlaces } from "@/lib/control-plane/admin-view/scoreboard-places.ts";
import { CORE_ITEMS_DEFAULT, CORE_ITEMS_SETTING, readSetting } from "@/lib/control-plane/settings.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { readV6History } from "@/lib/control-plane/admin-view/admin-v6-history.ts";
import { readGateHealth, readGateHeartbeat } from "@/lib/control-plane/admin-view/gate-health.ts";
import { buildLearningTrends } from "@/lib/control-plane/admin-view/learning-trends.ts";
import { weeklyAuditAccuracy } from "@/lib/control-plane/admin-view/v6-audit-read.ts";
import { readAuditWeek, readLatestSpeedPass, readRecentClaimPasses } from "@/lib/control-plane/live-audit-log.ts";
import { reportAccuracy, weekOf } from "@/lib/control-plane/workers/claim-audit.ts";
import { buildScoreboard, publicationCountsOf, v6LearningView, type ScoreboardReadings } from "@/lib/control-plane/admin-view/scoreboard-read.ts";
import { captureWindow, readCaptureHealth } from "@/lib/control-plane/admin-view/v6-capture-health.ts";
import { readDoorCounts, readAdminDeadLinks } from "@/lib/control-plane/admin-view/door-queries.ts";
import { readPipeline } from "@/lib/control-plane/admin-view/v6-results-read.ts";
import { readRoutinePublicationCounts } from "@/lib/civic-data/observability-server.ts";
import { readinessCounts, recoveryWitnesses } from "@/lib/coverage/readiness-counts.ts";
import { liveSources, netlifyHistoryStore, readCaptureFailures } from "@/lib/control-plane/data-business/live.ts";
import { readSwitchConfig } from "@/lib/control-plane/data-business/switches.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { fixItems } from "@/lib/control-plane/fix-list.ts";
import { readLatestLookPasses } from "@/lib/control-plane/live-audit-log.ts";
import { DEAD_LINKS_SURFACE_DEFAULT, DEAD_LINKS_SURFACE_SETTING, SLOW_SURFACE_SHARE_DEFAULT, SLOW_SURFACE_SHARE_SETTING } from "@/lib/health/surface-speed.ts";
import { readDoorNumbers } from "@/lib/control-plane/admin-view/door-numbers-read.ts";
import { readLineReport } from "@/lib/control-plane/line-keeper/report.ts";
import { readFlowWeek } from "@/lib/control-plane/admin-view/flow-read.ts";
import { keeperStatus } from "@/lib/control-plane/line-keeper/model.ts";
import { readVitalSigns } from "@/lib/control-plane/admin-view/vital-signs-read.ts";
import { readFactStore } from "@/lib/facts/admin-read.ts";
import { readerQuery } from "@/lib/civic-data/promoted-reader-query.ts";
import { provenFixesReading } from "@/lib/control-plane/fix-standing.ts";

const shotUrl = (key: string): string => `/api/admin/v6/resident-tasks/shot/${key.replace(/^resident-tasks\//, "")}`;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** A reading that could not be taken is null, so its row says "not measured" instead of showing a zero. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/** `admin-v6/scoreboard@1`: the Scoreboard's rows with the counts behind each, the launch-gate health group, readiness counts and the weekly learning series. Read only; the same for every place. */
async function get(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const now = new Date(observedAt);
    if(request.nextUrl.searchParams.get('reading')==='hourly'){
      const url=controlPlaneUrlFromEnv();
      const [keeper,vital]=await Promise.all([
        url?attempt(()=>readLineReport(databaseReadOnlySql(url),undefined,{includeCounts:false})):null,
        url?attempt(()=>readVitalSigns(databaseReadOnlySql(url),observedAt)):null,
      ]);
      return {contract:'admin-v6/scoreboard@1',scope:request.nextUrl.searchParams.get('scope')??'us',revision:`line-keeper:${keeper?.checkedAt??'unavailable'}`,asOf:observedAt,
        data:buildScoreboard({lineKeeper:keeper,observedAt,vital,factStore:null,places:null,placesUnread:0,orders:null,publication:null,shutDoors:null,returning:null,
          learning:{trends:[],readings:[],notMeasured:[]},doors:null,
          gates:null,readiness:readinessCounts({})}),
        missingParts:keeper?[]:[keeperStatus(null,observedAt)]};
    }
    const opened = await attempt(async () => { const o = await openControlPlane(); return o.ok ? o.repos : null; });
    const url = controlPlaneUrlFromEnv();
    const settingsRead = Promise.all([
      opened ? attempt(() => opened.adminConfig.read(ADMIN_CONFIG_ID, { methodStandings: true })) : null,
      opened ? attempt(() => opened.adminConfig.readFixes({ activeAndRecent: 500, fieldsProjection: ["id", "state", "addedBy", "addedAt", "fixedAt", "changedBy"] })) : null,
    ]).then(([configRow, fixes]) => {
      const config = configRow !== null && configRow !== undefined && isAdminConfig(configRow.value) ? configRow.value : null;
      return { config, repairConfig: config !== null && fixes !== null ? { ...config, fixList: fixes } : null,
        coreIds: new Set(readSetting(config, CORE_ITEMS_SETTING, CORE_ITEMS_DEFAULT)) };
    });
    const keeperRead=attempt(async()=>url?readLineReport(databaseReadOnlySql(url)):null);
    const [learningRead, history, doors, heartbeat, doorNumbers, pipeline, contracts, capture, sentPlaces, audit, speed, provenFixes, claims, flow, factStore, keeper, deadLinks, looks, vital] = await Promise.all([
      attempt(async () => { const r = await loadLearningTrends(observedAt); return r.kind === "UNREAD" ? null : r.facts; }),
      attempt(async () => (opened ? (await readV6History(opened, { scope: "us", asOf: observedAt, limit: 50 })).data : null)),
      attempt(async () => (opened ? readDoorCounts(opened) : null)),
      attempt(async () => (opened ? readGateHeartbeat(opened) : null)),
      attempt(async () => { const [{ repairConfig }, keeper] = await Promise.all([settingsRead, keeperRead]);
        return readDoorNumbers({ now: observedAt, config: repairConfig, keeper }); }),
      attempt(async () => { if (!url) return null; const r = await readPipeline(databaseReadOnlySql(url), observedAt); return r.state === "READ" ? r : null; }),
      attempt(() => readRoutinePublicationCounts()),
      attempt(async () => {
        const config = opened ? await readSwitchConfig(opened) : null;
        const failures = await readCaptureFailures({ ...captureWindow(now), history: netlifyHistoryStore() }).catch(() => null);
        const view = await readCaptureHealth({ sources: liveSources(), switchOn: () => true }, config, failures, now);
        return view.readers.kind === "READ" ? view.readers.rows : null;
      }),
      // The sent places' owed lists and history, as Admin's place view reads them; places not read in time are counted, not zeroed.
      attempt(async () => { const { config, coreIds } = await settingsRead;
        return config === null ? { places: [], unread: 0 } : readScoreboardPlaces(config, coreIds, {
        readOwed: (placeKey) => readPlaceOwed(placeKey),
        readHistory: async (placeKey) => (url ? readPlaceHistory(databaseReadOnlySql(url), placeKey) : []),
        budgetMs: 10_000,
      }); }),
      // The week's live audits, read by day key (seven keys), never the whole log.
      attempt(async () => (opened ? weeklyAuditAccuracy({ ...(await readAuditWeek(opened, observedAt)), now: observedAt }) : null)),
      // The latest worst-case speed pass on the live site (today's and yesterday's keys).
      attempt(async () => (opened ? readLatestSpeedPass(opened, observedAt) : null)),
      // Where each reusable fix stands, from the config row.
      attempt(async () => (opened ? provenFixesReading((await settingsRead).config, observedAt) : null)),
      // The latest weekly claim check, this week's and last week's keys.
      attempt(async () => (opened ? reportAccuracy(await readRecentClaimPasses(opened, [weekOf(observedAt), weekOf(new Date(now.getTime() - 7 * 86_400_000).toISOString())])) : null)),
      attempt(async () => (url ? readFlowWeek({control:databaseReadOnlySql(url),through:observedAt}) : null)),
      // Keep the existing blank reasons. Reader delivery comes from the hourly report.
      attempt(async () => { const query = readerQuery(5_000); return query ? readFactStore(query) : null; }),
      // One compact, independently maintained checkpoint supplies all hourly numbers.
      keeperRead,
      // The link sweep's dead links per surface, kept beside door health.
      attempt(async () => (opened === null ? null : readAdminDeadLinks(opened))),
      // The last deploys' look passes (a week's worth), for the look row.
      attempt(async () => (opened ? readLatestLookPasses(opened, 20) : null)),
      attempt(async () => (url ? readVitalSigns(databaseReadOnlySql(url), observedAt) : null)),
    ]);
    const { config, repairConfig } = await settingsRead;
    const learning = learningRead === null ? null : { trends: buildLearningTrends(learningRead.weeks, observedAt), doors: learningRead.doors, bankWriteErrors: learningRead.bankWriteErrors };
    const readings: ScoreboardReadings = {
      places: sentPlaces === null ? null : sentPlaces.places,
      placesUnread: sentPlaces === null ? 0 : sentPlaces.unread,
      orders: history,
      publication: pipeline === null ? null : publicationCountsOf(pipeline, contracts),
      shutDoors: doors === null ? null : { shut: doors.shut, open: doors.open, setAside: doors.setAside, unreadable: doors.unreadable },
      returning: capture === null ? null : { days: capture.length, readerDays: capture.reduce((a, d) => a + d.readers, 0), returningDays: capture.reduce((a, d) => a + d.returning, 0) },
      learning: v6LearningView(learning?.trends ?? buildLearningTrends([], observedAt), learning?.doors ?? null, learning === null ? null : learning.bankWriteErrors),
      doors: learning?.doors ?? null,
      doorNumbers,
      flow,
      factStore,
      vital,
      lineKeeper: keeper,
      observedAt,
      audit,
      speed,
      deadLinks,
      look: looks === null ? null : { now: observedAt, passes: looks, fixStates: new Map((repairConfig ? fixItems(repairConfig) : []).map((i) => [i.id, i.state] as const)), imageUrl: shotUrl },
      speedLimits: { share: readSetting(config, SLOW_SURFACE_SHARE_SETTING, SLOW_SURFACE_SHARE_DEFAULT), deadLinks: readSetting(config, DEAD_LINKS_SURFACE_SETTING, DEAD_LINKS_SURFACE_DEFAULT) },
      provenFixes,
      reportAccuracy: claims,
      gates: (opened === null ? null : readGateHealth({ nowIso: observedAt, heartbeat, databaseReachable: null, lastDispatch: null, spend: null })),
      readiness: readinessCounts({...recoveryWitnesses({
        bankEntriesInherited: learning?.doors.given ?? null, bankEntriesUsed: learning?.doors.used ?? null,
        failureDebts: null, failureDebtsWithReason: null, absences: null, absencesWithRecheck: null, manualWriteBacks: null,
      })}),
    };
    return {
      contract: "admin-v6/scoreboard@1",
      scope: request.nextUrl.searchParams.get("scope") ?? "united-states",
      revision: `scoreboard:${observedAt.slice(0, 13)}`,
      asOf: observedAt,
      data: buildScoreboard(readings),
      missingParts: [],
    };
  });
}

export const GET = adminRead(get);
