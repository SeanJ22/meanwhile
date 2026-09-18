/**
 * **FLEET OPERATIONS — the committed, authenticated Admin surface.**
 *
 * A five-tab triage surface where the active tab is a URL search param
 * (BUILD.md §0), not client state. `page.tsx` stays a server component and
 * renders exactly ONE tab body, so each tab's read is scoped to it — in
 * particular the 2 665-row operations scan (`readFleetSeedState`) happens only
 * for `?tab=work`. Every other tab reads only the owner snapshot through the
 * targeted reads `readFleetPanels` / `readFleetDecisionQueue`, so a failure of
 * the fleet-activity scan can never blank the decisions, panels or triage tabs:
 * the gates are split by source, and a section that could not be read says so
 * on its own rather than the page reporting "everything is missing".
 *
 * Reachable only on `ADMIN_ORIGIN` with a valid session (enforced in
 * `middleware.ts`). The reads run at request time because the operator
 * navigated here; nothing re-reads on a cycle (WIRING.md §4). When the control
 * plane cannot be reached the reads say so rather than filling measurements in.
 */

import type { ReadOutcome } from "@/lib/control-plane/admin-data";
import { openControlPlane, readDecisions, readFleetSafety, readHeartbeat, readSnapshot } from "@/lib/control-plane/admin-data";
import type { OwnerSnapshot } from "@/lib/control-plane/owner-surface.ts";
import { HEARTBEAT_LATE_MINUTES } from "@/lib/control-plane/owner-surface.ts";
import { projectFleetDecisionQueue, projectFleetPanels } from "@/lib/control-plane/fleet-operations";
import { researchProgressHealth } from "@/lib/control-plane/research-progress-health.ts";
import { pulseRevision } from "@/lib/control-plane/live-pulse";
import { US_STATES } from "@/lib/control-plane/readiness/catalog";
import { readFleetSeedState } from "@/lib/admin/fleet-seed";
import { fleetBandCounts, fleetRedFindings } from "@/lib/admin/fleet-triage";

import { ConsoleNav } from "@/app/(admin)/console-nav";
import { FleetReadClock } from "@/components/admin/fleet-read-clock";
import { FleetTabStrip, parseFleetTab } from "@/components/admin/fleet-tab-strip";
import { FleetTriageBands } from "@/components/admin/fleet-triage-bands";
import { FleetTriageTab } from "@/components/admin/fleet-triage-tab";
import { FleetWorkTab } from "@/components/admin/fleet-operations-map";
import { FleetDecisionsTab } from "@/components/admin/fleet-decisions-tab";
import { FleetPanelsTab } from "@/components/admin/fleet-panels-tab";
import { FleetBlindSpotsTab } from "@/components/admin/fleet-blind-spots-tab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Fleet operations",
  robots: { index: false, follow: false, nocache: true },
};

function timeOnly(iso: string): string {
  return iso.replace(/^.*T/, "").replace(/\.\d+/, "");
}
function formatGap(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export default async function FleetOperationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const tab = parseFleetTab(params.tab);
  const observedAt = new Date().toISOString();

  const opened = await openControlPlane();
  const repos = opened.ok ? opened.repos : null;
  // A store-unreachable outcome is a member of every ReadOutcome<T>, so it seeds
  // the projectors for both the snapshot and the decision log when the control
  // plane could not be opened at all.
  const unreachable = (): { readonly kind: "STORE_UNREACHABLE"; readonly detail: string } =>
    ({ kind: "STORE_UNREACHABLE", detail: opened.ok ? "the control plane opened but a read was not attempted" : opened.detail });

  const [progressOut, snapshotOut, decisionsOut, heartbeatOut] = repos
    ? await Promise.all([readFleetSafety(repos), readSnapshot(repos), readDecisions(repos), readHeartbeat(repos)])
    : [null, null, null, null];

  const progressState = progressOut?.kind === "HELD" ? progressOut.value : null;
  const progress = researchProgressHealth(progressState, observedAt);
  const snapForProject: ReadOutcome<OwnerSnapshot> = snapshotOut ?? unreachable();
  const panels = projectFleetPanels(snapForProject, observedAt);
  const decisionQueue = projectFleetDecisionQueue(snapForProject, decisionsOut ?? unreachable());
  const redFindings = fleetRedFindings(progressState);

  const measured = {
    receipts: panels.receiptLoading.kind === "HELD",
    spend: panels.spending !== null,
    coverage: panels.coverageGaps.kind === "HELD",
  };
  const bandCounts = fleetBandCounts({
    state: progressState,
    decisionCount: decisionQueue.cards.length,
    measuredAnswered: [measured.receipts, measured.spend, measured.coverage].filter(Boolean).length,
  });

  const heartbeat = heartbeatOut?.kind === "HELD" ? heartbeatOut.value : null;
  const snapshot = snapshotOut?.kind === "HELD" ? snapshotOut.value : null;
  const fleetSafety = progressState?.fleetSafety ?? null;
  const stateVersion = pulseRevision({
    beatAt: heartbeat?.beatAt ?? null,
    snapshotRevision: snapshot?.publishedAt ? Date.parse(snapshot.publishedAt) : null,
    decisionCount: decisionsOut?.kind === "HELD" ? decisionsOut.value.length : null,
    researchRevision: fleetSafety ? Date.parse(fleetSafety.cycle.startedAt) : null,
    receiptCount: null,
  });

  // The 2 665-row operations scan is read ONLY for the work tab.
  const workState = tab === "work"
    ? await readFleetSeedState({ open: () => Promise.resolve(opened), now: () => observedAt })
    : null;

  const runnerBeatAt = progress.asOf;
  let clockGapSeconds: number | null = null;
  if (runnerBeatAt) {
    const gap = Math.abs(Date.parse(observedAt) - Date.parse(runnerBeatAt));
    if (Number.isFinite(gap)) clockGapSeconds = Math.round(gap / 1000);
  }

  return (
    <main className="admin console-page fleet-console">
      <ConsoleNav view="fleet" currentState={null} states={US_STATES} />

      <header className="fleet-header">
        <h1>What the fleet is doing</h1>
        <FleetReadClock observedAt={observedAt} />
        <p className="two-clock">
          Fleet read <code>{timeOnly(observedAt)}</code>
          {runnerBeatAt && (
            <>
              {" · "}Runner heartbeat <code>{timeOnly(runnerBeatAt)}</code>
            </>
          )}
          {clockGapSeconds !== null && clockGapSeconds > HEARTBEAT_LATE_MINUTES * 60 && (
            <span className="two-clock-gap">{formatGap(clockGapSeconds)} apart &mdash; two clocks, one page</span>
          )}
        </p>
      </header>

      <FleetTriageBands counts={bandCounts} />

      <FleetTabStrip active={tab} badges={{ decisions: bandCounts.amber, gaps: 9 }} />

      {tab === "triage" && <FleetTriageTab progress={progress} findings={redFindings} measured={measured} />}
      {tab === "work" && <FleetWorkTab initialState={workState ?? undefined} />}
      {tab === "decisions" && <FleetDecisionsTab cards={decisionQueue.cards} stateVersion={stateVersion} />}
      {tab === "panels" && <FleetPanelsTab reading={panels} />}
      {tab === "gaps" && <FleetBlindSpotsTab />}
    </main>
  );
}
