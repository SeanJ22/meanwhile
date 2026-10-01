/**
 * @freshness-reads-here — `observedAt` is stamped at the moment production is
 * actually read, in the same run that reads it. It is a measurement of when the
 * reading happened, not a re-stamp of a date carried over from somewhere else,
 * which is the restamping RULING 107 refuses. If this script ever recorded a
 * reading it did not itself take, this declaration would be false.
 *
 * `pnpm integrity:check` — take a production-integrity reading and record it.
 *
 * This is the trigger half of NH273. It asks the schema shipping gate for its
 * POST-DEPLOY reading — the moment where both migration phases are owed, and
 * therefore the one that fails on an unapplied CONTRACT migration that the
 * pre-deploy reading deliberately allows — and appends the answer to the
 * existing canonical software-release outcome log that Admin and the
 * release-freeze gate both read.
 *
 * IT RUNS THE EXISTING GATE RATHER THAN RE-ASKING PRODUCTION ITSELF. That is
 * deliberate and it is the whole reason this script is short. A second
 * implementation of "does production hold the migrations this commit ships"
 * would be a second verdict, free to disagree with the one branch protection
 * already trusts, and `tests/migration-shipping-invariant.test.ts` holds the
 * set of files permitted to query `drizzle.__drizzle_migrations` closed to four
 * for exactly that reason. This script never queries the serving database
 * itself. It spawns the gate, reads its exit code, and only then opens the
 * separate control-plane store to append the exact outcome receipt.
 *
 * WHAT IT DOES NOT DO, and will not be extended to do: roll anything back. The
 * owner's decision on 2026-08-28 is that a red reading marks state DEGRADED,
 * alerts, and blocks the next production-changing release — because production's
 * database may already have advanced, and rolling code back underneath an
 * advanced schema manufactures a second incompatibility on top of the first.
 *
 *   --sha=<commit>   the application-bearing commit the reading is ABOUT.
 *                    Defaults to origin/main's tip.
 *   --write          persist the reading to the canonical control-plane log.
 *                    Without it, the reading is printed and nothing is written.
 *   --record=<path>  fixture-only compatibility for the one explicit staging
 *                    record path. The retired production JSON path and every
 *                    other path are refused before the gate runs. The flag
 *                    exists so `scripts/staging-observer.mts` can take a
 *                    reading through this one gate and record staging evidence
 *                    in its own non-production file. The
 *                    alternative was a second implementation of "does the
 *                    database hold the migrations this commit ships", which is
 *                    a second verdict free to disagree with the one branch
 *                    protection trusts, and which
 *                    `tests/migration-shipping-invariant.test.ts` refuses by
 *                    holding the set of files that may query that table closed.
 *
 * Exit codes mirror the gate's, because inventing new ones would make two
 * vocabularies for one answer:
 *   0  the invariant held
 *   1  REFUSED — production and the committed migrations disagree
 *   2  COULD NOT TELL — no credential, or the migrations table was unreadable
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NEVER_CHECKED,
  assessIntegrity,
  type FailureClass,
  type IntegrityRecord,
} from "../lib/ops/production-integrity.ts";
import {
  CONTROL_PLANE_INTEGRITY_WRITE_URL_VAR,
  appendProductionIntegrity,
  readLatestProductionIntegrity,
} from "../lib/ops/production-integrity-data-plane.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Historical path retained only so every attempted write to it can be refused. */
export const RETIRED_PRODUCTION_RECORD_PATH = join(ROOT, "data", "ops", "production-integrity.json");
/** The sole explicit file target, used only by the non-production staging observer. */
export const STAGING_INTEGRITY_RECORD_PATH = join(ROOT, "data", "ops", "staging-integrity.json");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * One git reader, exported, because the freeze gate needs the same one.
 *
 * It was briefly written out twice — identically — in this file and in
 * `release-freeze-gate.mts`. RULING 103 refuses that, and it is right to: two
 * copies of "ask git and treat a non-zero exit as null" are two places for the
 * null handling to drift, and the whole NH273 mechanism turns on the difference
 * between "the answer is no" and "there was no answer".
 */
