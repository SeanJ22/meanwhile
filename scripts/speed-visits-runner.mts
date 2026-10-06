#!/usr/bin/env node
/**
 * **FE-27: ONE SCHEDULED ROUND OF OUR OWN TEST VISITS.**
 *
 * Started as a child by the runner's "speed-visits" lane (lib/health/speed-visits.ts). Exits at once when the
 * switch is off (WTP_SPEED_VISITS=on turns it on) or the latest recorded pass is younger than the interval;
 * otherwise it runs the FE-02 worst-case pass on the live site. A host singleton keeps two rounds from overlapping.
 */
import { acquireProcessSingleton } from "../lib/civic-data/process-singleton.ts";
import { readLatestSpeedPass } from "../lib/control-plane/live-audit-log.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { SPEED_VISITS_SINGLETON_PORT, speedVisitsDue, speedVisitsEnabled } from "../lib/health/speed-visits.ts";

if (!speedVisitsEnabled(process.env)) {
  console.log("speed visits: off (set WTP_SPEED_VISITS=on to run the scheduled test visits)");
  process.exit(0);
}
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("speed visits: the control plane is not configured; nothing was measured");
  process.exit(1);
}
const now = new Date().toISOString();
const repos = await createPgRepositories(url, now, { skipBootstrap: true });
const last = await readLatestSpeedPass(repos, now);
if (!speedVisitsDue(last?.at ?? null, now)) {
  console.log(`speed visits: the last pass (${last?.at}) is recent enough; none due`);
  process.exit(0);
}
const hold = await acquireProcessSingleton("speed-visits", SPEED_VISITS_SINGLETON_PORT).catch(() => null);
if (hold === null) {
  console.log("speed visits: another round is running; this one stands down");
  process.exit(0);
}
try {
  await import("./worst-case-speed-pass.mts");
} finally {
  await hold.release();
}
