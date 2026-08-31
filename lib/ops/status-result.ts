/**
 * **THE STATUS RESULT — derived from run records, never typed.**
 * (A.1 WI6, 2026-08-30.)
 *
 * The other half of the split described in `capability-registry.ts`. That file
 * says what we claim and what would prove it. This one answers, for each
 * claim, the only question a status surface may answer:
 *
 * ```
 *   check Y last ran on SHA S at time T, result R, canonical run Z
 * ```
 *
 * Every field comes from a record an instrument WROTE:
 *
 * ```
 *   data/ops/gate-runs/*.json          pnpm gates
 *   data/health/walk-runs/*.json       pnpm walk:all
 *   data/health/reader-suite-runs/*    pnpm reader:suite
 *   data/ops/production-integrity.json the post-deploy observer
 * ```
 *
 * ## The rule that makes this different from what it replaces
 *
 * **No string anywhere can produce a current GREEN.** A capability is PROVEN
 * only when a run record naming its check exists, is current, and says the
 * check passed. Everything else is UNPROVEN, STALE or FAILING, and each of
 * those says which record it read and what that record said.
 *
 * The old ledger could not do this because there was nothing to read: the
 * result WAS the string. `status:ledger --check` compared Markdown to the
 * array holding those strings, so a ledger asserting a green suite passed its
 * own freshness check on a tree where the suite had never run.
 *
 * ## Proof class is DERIVED, not declared
 *
 * `SESSION_MEASURED` versus `INDEPENDENTLY_REPRODUCED` used to be a field
 * someone typed. It is now a reading of the record — but for one release it
 * was the WRONG reading: A.1 returned `INDEPENDENTLY_REPRODUCED` for every
 * passing canonical result, which is the class the implementing session's own
 * `pnpm gates` run earns by simply being canonical. RULING 216 excludes that
 * observation by name.
 *
 * Session B derives it from the run's recorded PROVENANCE instead — a clean
 * tree, already contained by the integration branch when the run began, and a
 * runner that is not a local session. `run-provenance.ts` holds the rule.
 * Every record written before that block existed reads `SESSION_MEASURED`,
 * which is the honest reading of a record that says nothing about who ran it.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CAPABILITY_REGISTRY, type CapabilityEntry } from "./capability-registry.ts";
import {
  proofClassOf,
  proofClassReason,
  type ProofClass,
  type RunProvenance,
} from "./run-provenance.ts";

/* --------------------------------------------------------- run records */

interface GateRunRecord {
  runId: string;
  testedSha: string | null;
  finishedAt: string;
  gates: { id: string; status: string; seconds: number }[];
  /** Written since Session B. Absent on older records, and absent is the weak case. */
  provenance?: RunProvenance;
}

interface WalkRunRecord {
  runId: string;
  testedSha: string | null;
  finishedAt: string;
  durations: { identity: string; ms: number; outcome: string }[];
  provenance?: RunProvenance;
}

/** Newest record in a directory of `<day>-<NN>.json` files, or null. */
function newest<T>(dir: string): (T & { path: string }) | null {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir)
    .filter((n) => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(n))
    .sort();
  const pick = names.at(-1);
  if (!pick) return null;
  const path = join(dir, pick);
  /* A record that cannot be parsed is a FAILED read, never an absent one. */
  return { ...(JSON.parse(readFileSync(path, "utf8")) as T), path };
}

export interface RunRecordSet {
  readonly gates: (GateRunRecord & { path: string }) | null;
  readonly walk: (WalkRunRecord & { path: string }) | null;
  readonly observer: { readonly path: string; readonly raw: unknown } | null;
}

export function loadRunRecords(root: string = process.cwd()): RunRecordSet {
  const integrityPath = join(root, "data", "ops", "production-integrity.json");
  return {
    gates: newest<GateRunRecord>(join(root, "data", "ops", "gate-runs")),
    walk: newest<WalkRunRecord>(join(root, "data", "health", "walk-runs")),
    observer: existsSync(integrityPath)
      ? { path: integrityPath, raw: JSON.parse(readFileSync(integrityPath, "utf8")) }
      : null,
  };
}

/* ------------------------------------------------------------ resolution */

export const RESULT_STATES = ["PROVEN", "FAILING", "STALE", "UNPROVEN"] as const;
export type ResultState = (typeof RESULT_STATES)[number];

export interface StatusResult {
  readonly entry: CapabilityEntry;
  readonly state: ResultState;
  /** What the record said, in one sentence. Quotes evidence, never asserts. */
  readonly detail: string;
  /** The canonical run this reading came from. Null when there is none. */
  readonly runId: string | null;
  readonly testedSha: string | null;
  readonly ranAt: string | null;
  readonly recordPath: string | null;
  /** DERIVED, never declared. Null when nothing was proven. */
  readonly proofClass: ProofClass | null;
  /**
   * Why the proof class is what it is, read off the run's provenance.
   * Null when nothing was proven. (Session B WI1.8.)
   */
  readonly proofClassReason: string | null;
}

