/**
 * `pnpm exec tsx scripts/pima-shadow-report.mts` — THE APPLICABILITY REPORT for
 * the Pima shadow run.
 *
 * `pnpm shadow:run` already prints what the run DID. This prints what the run
 * was OWED, split along the only axis that decides whether an omission is a
 * defect: is this route's applicability to this obligation PROVEN, or is it a
 * method hypothesis we have not yet tested here?
 *
 * It exists because those two populations printed as one number for as long as
 * the floor was one list, and "28 routes owed, 8 disposed" is a sentence that
 * hides the whole question. Separately reported, the same run says: eight
 * first-party surfaces this publisher serves, all eight disposed, one of them
 * behind a permission wall; and twenty techniques nobody has proven apply here,
 * none of them yet executable against this publisher. Those are different facts
 * and they call for different work.
 *
 * READ-ONLY AND OFF THE NETWORK. It runs against in-memory repositories and a
 * temp evidence root, reads the committed method store and the recorded
 * publisher bytes under `tests/fixtures/`, and writes nothing anywhere. The
 * durability properties are `tests/control-plane-shadow-run.test.ts`'s job; this
 * script is about the floor.
 *
 * Exit codes:
 *   0  the report was produced
 *   1  the method store could not be read — a FAILED read, never an empty floor
 *   2  the floor-integrity guard found something: a required first-party surface
 *      was dropped, demoted, or left out of the completion contract
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { runPimaShadow } from "../lib/control-plane/shadow/pima-run.ts";
import { describeFloor, type FloorRoute } from "../lib/control-plane/preflight.ts";
import { loadMethodStore, methodStorePath } from "../lib/workstate/load.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const READER_SURFACES = [
  "data/meetings-snapshot.json",
  "data/ops/production-integrity.json",
];

const knowledge = loadMethodStore(ROOT);
if (!knowledge) {
  // A missing store is a FAILED READ. Reporting a floor computed from nothing
  // would be a guard that reports clean without having looked.
  console.error(`no method store at ${methodStorePath(ROOT)} — the floor cannot be computed`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "wtp-pima-report-"));
try {
  const result = await runPimaShadow({
    repos: createMemoryRepositories(),
    evidence: new MemoryEvidenceStore(),
    knowledge,
    fixtureDir: join(ROOT, "tests", "fixtures"),
    readerSurfaces: READER_SURFACES,
    readerSurfacePaths: READER_SURFACES.map((s) => join(ROOT, s)),
    stateRoot: join(scratch, "state"),
    runId: "shadow-pima-applicability-report",
  });

  const { floor, record, exploration, floorIntegrity, omissionVerdict } = result;
  const taskByRoute = new Map(record.routeTasks.map((t) => [t.routeId, t]));

  const head = (s: string): void => console.log(`\n${s}\n${"-".repeat(s.length)}`);

  console.log(
    `PIMA SHADOW RUN — APPLICABILITY REPORT\n` +
      `method store version ${floor.methodVersion}, ${knowledge.routes.length} routes\n` +
      `jurisdiction: state=${floor.jurisdiction.state} governmentType=${floor.jurisdiction.governmentType} ` +
      `platform=${floor.jurisdiction.platform} publisher=${floor.jurisdiction.publisher}\n` +
      `floor: ${floor.routes.length} route(s) = ${floor.required.length} MANDATORY + ` +
      `${floor.exploratory.length} SPECULATIVE EXPERIMENT(S)\n` +
      /*
       * **THE FLOOR UNDER THE FLOOR (RULING 159).**
       *
       * Every number in this report is a share of the method store's route
       * population. A store that failed to load, a path that resolved nowhere,
       * or a schema change that silently emptied `routes` all produce the same
       * output as a jurisdiction with nothing applicable: a clean run reporting
       * a small floor and a tidy completion verdict.
       *
       * That reading is the dangerous one here, because a SMALL floor looks
       * like progress — fewer owed routes, closer to done — when it may mean
       * the instrument never read the store. So the population is floored and
       * an empty one refuses rather than reports.
       */
      floorLine(
        floored(
          "routes in the method store considered for this jurisdiction",
          methodStorePath(ROOT),
          knowledge.routes.length,
          floor.routes.length,
        ),
      ),
  );

  /* ---- the audit table -------------------------------------------------- */

  head("AUDIT: why each route was considered applicable");
  console.log(
    ["route", "obligation", "proof", "matched", "unstated", "field"].join("\t"),
  );
  const row = (r: FloorRoute): void => {
    console.log(
      [
        r.routeId,
        r.obligation,
        r.proof,
        r.matchedDimensions.length ? r.matchedDimensions.join("+") : "NONE",
        r.unstatedDimensions.length ? r.unstatedDimensions.join("+") : "none",
        r.matchedFields.join("+") || "-",
      ].join("\t"),
    );
  };
  floor.required.forEach(row);
  floor.exploratory.forEach(row);

  /* ---- mandatory -------------------------------------------------------- */

  head(`MANDATORY — ${floor.required.length} route(s); omission refuses the close BY NAME`);
  for (const r of floor.required) {
    const t = taskByRoute.get(r.routeId);
    console.log(
      `  ${r.routeId}  ->  ${t?.disposition ?? "NO DISPOSITION"}` +
        (t?.outstanding ? "  [OUTSTANDING]" : "") +
        `\n      ${r.label} -> ${r.target}` +
        (t?.normalizedCount === null || t?.normalizedCount === undefined
          ? ""
          : `\n      rows: ${t.normalizedCount}`),
    );
  }

  const blockedKnown = floor.required.filter((r) => taskByRoute.get(r.routeId)?.outstanding);
  head(`BLOCKED KNOWN ROUTES — ${blockedKnown.length}`);
  if (blockedKnown.length === 0) console.log("  (none)");
  for (const r of blockedKnown) {
    const t = taskByRoute.get(r.routeId);
    console.log(
      `  ${r.routeId}: ${t?.disposition} (permission ${t?.permission}, transport ${t?.transport})\n` +
        `      ${t?.note ?? ""}`,
    );
  }

  /* ---- experiments ------------------------------------------------------ */

  head(`SPECULATIVE EXPERIMENTS — ${floor.exploratory.length}; applicability NOT proven here`);
  const untested = exploration.filter((e) => e.state === "UNTESTED");
  const walked = exploration.filter((e) => e.state === "WALKED");
  console.log(
    `  exploration queue executed: ${exploration.length} of ${floor.exploratory.length} entries\n` +
      `  WALKED: ${walked.length}    UNTESTED: ${untested.length}`,
  );
  for (const e of exploration) {
    console.log(`  [${e.state}] ${e.routeId}${e.disposition ? ` -> ${e.disposition}` : ""}`);
  }
  if (untested.length > 0) {
    console.log(`\n  why the untested ones are untested:\n      ${untested[0].reason}`);
  }

  /* ---- exclusions and the store's own shape ----------------------------- */

  head("TYPED APPLICABILITY: what the dimensions actually excluded");
  console.log(
    `  ${floor.excluded.length} route(s) of ${knowledge.routes.length} were EXCLUDED by a typed dimension`,
  );
  for (const e of floor.excluded) console.log(`      ${e.routeId}: ${e.reason}`);
  console.log(
    `  ${floor.legacyUnclassifiedCount} legacy entries hold prose nobody classified and are NOT ` +
      "inherited as conclusions",
  );

  /* ---- the guard and the verdicts --------------------------------------- */

  head("FLOOR INTEGRITY GUARD");
  if (floorIntegrity.length === 0) {
    console.log(
      "  clean: every adapter-declared surface is on the floor, marked REQUIRED, carried into\n" +
        "  the completion contract, and has a RouteTask to be disposed on.",
    );
  } else {
    for (const f of floorIntegrity) console.log(`  [${f.failure}] ${f.subject}\n      ${f.detail}`);
  }

  head("COMPLETION VERDICT");
  console.log(`  mayComplete: ${record.verdict.mayComplete}`);
  for (const s of record.verdict.satisfied) console.log(`  satisfied: ${s}`);
  const byCode = new Map<string, string[]>();
  for (const r of record.verdict.refusals) {
    byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.subject]);
  }
  for (const [code, subjects] of byCode) {
    console.log(`  REFUSED ${code} x${subjects.length}`);
    for (const s of subjects) console.log(`      ${s}`);
  }

  head("SEEDED OMISSION — /EventDates withheld");
  const named = omissionVerdict.refusals
    .filter((r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION")
    .map((r) => r.subject);
  console.log(`  mayComplete: ${omissionVerdict.mayComplete}`);
  console.log(`  INHERITED_ROUTE_WITHOUT_DISPOSITION names: ${named.join(", ") || "(nothing)"}`);

  head("THE FLOOR, IN FULL");
  console.log(describeFloor(floor));

  if (floorIntegrity.length > 0) process.exitCode = 2;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
