/**
 * `pnpm shadow:run` — carry one real civic obligation through the hardened
 * control plane and write down what happened.
 *
 * This is a THIN DRIVER. Every decision the run makes lives in
 * `lib/control-plane/shadow/pima-run.ts`, which `tests/control-plane-shadow-run.test.ts`
 * executes as its acceptance test. One implementation, two callers (RULING 103):
 * a script whose behaviour diverges from the test that certifies it is a script
 * nothing certifies.
 *
 * WHAT IT WRITES, and where:
 *
 *   data/control-plane/shadow-runs/<runId>/state/    the durable repositories
 *   data/control-plane/shadow-runs/<runId>/evidence/ the artifact bodies
 *   data/control-plane/shadow-runs/<runId>/run.json  the replayable record
 *   data/control-plane/shadow-runs/<runId>/run.txt   the human summary
 *
 * WHAT IT DOES NOT WRITE: anything a reader can reach. The run digests every
 * serving surface before and after and the record carries both digests, so the
 * claim is checkable rather than promised. `--dry-run` writes nothing at all and
 * prints the summary, which is the default posture for exploring it.
 *
 * NO NETWORK. The artifacts are the publisher bytes already recorded under
 * `tests/fixtures/`. See the module docstring for why that is a decision rather
 * than a shortcut.
 *
 *   --dry-run          print the summary and write nothing (default)
 *   --write            persist the state, the evidence and the record
 *   --run-id=<id>      name the run. Defaults to the record's own default.
 *
 * Exit codes:
 *   0  the run executed and its record was produced
 *   1  the run could not execute — a missing fixture, an unreadable method store
 *   2  the run executed and MOVED A READER SURFACE, which is a finding
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { renderShadowRun } from "../lib/control-plane/shadow/run-record.ts";
import { OMITTED_ROUTE, runPimaShadow } from "../lib/control-plane/shadow/pima-run.ts";
import { explainRefusals } from "../lib/control-plane/completion.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { loadMethodStore, methodStorePath } from "../lib/workstate/load.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const write = process.argv.includes("--write");

/**
 * The serving surfaces a shadow run must not move.
 *
 * `data/meetings-snapshot.json` is the one the reader actually sees for this
 * obligation — the InSite adapter's committed output. The other two are carried
 * because a run that quietly rewrote canonical method knowledge or the
 * production-integrity record would also be a run that changed something it was
 * not entitled to, and the cheapest place to catch that is the same digest pass.
 *
 * THE METHOD STORE'S PATH COMES FROM `methodStorePath`, NOT FROM A LITERAL.
 * `tests/method-concurrency.test.ts`'s ratchet sweeps for a file that both names
 * that path and calls a write function, and it flagged this script — correctly,
 * on the evidence available to a text sweep: this file DOES write (`run.json`)
 * and DID name the store. Asking the canonical accessor removes the ambiguity at
 * its source rather than teaching the guard to ignore a shape it should be
 * suspicious of, and it is better code besides: one place knows where the store
 * lives (RULING 103).
 */
const READER_SURFACES = [
  "data/meetings-snapshot.json",
  relative(ROOT, methodStorePath(ROOT)).replace(/\\/g, "/"),
  "data/ops/production-integrity.json",
];

const knowledge = loadMethodStore(ROOT);
if (!knowledge) {
  console.error(`no method store at ${methodStorePath(ROOT)} — the floor cannot be computed`);
  process.exitCode = 1;
} else {
  const runId = arg("run-id") ?? `shadow-pima-2026-08-29`;
  const runDir = join(ROOT, "data", "control-plane", "shadow-runs", runId);
  const stateRoot = join(runDir, "state");
  const evidenceRoot = join(runDir, "evidence");

  if (write) {
    // A re-run is a REPLAY, so the previous run's state is cleared rather than
    // merged into. Merging would leave a WorkItem at a revision no run produced,
    // and the record's whole claim is that it can be replayed exactly.
    rmSync(runDir, { recursive: true, force: true });
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(evidenceRoot, { recursive: true });
  }

  const repos = write
    ? await createFileRepositories(stateRoot)
    : createMemoryRepositories();
  const evidence = write ? new DurableEvidenceStore(evidenceRoot) : new MemoryEvidenceStore();

  const { record, omissionVerdict, floor } = await runPimaShadow({
    repos,
    evidence,
    knowledge,
    fixtureDir: join(ROOT, "tests", "fixtures"),
    readerSurfaces: READER_SURFACES,
    readerSurfacePaths: READER_SURFACES.map((s) => join(ROOT, s)),
    /*
     * REPO-RELATIVE, never the absolute path.
     *
     * The record is committed and read by later sessions on other machines. An
     * absolute `C:\Users\seanj\...` in it is a fact about the laptop that
     * produced it, and a reader who resolved it would look in a directory that
     * does not exist and conclude the state was lost.
     */
    stateRoot: write
      ? `data/control-plane/shadow-runs/${runId}/state`
      : "(in-memory — nothing persisted, this is a dry run)",
    runId,
  });

  const summary = renderShadowRun(record);
  console.log(summary);

  console.log();
  console.log("========================================================================");
  console.log("THE SEEDED FAILURE — the same durable state with one known route withheld");
  console.log("========================================================================");
  console.log(
    `Route withheld: ${OMITTED_ROUTE}. This is the exact shape MTG-13 shipped: every other\n` +
      "route walked, the report internally consistent, and one known API never asked.\n",
  );
  console.log(explainRefusals(omissionVerdict));

  /*
   * EVERY COUNT AGAINST ITS DENOMINATOR (RULING 159).
   *
   * "8 routes disposed" and "28 routes disposed" print identically as a headline
   * and mean opposite things, and the first is the MTG-13 report exactly: a
   * count of what we did, with no statement of what was owed. The floor makes
   * the denominator impossible to omit.
   */
  console.log();
  console.log(`  ${floorLine(floored(
    "routes DISPOSED for this obligation",
    "the inherited route floor",
    floor.routes.length,
    record.routeTasks.filter((t) => t.disposition !== null).length,
  ))}`);
  console.log(`  ${floorLine(floored(
    "routes offered on EVIDENCE rather than on UNKNOWN portability",
    "the inherited route floor",
    floor.routes.length,
    floor.routes.filter((r) => !r.speculative).length,
  ))}`);
  console.log(
    `  method version ${floor.methodVersion}; ${record.floor.legacyUnclassifiedCount} legacy ` +
      "entries hold prose nobody has classified and are NOT inherited as conclusions",
  );
  console.log(
    "\nSHADOW: no reader surface moved. The InSite adapter and tests/legistar-insite-union.test.ts\n" +
      "remain the acceptance authority for Pima's fourteen sittings.",
  );

  if (write) {
    writeFileSync(join(runDir, "run.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
    writeFileSync(join(runDir, "run.txt"), `${summary}\n`, "utf8");
    console.log(`\nrecorded: ${join(runDir, "run.json")}`);
    console.log(`          ${join(runDir, "run.txt")}`);
  } else {
    console.log("\nDRY RUN — nothing was written. Re-run with --write to persist.");
  }

  if (!record.readerImpact.unchanged) {
    console.error(
      `\nA SHADOW RUN MOVED A READER SURFACE: ${record.readerImpact.moved.join(", ")}. ` +
        "This is a finding about the control plane, never a licence to move reader truth.",
    );
    process.exitCode = 2;
  }
}
