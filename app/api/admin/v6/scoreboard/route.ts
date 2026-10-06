import { neon } from "@neondatabase/serverless";
import type { NextRequest } from "next/server";

import { loadLearningTrends } from "@/app/(admin)/_mw/data/learning-trends.ts";
import { openControlPlane, RUNNER_ID } from "@/lib/control-plane/admin-data.ts";
import { readPlaceOwed } from "@/lib/control-plane/admin-view/place-owed-read.ts";
import { readPlaceHistory } from "@/lib/control-plane/admin-view/place-history-read.ts";
import { readScoreboardPlaces } from "@/lib/control-plane/admin-view/scoreboard-places.ts";
import { CORE_ITEMS_DEFAULT, CORE_ITEMS_SETTING, readSetting } from "@/lib/control-plane/settings.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { readV6History } from "@/lib/control-plane/admin-view/admin-v6-history.ts";
import { readGateHealth } from "@/lib/control-plane/admin-view/gate-health.ts";
import { buildLearningTrends } from "@/lib/control-plane/admin-view/learning-trends.ts";
import { weeklyAuditAccuracy } from "@/lib/control-plane/admin-view/v6-audit-read.ts";
import { readAuditWeek, readLatestSpeedPass } from "@/lib/control-plane/live-audit-log.ts";
import { buildScoreboard, publicationCountsOf, v6LearningView, type ScoreboardReadings } from "@/lib/control-plane/admin-view/scoreboard-read.ts";
import { captureWindow, readCaptureHealth } from "@/lib/control-plane/admin-view/v6-capture-health.ts";
import { projectDoors } from "@/lib/control-plane/admin-view/v6-doors-read.ts";
import { publicationView } from "@/lib/control-plane/admin-view/v6-publication-read.ts";
import { readPipeline } from "@/lib/control-plane/admin-view/v6-results-read.ts";
import { readRoutinePublicationStatus } from "@/lib/civic-data/observability-server.ts";
import { readinessCounts, recoveryWitnesses } from "@/lib/coverage/readiness-counts.ts";
import { liveSources, netlifyHistoryStore, readCaptureFailures } from "@/lib/control-plane/data-business/live.ts";
import { readSwitchConfig } from "@/lib/control-plane/data-business/switches.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { readDoorNumbers } from "@/lib/control-plane/admin-view/door-numbers-read.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** A reading that could not be taken is null, so its row says "not measured" instead of showing a zero. */
async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

/** `admin-v6/scoreboard@1`: the Scoreboard's rows with the counts behind each, the launch-gate health group, readiness counts and the weekly learning series. Read only; the same for every place. */
export async function GET(request: NextRequest) {
  return adminGet(request, async (observedAt) => {
    const now = new Date(observedAt);
    const opened = await attempt(async () => { const o = await openControlPlane(); return o.ok ? o.repos : null; });
    const url = controlPlaneUrlFromEnv();
    const configRow = opened ? await attempt(() => opened.adminConfig.read(ADMIN_CONFIG_ID)) : null;
    const config = configRow !== null && configRow !== undefined && isAdminConfig(configRow.value) ? configRow.value : null;
    const coreIds = new Set(readSetting(config, CORE_ITEMS_SETTING, CORE_ITEMS_DEFAULT));
    const doorList = opened ? await attempt(async () => (await listDoors(opened.doors)).doors) : null;
    const [learningRead, history, doors, heartbeat, doorNumbers, pipeline, contracts, capture, sentPlaces, audit, speed] = await Promise.all([
      attempt(async () => { const r = await loadLearningTrends(observedAt); return r.kind === "UNREAD" ? null : r.facts; }),
      attempt(async () => (opened ? (await readV6History(opened, { scope: "us", asOf: observedAt, limit: 50 })).data : null)),
      attempt(async () => (opened ? projectDoors({ ...(await listDoors(opened.doors)), saves: [], observedAt }).counts : null)),
      attempt(async () => (opened ? (await opened.runnerHeartbeat.read(RUNNER_ID))?.value ?? null : null)),
      attempt(() => readDoorNumbers({ now: observedAt, doors: doorList, config })),
      attempt(async () => { if (!url) return null; const r = await readPipeline(neon(url), observedAt); return r.state === "READ" ? r : null; }),
      attempt(async () => { const r = await readRoutinePublicationStatus(); if (r.kind !== "HELD") return null; const v = publicationView(r.view); return { readBack: v.counts.find((c) => c.verdict === "READER_VISIBLE")?.count ?? 0, total: v.total }; }),
      attempt(async () => {
        const config = opened ? await readSwitchConfig(opened) : null;
        const failures = await readCaptureFailures({ ...captureWindow(now), history: netlifyHistoryStore() }).catch(() => null);
        const view = await readCaptureHealth({ sources: liveSources(), switchOn: () => true }, config, failures, now);
        return view.readers.kind === "READ" ? view.readers.rows : null;
      }),
      // The sent places' owed lists and history, as Admin's place view reads them; places not read in time are counted, not zeroed.
      attempt(async () => (config === null ? { places: [], unread: 0 } : readScoreboardPlaces(config, coreIds, {
        readOwed: (placeKey) => readPlaceOwed(placeKey),
        readHistory: async (placeKey) => (url ? readPlaceHistory(neon(url), placeKey) : []),
        budgetMs: 10_000,
      }))),
      // DP-18: the week's live audits, read by day key (seven keys), never the whole log.
      attempt(async () => (opened ? weeklyAuditAccuracy({ ...(await readAuditWeek(opened, observedAt)), now: observedAt }) : null)),
      // FE-02: the latest worst-case speed pass on the live site (today's and yesterday's keys).
      attempt(async () => (opened ? readLatestSpeedPass(opened, observedAt) : null)),
    ]);
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
      audit,
      speed,
      gates: opened === null ? null : readGateHealth({ nowIso: observedAt, heartbeat, databaseReachable: null, lastDispatch: null, spend: null }),
      readiness: readinessCounts(recoveryWitnesses({
        bankEntriesInherited: learning?.doors.given ?? null, bankEntriesUsed: learning?.doors.used ?? null,
        failureDebts: null, failureDebtsWithReason: null, absences: null, absencesWithRecheck: null, manualWriteBacks: null,
      })),
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
