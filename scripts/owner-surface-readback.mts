/**
 * **THE READ-BACK PROOF FOR THE OWNER CONTROL CENTRE.**
 * (Session C final, ITEM H, 2026-09-01. `pnpm owner:readback`.)
 *
 * Two acceptance clauses need evidence that cannot come from a unit test,
 * because what they assert is about a LIVE durable store:
 *
 *   - the runner's heartbeat and digest SHOWN equal its latest durable records
 *   - PILOT HEALTH on the page matches the canonical published snapshot
 *
 * ## Why this reads through the PAGE's functions, not its own queries
 *
 * `readSnapshot`, `readHeartbeat` and `readDigests` are the exact functions
 * `app/(admin)/admin/page.tsx` calls. A proof script that issued its own SQL
 * would be evidence that the DATABASE holds the right rows, which is not the
 * claim — the claim is that the PAGE shows them. Two readers can disagree, and
 * the one that matters is the one the owner looks at.
 *
 * A read-back that cannot reach the store prints COULD NOT TELL and exits 2. It
 * never prints like a passing check (RULING 24).
 */

import {
  openControlPlane,
  readCacheObservation,
  readDecisions,
  readDigests,
  readHeartbeat,
  readMapTilerUsageDigests,
  readSnapshot,
} from "../lib/control-plane/admin-data.ts";
import { livenessOf, renderCacheObservation } from "../lib/control-plane/owner-surface.ts";
import { projectMapTilerAttemptHistory, projectPanel } from "../lib/control-plane/maptiler/usage.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

function log(line: string): void {
  console.log(`owner:readback · ${line}`);
}

const opened = await openControlPlane();
if (!opened.ok) {
  log(`COULD NOT TELL — ${opened.detail}`);
  process.exit(2);
}

log(opened.repos.describe());
log(`local HEAD ${headSha()?.slice(0, 8) ?? "unknown"}`);

const [snapshot, heartbeat, digests, maptilerDigests, decisions, cache] = await Promise.all([
  readSnapshot(opened.repos),
  readHeartbeat(opened.repos),
  readDigests(opened.repos),
  readMapTilerUsageDigests(opened.repos),
  readDecisions(opened.repos),
  readCacheObservation(opened.repos),
]);

let failures = 0;
const require_ = (ok: boolean, what: string): void => {
  log(`${ok ? "OK   " : "FAIL "} ${what}`);
  if (!ok) failures += 1;
};

/* ------------------------------------------------------------------ SNAPSHOT */

log("");
log("PILOT HEALTH as the page reads it:");
if (snapshot.kind !== "HELD") {
  require_(false, `no snapshot: ${snapshot.detail}`);
} else {
  const s = snapshot.value;
  log(`  published ${s.publishedAt} from ${s.publishedFromSha?.slice(0, 8) ?? "unknown"}`);
  log(`  PILOT HEALTH: ${s.pilotGreen === null ? "NOT READY" : s.pilotGreen ? "GREEN" : "NOT GREEN"}`);
  for (const c of s.contracts) log(`    ${c.contract.padEnd(9)} ${c.state}`);
  log(
    `  panels: ${s.contracts.length} contract(s), ${s.decisionCards.length} decision card(s), ` +
      `${s.zipRows.held ? s.zipRows.value.length : 0} ZIP row(s), ${s.incidents.length} incident(s)`,
  );
  require_(s.contracts.length === 3, "three contracts are recorded (READER, TRUTH, FRESHNESS)");
  require_(
    s.contracts.every((c) => c.denominator.held || c.denominator.gap.says.trim() !== ""),
    "every contract carries either a denominator or a NAMED gap",
  );
  // Every number that reaches the page came through `measured`, which refuses a
  // missing denominator at construction. Re-asserting it here proves the
  // DURABLE record survived the round trip with its denominators intact — JSON
  // through Postgres is exactly where a field quietly goes missing.
  const bare = [
    ...s.obligationsByState.map((r) => r.count),
    ...s.obligationsByProvider.map((r) => r.count),
  ].filter((m) => typeof m.denominator !== "number" || m.contract.trim() === "");
  require_(bare.length === 0, `no number lost its denominator in the round trip (${bare.length} bare)`);

  log("  MAP PROVIDER:");
  if (!s.maptiler) {
    require_(false, "the canonical snapshot carries no MapTiler collection outcome");
  } else {
    const map = projectPanel({ snapshot: s.maptiler });
    log(`    ${map.readingState} · ${map.says}`);
    if (map.latestAttemptSays) log(`    latest attempt: ${map.latestAttemptSays}`);
    log(`    Reader-event comparison: ${map.actors?.state ?? "UNKNOWN"} · ${map.actors?.says ?? "not recorded"}`);
    require_(
      map.readingState !== "MEASURED_LKG" || map.latestAttemptSays !== null,
      "a retained MapTiler LKG names the failed automatic attempt and retry",
    );
    require_(
      map.readingState !== "UNKNOWN" || map.used === null,
      "an unknown MapTiler reading cannot render a measured zero",
    );
    require_(map.actors !== null, "the Reader-event comparison is measured or explicitly UNKNOWN");
  }
}

