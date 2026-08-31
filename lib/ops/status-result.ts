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
 * someone typed. It is now a reading of the record: a canonical suite or walk
 * execution against a committed head is INDEPENDENTLY_REPRODUCED; a run whose
 * record is absent or which measured a different tree cannot be either, and
 * says so.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CAPABILITY_REGISTRY, type CapabilityEntry } from "./capability-registry.ts";

/* --------------------------------------------------------- run records */

interface GateRunRecord {
  runId: string;
  testedSha: string | null;
  finishedAt: string;
  gates: { id: string; status: string; seconds: number }[];
}

interface WalkRunRecord {
  runId: string;
  testedSha: string | null;
  finishedAt: string;
  durations: { identity: string; ms: number; outcome: string }[];
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
  readonly proofClass: "SESSION_MEASURED" | "INDEPENDENTLY_REPRODUCED" | null;
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
  ): StatusResult {
    const base = { entry, runId, testedSha, ranAt, recordPath: path };
    if (testedSha === null) {
      return {
        ...base,
        state: "STALE",
        detail: `${detail} — the record names no tested SHA, so it cannot be placed against the release`,
        proofClass: null,
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
      };
    }
    if (!passed) return { ...base, state: "FAILING", detail, proofClass: null };
    return {
      ...base,
      state: "PROVEN",
      detail,
      /*
       * A canonical suite or walk execution against a committed head is
       * reproduction by an instrument, not by the implementing session's own
       * one-off observation. That is what INDEPENDENTLY_REPRODUCED means, and
       * it is now read off the record rather than typed beside the claim.
       */
      proofClass: "INDEPENDENTLY_REPRODUCED",
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
      const raw = records.observer.raw as {
        verdict?: string;
        sha?: string;
        observedAt?: string;
        runId?: string;
      };
      return place(
        raw.sha ?? null,
        raw.observedAt ?? "unknown",
        raw.runId ?? "post-deploy-observer",
        records.observer.path,
        raw.verdict === "HEALTHY" || raw.verdict === "OK",
        `the post-deploy observer recorded verdict ${JSON.stringify(raw.verdict ?? "none")} ` +
          `for claim \`${source.claim}\``,
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
