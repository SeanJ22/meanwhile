/**
 * @freshness-reads-here — `observedAt` is stamped at the moment production is
 * actually read, in the same run that reads it.
 *
 * `pnpm integrity:check` — runs the schema shipping gate's post-deploy reading
 * (both migration phases owed) and appends the outcome to the canonical
 * software-release outcome log that Admin and the release-freeze gate read. It
 * never queries the serving database itself, and never rolls anything back: a
 * red reading is recorded as DEGRADED and the run exits non-zero.
 *
 *   --sha=<commit>   the commit the reading is about. Defaults to origin/main's tip.
 *   --write          persist the reading to the control-plane log; otherwise print only.
 *
 * Exit codes mirror the gate's:
 *   0  the invariant held
 *   1  REFUSED — production and the committed migrations disagree
 *   2  COULD NOT TELL — no credential, or the migrations table was unreadable
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** The one git reader; the freeze gate imports it. A non-zero exit is null ("no answer"), never "no". */
export function git(...args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

/** Map the gate's exit code and printed refusals onto a named failure class. */
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

/** The gate line that best explains the verdict. Under `--smoke` a conclusive line wins over the earlier NOT APPLICABLE scope line. */
function detailFrom(output: string): string {
  const lines = output.split("\n").map((l) => l.trim());
  const conclusive = lines.find((l) => /^(HOLDS|REFUSED|db:gate: COULD NOT TELL)/.test(l));
  if (conclusive) return conclusive;
  const scope = lines.find((l) => /^NOT APPLICABLE/.test(l));
  return scope ?? "The gate produced no summary line.";
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
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
        "\nPRODUCTION INTEGRITY IS NOW DEGRADED until a passing re-check is recorded.\n" +
          "NOTHING WAS ROLLED BACK, and nothing will be:\n" +
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
