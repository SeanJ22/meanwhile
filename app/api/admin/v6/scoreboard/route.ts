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
import { readAuditWeek, readLatestSpeedPass, readRecentClaimPasses } from "@/lib/control-plane/live-audit-log.ts";
import { reportAccuracy, weekOf } from "@/lib/control-plane/workers/claim-audit.ts";
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
import { readFlowWeek } from "@/lib/control-plane/admin-view/flow-read.ts";
import { provenFixesReading } from "@/lib/control-plane/fix-standing.ts";

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
    const [learningRead, history, doors, heartbeat, doorNumbers, pipeline, contracts, capture, sentPlaces, audit, speed, provenFixes, claims, flow] = await Promise.all([