function unproven(entry: CapabilityEntry, detail: string): StatusResult {
  return {
    entry,
    state: "UNPROVEN",
    detail,
    runId: null,
    testedSha: null,
    ranAt: null,
    recordPath: null,
    proofClass: null,
    proofClassReason: null,
  };
}

/**
 * Resolve one capability against the run records.
 *
 * `releaseSha` is the tree the reading is being made about. A record from a
 * tree the release does not contain is STALE, however green it was: it
 * measured different code. `contains` is injected because ancestry is a git
 * question and this module does not shell out.
 */
export function resolveCapability(
  entry: CapabilityEntry,
  records: RunRecordSet,
  releaseSha: string | null,
  contains: (ancestor: string, descendant: string) => boolean,
): StatusResult {
  if (entry.provenBy === null) {
    return unproven(
      entry,
      entry.neededCheck
        ? `no check is named for this claim. What is needed: ${entry.neededCheck}`
        : "no check is named for this claim, and none is described.",
    );
  }

  const source = entry.provenBy;

  /* A record's tree must contain the release, or it is about other code. */
  function place(
    testedSha: string | null,
    ranAt: string,
    runId: string,
    path: string,
    passed: boolean,
    detail: string,
    provenance: RunProvenance | null,
  ): StatusResult {
    const base = { entry, runId, testedSha, ranAt, recordPath: path };
    if (testedSha === null) {
      return {
        ...base,
        state: "STALE",
        detail: `${detail} — the record names no tested SHA, so it cannot be placed against the release`,
        proofClass: null,
        proofClassReason: null,
      };
    }
    if (releaseSha !== null && !contains(testedSha, releaseSha)) {
      return {
        ...base,
        state: "STALE",
        detail:
          `${detail} — but that run tested ${testedSha.slice(0, 8)}, which the release ` +
          `${releaseSha.slice(0, 8)} does not contain`,
        proofClass: null,
        proofClassReason: null,
      };
    }
    if (!passed) {
      return { ...base, state: "FAILING", detail, proofClass: null, proofClassReason: null };
    }
    return {
      ...base,
      state: "PROVEN",
      detail,
      /*
       * **THE PROOF CLASS IS A FACT ABOUT WHO RAN IT.** (Session B WI1.8.)
       *
       * This returned `INDEPENDENTLY_REPRODUCED` for every passing canonical
       * result, which awarded the activation-gating class to the implementing
       * session running `pnpm gates` on its own unmerged branch — the exact
       * observation RULING 216 excludes by name.
       *
       * It is now derived from the run's recorded provenance: a clean tree,
       * already contained by the integration branch when the run started, and
       * a runner that is not a local session. Everything else, including every
       * record written before the provenance block existed, is
       * `SESSION_MEASURED`. `run-provenance.ts` holds the rule and the reason.
       */
      proofClass: proofClassOf(provenance),
      proofClassReason: proofClassReason(provenance),
    };
  }

  switch (source.kind) {
    case "SUITE":
    case "GATE": {
      const gateId = source.kind === "SUITE" ? "test" : source.gateId;
      if (records.gates === null) {
        return unproven(
          entry,
          `no gate run record exists — run \`pnpm gates\`, which writes data/ops/gate-runs/.`,
        );
      }
      const gate = records.gates.gates.find((g) => g.id === gateId);
      if (!gate) {
        return unproven(
          entry,
          `the newest gate run record names no gate \`${gateId}\`, so nothing in it proves ` +
            `this claim. ${
              entry.neededCheck ?? `Add \`${gateId}\` to the gate set, or name a check that runs.`
            }`,
        );
      }
      const named =
        source.kind === "SUITE"
          ? ` (${source.testFiles.join(", ")}, run by the \`test\` gate)`
          : "";
      return place(
        records.gates.testedSha,
        records.gates.finishedAt,
        records.gates.runId,
        records.gates.path,
        gate.status === "PASS",
        `gate \`${gateId}\` reported ${gate.status} in ${gate.seconds}s${named}`,
        records.gates.provenance ?? null,
      );
    }

    case "WALK": {
      if (records.walk === null) {
        return unproven(
          entry,
          "no walk run record exists — run `pnpm walk:all` against a local production build, " +
            "which writes data/health/walk-runs/.",
        );
      }
      const byIdentity = new Map(records.walk.durations.map((d) => [d.identity, d.outcome]));
      const missing = source.checkIdentities.filter((id) => !byIdentity.has(id));
      if (missing.length > 0) {
        return unproven(
          entry,
          `the newest walk run did not report ${missing.length} of ` +
            `${source.checkIdentities.length} named identities: ${missing.join(" | ")}`,
        );
      }
      const failed = source.checkIdentities.filter((id) => byIdentity.get(id) !== "PASS");
      return place(
        records.walk.testedSha,
        records.walk.finishedAt,
        records.walk.runId,
        records.walk.path,
        failed.length === 0,
        failed.length === 0
          ? `all ${source.checkIdentities.length} named walk identities passed`
          : `${failed.length} of ${source.checkIdentities.length} named walk identities did ` +
            `not pass: ${failed.join(" | ")}`,
        records.walk.provenance ?? null,
      );
    }

    case "READER_SUITE": {
      return unproven(
        entry,
        "reader-suite proof sources resolve against a canonical reader-suite run record; " +
          "none names these instances yet.",
      );
    }

    case "OBSERVER": {
      if (records.observer === null) {
        return unproven(entry, "no post-deploy observer record exists at data/ops/production-integrity.json.");
      }
      /*
       * **READ THE SCHEMA THE OBSERVER ACTUALLY WRITES.** (B WI1.5.)
       *
       * This adapter expected `sha` and `verdict: "HEALTHY" | "OK"`. The
       * post-deploy observer writes `deployedSha`, `mainSha` and
       * `observed: "HELD"`. So every field read came back undefined, the
       * result was STALE, and the A.1 report explained the STALE by saying the
       * observer record "names no SHA" — a claim about the DATA that was
       * really a fact about the READER. The record names f762a72e in two
       * fields.
       *
       * Failing closed was right and is kept: an unrecognised shape is STALE,
       * never PROVEN. What changes is that the shape is now recognised.
       *
       * `deployedSha` is the tree the reading is ABOUT — what production was
       * actually serving. `mainSha` is where the branch stood, and the two
       * differing is exactly the drift the observer exists to catch, so the
       * deployed tree is the one placed against the release.
       */
      const raw = records.observer.raw as {
        observed?: string;
        deployedSha?: string;
        mainSha?: string;
        observedAt?: string;
        runId?: string;
        detail?: string;
        failureClass?: string | null;
        /* The pre-B field names, still read so an archived record resolves. */
        verdict?: string;
        sha?: string;
      };
      const observed = raw.observed ?? raw.verdict ?? null;
      const held = observed === "HELD" || observed === "HEALTHY" || observed === "OK";
      const drift =
        raw.deployedSha && raw.mainSha && raw.deployedSha !== raw.mainSha
          ? ` (main stood at ${raw.mainSha.slice(0, 8)} — the deployed tree is the one placed)`
          : "";
      return place(
        raw.deployedSha ?? raw.sha ?? null,
        raw.observedAt ?? "unknown",
        raw.runId ?? "post-deploy-observer",
        records.observer.path,
        held,
        `the post-deploy observer recorded ${JSON.stringify(observed ?? "none")} ` +
          `for claim \`${source.claim}\`${drift}` +
          (raw.failureClass ? `, failure class ${JSON.stringify(raw.failureClass)}` : ""),
        /*
         * The observer runs in CI after a deploy, against a tree that is by
         * construction already on main — so its provenance is not absent, it
         * is knowable. It is stated explicitly rather than defaulted, because
         * a default that happens to be right is the shape this whole work item
         * is about.
         *
         * **AND THE CLASS IS `CI`, NOT `SCHEDULED`.** (Session B resume, W5.)
         *
         * The comment above said "runs in CI" while the field said SCHEDULED,
         * and the field was wrong: `.github/workflows/post-deploy-integrity.yml`
         * is triggered by `push` to main, and its own header explains at length
         * why it is NOT on a schedule and NOT on `deployment_status`.
         *
         * It changes no proof class — `proofClassOf` only asks whether the run
         * was LOCAL_SESSION — so nothing went green that should not have. What
         * it corrupts is attribution: `lib/ops/schedule-audit.ts` assigns each
         * SCHEDULED run to "the most recent slot at or before its creation", so
         * every push-triggered observer run was being placed in a cron slot it
         * has no relationship to. A record that misdescribes how it was invoked
         * is a record that will be reasoned from wrongly later.
         */
        {
          runClass: "CI",
          workingTreeClean: true,
          integratedAtRunTime:
            raw.deployedSha && raw.mainSha ? raw.deployedSha === raw.mainSha : null,
          integrationRef: "main",
        },
      );
    }
  }
}

/** Every capability, resolved. The ledger renders exactly this. */
export function resolveAll(
  records: RunRecordSet,
  releaseSha: string | null,
  contains: (ancestor: string, descendant: string) => boolean,
  registry: readonly CapabilityEntry[] = CAPABILITY_REGISTRY,
): StatusResult[] {
  return registry.map((entry) => resolveCapability(entry, records, releaseSha, contains));
}
