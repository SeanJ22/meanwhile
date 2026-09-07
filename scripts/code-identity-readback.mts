/**
 * **THE READ-BACK FOR CODE IDENTITY.** (PRDY-1, 2026-09-06. `pnpm code-identity:readback`.)
 *
 * The activation audit (ACT-1) could not tell from the heartbeat alone whether
 * the runner was current: it saw one SHA and compared it with raw main. This
 * script reads the heartbeat exactly as the admin page reads it, prints the
 * three SHAs the runner recorded and their verdict, and then RE-DERIVES the same
 * three from this checkout's git so an independent audit can see whether the
 * runner's record agrees with the repository.
 *
 * Exit codes: 2 when the control plane cannot be reached (COULD NOT TELL, never
 * printed like a pass — RULING 24); 1 when the heartbeat carries no readable
 * code identity or the independent reading is anything but CONSISTENT; 0 only
 * when the runner is current by the repository's own evidence.
 *
 *   --no-fetch   read origin/main as last seen instead of fetching first
 *   --json       also print both records as JSON for the evidence file
 */
import { openControlPlane, readHeartbeat } from "../lib/control-plane/admin-data.ts";
import { codeIdentityLine, isCodeIdentity, readCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { headSha } from "../lib/ops/git-facts.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const noFetch = argv.includes("--no-fetch");

function log(line: string): void {
  console.log(`code-identity:readback · ${line}`);
}

const opened = await openControlPlane();
if (!opened.ok) {
  log(`COULD NOT TELL — ${opened.detail}`);
  process.exit(2);
}
log(opened.repos.describe());
log(`local HEAD ${headSha()?.slice(0, 8) ?? "unknown"}`);

const heartbeat = await readHeartbeat(opened.repos);
if (heartbeat.kind !== "HELD") {
  log(`FAIL  no heartbeat: ${heartbeat.detail}`);
  process.exit(1);
}
const beat = heartbeat.value;
log(`heartbeat beatAt ${beat.beatAt}; testedSha ${beat.testedSha?.slice(0, 8) ?? "unrecorded"}; host ${beat.host}`);

const stored = beat.codeIdentity ?? null;
if (!isCodeIdentity(stored)) {
  log("FAIL  the heartbeat carries no readable code identity — a beat written before PRDY-1, or a runner that could not read git; nothing here says the runner is current");
  if (json) console.log(JSON.stringify({ stored, independent: null }, null, 2));
  process.exit(1);
}

log("");
log(`RUNNER RECORDED at ${stored.readAt}:`);
log(`  ${codeIdentityLine(stored)}`);
log(`  ${stored.detail}`);
for (const commit of stored.nonShippingAbove) log(`  non-shipping above: ${commit.sha.slice(0, 8)} — ${commit.reason}`);

const independent = readCodeIdentity({
  cwd: process.cwd(),
  runnerTestedSha: stored.runnerTestedSha,
  now: new Date().toISOString(),
  fetch: !noFetch,
});
log("");
log(`INDEPENDENT from this checkout at ${independent.readAt}${noFetch ? " (no fetch)" : ""}:`);
log(`  ${codeIdentityLine(independent)}`);
log(`  ${independent.detail}`);

let failures = 0;
const require_ = (ok: boolean, what: string): void => {
  log(`${ok ? "OK   " : "FAIL "} ${what}`);
  if (!ok) failures += 1;
};
const note = (ok: boolean, what: string): void => log(`${ok ? "OK   " : "NOTE "} ${what}`);

log("");
note(stored.rawMainSha === independent.rawMainSha,
  stored.rawMainSha === independent.rawMainSha
    ? "raw main agrees between the runner's record and this checkout"
    : `raw main moved since the beat: runner saw ${stored.rawMainSha?.slice(0, 8) ?? "unrecorded"}, this checkout sees ${independent.rawMainSha?.slice(0, 8) ?? "unrecorded"}`);
note(stored.effectiveExecutableSha === independent.effectiveExecutableSha,
  stored.effectiveExecutableSha === independent.effectiveExecutableSha
    ? "the executable head agrees between the runner's record and this checkout"
    : `the executable head moved since the beat: runner saw ${stored.effectiveExecutableSha?.slice(0, 8) ?? "unrecorded"}, this checkout derives ${independent.effectiveExecutableSha?.slice(0, 8) ?? "unrecorded"}`);
require_(stored.runnerTestedSha === beat.testedSha, "the code identity names the same SHA the heartbeat's testedSha names");
require_(independent.verdict === "CONSISTENT", `the independent verdict for the runner's SHA is CONSISTENT (it is ${independent.verdict})`);

if (json) console.log(JSON.stringify({ stored, independent }, null, 2));
process.exit(failures === 0 ? 0 : 1);
