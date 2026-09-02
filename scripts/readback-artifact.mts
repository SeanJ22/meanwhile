/**
 * `pnpm readback:artifact` — **LAND WHAT THE SEPARATE READ-BACK PROCESS
 * ACTUALLY PRINTED, AND LET THE REPOSITORY DECIDE ITS PROOF CLASS.**
 * (Session C final, lane 1, 2026-09-01. RULING 216, RULING 218.)
 *
 * ## Why this is a second file and not a `--write` flag
 *
 * `scripts/lane-c-readback.mts` says, in its own header, that it writes nothing
 * and that this is the point: *"an instrument that could write is an instrument
 * that could write the answer it is being asked to find."* That is right, and
 * adding an output path to it would have quietly deleted the property.
 *
 * So the instrument is left exactly as it is and RUN AS A SUBPROCESS. What lands
 * here is its **verbatim stdout** plus the counts parsed back out of that text —
 * so every number in the artifact is traceable to a line the separate process
 * printed, and there is no path by which a number reaches the file without
 * having been printed by the reader first.
 *
 * ## THE PROOF CLASS IS NOT THIS SCRIPT'S TO CLAIM
 *
 * `proofClassOf` (`lib/ops/run-provenance.ts`) takes all three of: a `runClass`
 * that is not `LOCAL_SESSION`, a clean working tree, and a SHA already contained
 * by the integration ref. All three come from the ENVIRONMENT at run time. A
 * session that ran the reader itself satisfies none of the first, which is the
 * mechanism working rather than failing:
 *
 * > INDEPENDENTLY_REPRODUCED means somebody else's run agreed. A session cannot
 * > award itself independence by running the same command twice.
 *
 * This script therefore records the provenance block and CALLS `proofClassOf`.
 * It never writes a proof class of its own, and the artifact says in its own
 * `_note` what the class would need in order to change.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { proofClassOf, readRunProvenance } from "../lib/ops/run-provenance.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const DRY = process.argv.includes("--dry");
const OUT_DIR = join(ROOT, "data", "health", "control-plane-readback");

const INSTRUMENT = "pnpm readback:control-plane (scripts/lane-c-readback.mts)";

/**
 * Run the read-back in its own process and keep every byte it printed.
 *
 * `execFileSync`'s default buffer is 1 MB and it THROWS past it, which a
 * catch-all would then turn into a false fact about the control plane. The
 * buffer is raised and a failure is re-thrown rather than swallowed.
 */
function runReadback(): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--env-file=.env.local", "--experimental-strip-types", "scripts/lane-c-readback.mts"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return { stdout, exitCode: 0 };
  } catch (error) {
    const e = error as { stdout?: string; status?: number; message?: string };
    throw new Error(
      `the read-back process did not complete: ${e.message ?? "no message"}. ` +
        `Partial output: ${(e.stdout ?? "").slice(-500)}`,
    );
  }
}

/**
 * Parse the counts back OUT of the text the reader printed.
 *
 * Deliberately the long way round. A number that this script computed itself
 * would be this session measuring the control plane; a number lifted out of the
 * separate process's own line is that process's measurement, quoted.
 */