export function git(...args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

/** Read an explicitly named non-production fixture, or the honest never-checked one. */
export function readRecord(path: string): IntegrityRecord {
  if (!existsSync(path)) return NEVER_CHECKED;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as IntegrityRecord;
    // A shape this reader predates is UNKNOWN, never assumed compatible.
    if (parsed.formatVersion !== 1) {
      return {
        ...NEVER_CHECKED,
        detail: `The record declares formatVersion ${String(parsed.formatVersion)}, which this reader does not understand.`,
      };
    }
    return parsed;
  } catch (err) {
    return {
      ...NEVER_CHECKED,
      detail: `The record could not be parsed: ${(err as Error).message}`,
    };
  }
}

export function writeRecord(record: IntegrityRecord, path: string): void {
  if (resolve(path).toLowerCase() !== resolve(STAGING_INTEGRITY_RECORD_PATH).toLowerCase()) {
    throw new Error(
      `TRACKED_PRODUCTION_INTEGRITY_WRITE_RETIRED: --record may name only ${STAGING_INTEGRITY_RECORD_PATH}`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * Map the gate's exit code and output onto a named failure class.
 *
 * The classes are read off the gate's own printed refusals rather than
 * re-derived, so a new refusal in the gate surfaces here as an unclassified
 * REFUSED rather than as a silent pass.
 */
function classify(exit: number, output: string): { observed: IntegrityRecord["observed"]; failureClass: FailureClass | null } {
  if (exit === 0) return { observed: "HELD", failureClass: null };
  if (exit === 2) {
    if (/is not set in this environment/.test(output)) {
      return { observed: "COULD_NOT_TELL", failureClass: "CREDENTIAL_ABSENT" };
    }
    return { observed: "COULD_NOT_TELL", failureClass: "MIGRATIONS_TABLE_UNREADABLE" };
  }
  if (/do not match the SQL committed here/.test(output)) {
    return { observed: "REFUSED", failureClass: "APPLIED_SQL_REWRITTEN" };
  }
  if (/rewritten|deleted or renamed|immutab/i.test(output)) {
    return { observed: "REFUSED", failureClass: "MIGRATION_IMMUTABILITY_VIOLATION" };
  }
  if (/no MIGRATION_PHASES entry|undeclared/i.test(output)) {
    return { observed: "REFUSED", failureClass: "UNDECLARED_MIGRATION_PHASE" };
  }
  if (/already applied|applied early|before the deploy that stops/i.test(output)) {
    return { observed: "REFUSED", failureClass: "CONTRACT_APPLIED_EARLY" };
  }
  return { observed: "REFUSED", failureClass: "MIGRATION_NOT_APPLIED" };
}

/**
 * The one line of the gate's output that best explains the verdict.
 *
 * CONCLUSIVE LINES WIN OVER SCOPE LINES. Under `--smoke` the gate prints its
 * honest `NOT APPLICABLE` first — the change did not touch the schema contract —
 * and then contacts production anyway and prints `HOLDS`. Taking the first
 * match recorded the scope note as the finding, which reads as though nothing
 * had been checked when in fact production had just been read successfully.
 */
function detailFrom(output: string): string {
  const lines = output.split("\n").map((l) => l.trim());
  const conclusive = lines.find((l) => /^(HOLDS|REFUSED|db:gate: COULD NOT TELL)/.test(l));
  if (conclusive) return conclusive;
  const scope = lines.find((l) => /^NOT APPLICABLE/.test(l));
  return scope ?? "The gate produced no summary line.";
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  /*
   * The default is the durable control-plane log. `--record=` is a deliberately
   * narrow compatibility seam for the exact staging fixture only; it cannot be
   * redirected to the retired tracked production record or to another path.
   */
  const recordArg = arg("record");
  const recordPath = recordArg ? resolve(ROOT, recordArg) : null;
  if (recordPath !== null && recordPath.toLowerCase() !== resolve(STAGING_INTEGRITY_RECORD_PATH).toLowerCase()) {
    console.error(
      `REFUSED — --record is fixture-only and may name only ${STAGING_INTEGRITY_RECORD_PATH}.\n` +
        "The production integrity authority is the canonical control-plane log; tracked runtime JSON is retired.",
    );
    process.exitCode = 2;
    return;
  }
  const deployedSha = arg("sha") ?? git("rev-parse", "origin/main") ?? git("rev-parse", "HEAD");
  const mainSha = git("rev-parse", "origin/main");
  const observedAt = new Date().toISOString();

  console.log("PRODUCTION INTEGRITY READING (NH273)");
  console.log(`  about commit   ${deployedSha ?? "UNKNOWN"}`);
  console.log(`  origin/main    ${mainSha ?? "UNKNOWN"}`);
  console.log("  moment         post-deploy (both phases owed)");
  console.log("");

  const run = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/db-shipping-gate.mts", "--moment=post-deploy", "--smoke"],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" },
  );
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const exit = run.status ?? 2;
  process.stdout.write(output);

  const { observed, failureClass } = classify(exit, output);
  const record: IntegrityRecord = {
    formatVersion: 1,
    deployedSha: deployedSha ?? null,
    mainSha: mainSha ?? null,
    observed,
    failureClass,
    detail: detailFrom(output),
    observedAt,
    moment: "post-deploy",
    gateExit: exit === 0 || exit === 1 || exit === 2 ? (exit as 0 | 1 | 2) : 2,
  };

  const assessment = assessIntegrity(record, deployedSha ?? null);
  console.log("");
  console.log(`READING: ${observed}${failureClass ? ` (${failureClass})` : ""}`);
  console.log(`STATE:   ${assessment.state}`);
  console.log(`         ${assessment.reason}`);

  if (write) {
    try {
      if (recordPath !== null) {
        writeRecord(record, recordPath);
        console.log(`\nrecorded staging fixture: ${recordPath}`);
      } else {
        const connection = process.env[CONTROL_PLANE_INTEGRITY_WRITE_URL_VAR]?.trim() ?? "";
        if (connection === "") {
          throw new Error(`${CONTROL_PLANE_INTEGRITY_WRITE_URL_VAR} is not set`);
        }
        const repos = await createPgRepositories(connection, observedAt, { skipBootstrap: true });
        assertDurableRepositories(repos, "post-deploy production-integrity outcome");
        const receipt = await appendProductionIntegrity(repos.softwareReleaseReviews, record, {
          runId: process.env.WTP_RUN_ID ?? null,
          actor: "post-deploy-observer",
        });
        const readback = await readLatestProductionIntegrity(repos.softwareReleaseReviews);
        if (readback.kind !== "HELD" || readback.receipt.id !== receipt.id) {
          throw new Error(
            `POST_DEPLOY_INTEGRITY_READBACK_FAILED: appended ${receipt.id}, latest is ` +
              `${readback.kind === "HELD" ? readback.receipt.id : readback.kind}`,
          );
        }
        console.log(`\nrecorded durable receipt: ${receipt.id}`);
        console.log("read back in the integrity log (software_release_reviews)");
      }
    } catch (error) {
      console.error(
        `\nCOULD NOT RECORD — the canonical software-release outcome log refused or could not be reached ` +
          `(${error instanceof Error ? error.message : String(error)}).`,
      );
      console.error("The reading is not durable, so it cannot clear or establish the release-freeze state.");
      process.exitCode = 2;
      return;
    }
    if (observed === "REFUSED") {
      console.log(
        "\nPRODUCTION INTEGRITY IS NOW DEGRADED. The next production-changing release is frozen\n" +
          "until a passing re-check clears it. NOTHING WAS ROLLED BACK, and nothing will be:\n" +
          "the database may already have advanced past the deployed code.",
      );
    }
  } else {
    console.log("\n(--write not given; nothing was recorded)");
  }

  process.exitCode = exit;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("production-integrity.mts")) {
  await main();
}