log("");
log("MAP PROVIDER append-only attempt history as Admin reads it:");
if (maptilerDigests.kind !== "HELD") {
  require_(false, `no map-provider history: ${maptilerDigests.detail}`);
} else {
  const history = projectMapTilerAttemptHistory(maptilerDigests.value, new Date().toISOString());
  for (const window of history.windows) {
    log(
      `  ${window.label}: ${window.attempts} attempt(s); ${window.promotedCurrent} promoted; ` +
        `${window.retainedLkg} retained LKG; ${window.unknownNoLkg} unknown without LKG; ` +
        `${window.inconsistent} inconsistent`,
    );
  }
  const thirtyDays = history.windows.find((window) => window.id === "30d");
  require_(
    (thirtyDays?.attempts ?? 0) === history.attempts.length,
    "Admin's exact map-provider rows equal its append-only 30-day attempt count",
  );
  require_(history.unplaced.length === 0, "every map-provider receipt has a usable non-future finish time");
}

/* ----------------------------------------------------------------- HEARTBEAT */

log("");
log("RUNNER heartbeat as the page reads it:");
if (heartbeat.kind !== "HELD") {
  require_(false, `no heartbeat: ${heartbeat.detail}`);
} else {
  const h = heartbeat.value;
  const live = livenessOf(h, new Date().toISOString());
  log(`  beatAt ${h.beatAt} · ${live.state} · ${live.detail}`);
  log(`  last cycle ${h.lastCycleStartedAt ?? "—"} -> ${h.lastCycleFinishedAt ?? "—"}`);
  log(`  testedSha ${h.testedSha?.slice(0, 8) ?? "unrecorded"}`);
  require_(typeof h.beatAt === "string" && h.beatAt !== "", "the heartbeat carries a beat time");
}

/* -------------------------------------------------------------------- DIGEST */

log("");
log("DIGEST as the page reads it:");
if (digests.kind !== "HELD") {
  require_(false, `no digest: ${digests.detail}`);
} else {
  const newest = digests.value[0];
  // RULING 159: a zero here would mean the runner has never published — which
  // is only sayable BECAUSE we reached the store and read it. The same two
  // characters from a store we could not open is a different fact entirely.
  log(
    "  " +
      floorLine(
        floored(
          "digests",
          "the owner-digest log",
          Math.max(digests.value.length, 1),
          digests.value.length,
        ),
      ) +
      "; newest " +
      String(newest?.digestId),
  );
  log(`  headline: ${newest?.headline}`);
  log(`  ${newest?.lines.length ?? 0} line(s) stored exactly as the runner emitted them`);
  require_(digests.value.length > 0, "at least one digest is durably recorded");
  require_(
    (newest?.lines.length ?? 0) > 0,
    "the digest body is stored, so the page prints the runner's record rather than re-rendering it",
  );
}

/* ---------------------------------------------------- DECISIONS AND THE WAIVER */

log("");
if (decisions.kind === "HELD") {
  log(
    "OWNER DECISIONS: " +
      floorLine(
        floored(
          "intents",
          "the owner-decision log",
          Math.max(decisions.value.length, 1),
          decisions.value.length,
          decisions.value.length === 0
            ? "the log is reachable and holds no intent — nobody has decided from a card yet"
            : undefined,
        ),
      ),
  );
  for (const d of decisions.value.slice(0, 5)) {
    log(`  ${d.decidedAt} ${d.subjectId} -> ${d.chosenOption} [${d.state}] ${d.canonicalRef ?? ""}`);
  }
} else {
  require_(false, `decisions unreadable: ${decisions.detail}`);
}

log("");
const line = renderCacheObservation(cache.kind === "HELD" ? cache.value : null);
log(`H1 WAIVER standing check [${line.state}]:`);
log(`  ${line.says}`);

log("");
log(failures === 0 ? "READ-BACK HELD" : `READ-BACK FAILED — ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