function parse(stdout: string): {
  provider: string | null;
  obligations: number | null;
  byRecordClass: Record<string, number>;
  obligationsWithOccurrence: number | null;
  occurrences: number | null;
  occurrencesWithDisposition: number | null;
  routeTaskDispositions: number | null;
  dispositionsByVerdict: Record<string, number>;
  debtRows: number | null;
} {
  const num = (re: RegExp): number | null => {
    const m = re.exec(stdout);
    return m ? Number(m[1]) : null;
  };
  const byRecordClass: Record<string, number> = {};
  const classBlock = /by recordClass, over every row the store holds:\n([\s\S]*?)\n\s*matching rows/.exec(
    stdout,
  );
  if (classBlock) {
    for (const line of classBlock[1].split("\n")) {
      const m = /^\s+(\S+)\s+(\d+)\s*$/.exec(line);
      if (m) byRecordClass[m[1]] = Number(m[2]);
    }
  }
  const dispositionsByVerdict: Record<string, number> = {};
  const dispBlock = /dispositions, VERBATIM as the workers committed them:\n([\s\S]*?)\n\s*(?:\(|debt rows)/.exec(
    stdout,
  );
  if (dispBlock) {
    for (const line of dispBlock[1].split("\n")) {
      const m = /^\s+([A-Z_]+)\s+(\d+)\s*$/.exec(line);
      if (m) dispositionsByVerdict[m[1]] = Number(m[2]);
    }
  }
  const providerLine = /READ BACK FROM THE DURABLE CONTROL PLANE — (.+)/.exec(stdout);
  return {
    provider: providerLine ? providerLine[1].trim() : null,
    obligations: num(/obligations matching "[^"]*": (\d+) of \d+/),
    byRecordClass,
    obligationsWithOccurrence: num(/matching obligations that opened at least one occurrence: (\d+) of/),
    occurrences: num(/occurrences carrying a committed disposition: \d+ of (\d+)/),
    occurrencesWithDisposition: num(/occurrences carrying a committed disposition: (\d+) of/),
    routeTaskDispositions: num(
      /occurrences whose RouteTask carries a COMMITTED disposition in the append-only log: (\d+) of/,
    ),
    dispositionsByVerdict,
    debtRows: num(/debt rows on matching obligations\s+(\d+)/),
  };
}

console.log(`readback:artifact · ${AS_OF}\n`);
const { stdout } = runReadback();
const counts = parse(stdout);

/* A read that produced no obligation count is a FAILED read of the control
   plane, never a control plane with nothing in it. */
if (counts.obligations === null || counts.provider === null) {
  console.error(
    "the read-back produced no obligation count and no provider line. That is a FAILED read of the " +
      "instrument's own output, never an empty store. Nothing is written.\n",
  );
  console.error(stdout.slice(0, 2000));
  process.exit(2);
}

const headSha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();
const provenance = readRunProvenance(headSha, ROOT);
const proofClass = proofClassOf(provenance);

const record = {
  formatVersion: 1,
  generatedBy: "scripts/readback-artifact.mts",
  generatedOn: AS_OF,
  at: new Date().toISOString(),
  instrument: INSTRUMENT,
  instrumentWritesNothing: true,
  provider: counts.provider,
  testedSha: headSha,
  counts,
  provenance,
  proofClass,
  proofClassReason:
    proofClass === "INDEPENDENTLY_REPRODUCED"
      ? "runClass is not LOCAL_SESSION, the working tree was clean, and the tested SHA was already contained by the integration ref"
      : `SESSION_MEASURED — runClass=${provenance.runClass}, workingTreeClean=${provenance.workingTreeClean}, ` +
        `integratedAtRunTime=${provenance.integratedAtRunTime} (ref ${provenance.integrationRef ?? "none"}). ` +
        "proofClassOf requires all three, and all three come from the environment at run time rather " +
        "than from an assertion in this file.",
  _note: [
    "GENERATED ARTIFACT — never hand-edited (RULING 92). Regenerate with `pnpm readback:artifact`.",
    "",
    "EVERY NUMBER IN `counts` WAS PARSED BACK OUT OF `stdout` BELOW, which is the verbatim output of a",
    "SEPARATE PROCESS that reads the durable control plane and writes nothing. There is no path by",
    "which a number reaches this file without the reader having printed it first.",
    "",
    "THE PROOF CLASS IS DERIVED BY `proofClassOf` AND IS NOT CLAIMED HERE. Moving it to",
    "INDEPENDENTLY_REPRODUCED needs all three of: a run whose runClass is CI or SCHEDULED (set by the",
    "environment, not by a flag), a clean working tree at run time, and a tested SHA already contained",
    "by the integration ref. A session that ran the reader itself satisfies none of the first, and",
    "that is the mechanism working. The honest way to move this is to run it from CI on an",
    "already-merged SHA.",
    "",
    "WHAT THE INSTRUMENT IS NOT: it reads WTP_CONTROL_PLANE_DATABASE_URL, which is the control plane's",
    "own connection and not the production READ-ONLY role. `pnpm verify:readonly` and `pnpm census:runs`",
    "are scoped to the four COLLECTION stores (search_log, reactions, intake_limiter, feedback) and",
    "have never been control-plane aware, so neither of them can answer this question.",
  ],
  stdout,
};

if (DRY) {
  console.log(JSON.stringify({ ...record, stdout: `${stdout.length} chars` }, null, 1));
  console.log("\n  --dry: nothing written.\n");
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = nextRunRecordPath(OUT_DIR, AS_OF);
  writeFileSync(path, `${JSON.stringify(record, null, 1)}\n`, "utf8");
  console.log(`  obligations              ${counts.obligations}`);
  for (const [k, v] of Object.entries(counts.byRecordClass)) {
    console.log(`      ${k.padEnd(22)} ${v}`);
  }
  console.log(`  occurrences              ${counts.occurrences}`);
  console.log(`      with a disposition   ${counts.occurrencesWithDisposition}`);
  console.log(`  routeTask dispositions   ${counts.routeTaskDispositions}`);
  for (const [k, v] of Object.entries(counts.dispositionsByVerdict)) {
    console.log(`      ${k.padEnd(22)} ${v}`);
  }
  console.log(`  debt rows                ${counts.debtRows}`);

  /*
   * THE DENOMINATOR FLOORS (RULING 159). Each of these is a numerator over a
   * population the reader printed on the same run, and `floored` refuses a zero
   * denominator outright — a control plane that came back with no obligations
   * is a FAILED read of the store, never a store with nothing owed in it.
   */
  console.log("\n  FLOORED COUNTS (both numbers, or a refusal)");
  for (const line of [
    floored(
      "obligations that have opened at least one occurrence",
      "every obligation row the durable control plane holds",
      counts.obligations,
      counts.obligationsWithOccurrence ?? 0,
      "the control plane returned no obligation rows at all",
    ),
    floored(
      "occurrences carrying a committed disposition",
      "every occurrence the durable control plane holds",
      counts.occurrences ?? 0,
      counts.occurrencesWithDisposition ?? 0,
      "the control plane returned no occurrences at all",
    ),
    floored(
      "candidate-enrichment obligations",
      "every obligation row the durable control plane holds",
      counts.obligations,
      counts.byRecordClass["candidate-enrichment"] ?? 0,
      "the control plane returned no obligation rows at all",
    ),
  ]) {
    console.log(`    ${floorLine(line)}`);
  }

  console.log(`\n  proof class              ${proofClass}`);
  console.log(`      ${record.proofClassReason}`);
  console.log(`\n  wrote ${path.slice(ROOT.length + 1)}\n`);
}
