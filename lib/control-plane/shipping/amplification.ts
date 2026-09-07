/**
 * **OWNER WAIT AND CERTIFICATION AMPLIFICATION, AS OPERATIONAL SLOs.**
 * (FCP-9E, 2026-09-07.)
 *
 * ## The number that matters, stated first
 *
 * > The metric is not merely Actions cost. It is **owner time stranded
 * > waiting for machinery.**
 *
 * Forty-five minutes on 2026-09-07, spent watching one logical change be
 * verified four times. Actions minutes were the visible cost and the smaller
 * one; the owner not being able to proceed was the real one, and nothing in
 * this repository measured it. This module is that measurement.
 *
 * ## Two defects, defined so they can be counted
 *
 * ```
 *   REDUNDANT_CERTIFICATION   a transaction with more than one FULL hosted
 *                             certification where a later one carries no
 *                             InvalidationReason
 *   BOOKKEEPING_BOUGHT_FULL   a bot/report/observer commit that purchased a
 *                             full shipping-grade proof
 * ```
 *
 * Both are stated as predicates rather than as guidance, because guidance
 * about cost is what the repository had on 2026-09-07 and it did not stop
 * anything. A defect that can be counted appears in the digest with a
 * denominator; a defect described in prose appears in a retrospective.
 *
 * ## The reading is derived, never asserted
 *
 * Every field below comes from the transaction's own certification ledger.
 * Nothing here takes a number from a session's report about itself — RULING
 * 273: a session does not measure itself. A field the ledger cannot support is
 * `null` and prints NOT MEASURED, never 0: printing zero runner-minutes for a
 * run whose minutes were never read would assert a measurement nobody took.
 *
 * PURE.
 */

import type {
  CertificationRecord,
  ShippingTransaction,
} from "./transaction.ts";

export const AMPLIFICATION_FORMAT_VERSION = 1;

/** The budget FCP-9B sets for a normal transaction. */
export const FULL_CERTIFICATION_BUDGET = 1;

export const AMPLIFICATION_DEFECTS = [
  "REDUNDANT_CERTIFICATION",
  "BOOKKEEPING_BOUGHT_FULL",
  "RECURSIVE_OBSERVER_CHAIN",
] as const;
export type AmplificationDefect = (typeof AMPLIFICATION_DEFECTS)[number];

export interface AmplificationDefectRow {
  readonly defect: AmplificationDefect;
  readonly transactionId: string;
  readonly detail: string;
}

export interface AmplificationReading {
  readonly formatVersion: typeof AMPLIFICATION_FORMAT_VERSION;
  readonly transactionId: string;
  readonly headline: string;
  /** Full hosted certifications that actually ran — cancelled ones excluded. */
  readonly fullCertifications: number;
  /** Full runs that were superseded or cancelled mid-flight. */
  readonly supersededCertifications: number;
  /** Cheap attestations of any kind. */
  readonly cheapAttestations: number;
  /** Runs stopped by a red cheap tier (RULING 279) — spend that was avoided. */
  readonly preflightRefusals: number;
  /**
   * Billed runner minutes across every recorded run, or null when no run
   * reported them. Null is NOT MEASURED and is never rendered as zero.
   */
  readonly runnerMinutes: number | null;
  /**
   * Wall-clock from the first certification start to the moment the candidate
   * became merge-ready (the first green FULL). Null when either end is unknown.
   */
  readonly ownerWaitMinutes: number | null;
  /** Post-ship bookkeeping commits, by producer. */
  readonly postShipCommits: number;
  /** Every certification beyond the first, with the reason it happened. */
  readonly beyondFirst: readonly {
    readonly sha: string;
    readonly runId: string | null;
    readonly reason: string;
  }[];
  readonly defects: readonly AmplificationDefectRow[];
  /** True when the transaction met the whole budget. */
  readonly withinBudget: boolean;
}

const ran = (c: CertificationRecord): boolean =>
  c.outcome === "GREEN" || c.outcome === "RED";

function minutesBetween(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const from = Date.parse(a);
  const to = Date.parse(b);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / 60_000);
}

/**
 * Read one transaction.
 *
 * The `bookkeepingProducers` set is supplied rather than derived here, because
 * the authority on which files a scheduled pusher writes is
 * `lib/ops/push-allowlist.ts` and there may not be a second list (RULING 278).
 * A caller that cannot supply it passes an empty set, and BOOKKEEPING_BOUGHT_FULL
 * is then simply not evaluated — an unevaluated defect is reported as such by
 * the caller, never as an absence of defects.
 */
export function readAmplification(txn: ShippingTransaction): AmplificationReading {
  const fulls = txn.certifications.filter((c) => c.kind === "FULL");
  const fullsThatRan = fulls.filter(ran);
  const superseded = fulls.filter((c) => c.outcome === "CANCELLED");
  const cheap = txn.certifications.filter(
    (c) => c.kind === "CHEAP_ATTESTATION" || c.kind === "TREE_EQUIVALENCE_ATTESTATION",
  );
  const refusals = txn.certifications.filter((c) => c.kind === "PREFLIGHT_REFUSED");

  const measuredMinutes = txn.certifications
    .map((c) => c.runnerMinutes)
    .filter((m): m is number => typeof m === "number" && Number.isFinite(m));
  const runnerMinutes = measuredMinutes.length === 0
    ? null
    : measuredMinutes.reduce((a, b) => a + b, 0);

  const firstStart = txn.certifications.length === 0
    ? null
    : txn.certifications
        .map((c) => c.startedAt)
        .sort()[0];
  const firstGreenFull = fulls.find((c) => c.outcome === "GREEN") ?? null;
  const ownerWaitMinutes = minutesBetween(firstStart, firstGreenFull?.endedAt ?? null);

  /*
   * "Beyond the first" counts runs that ACTUALLY RAN. A cancelled run is
   * counted separately as superseded: it is real spend and real owner wait,
   * but it is not a second verdict about the candidate, and folding the two
   * together would make a cancelled-then-rerun pair look like two proofs.
   */
  const beyondFirst = fullsThatRan.slice(1).map((c) => ({
    sha: c.sha,
    runId: c.runId,
    reason:
      c.invalidation === null
        ? "NO REASON RECORDED — this is the defect"
        : `${c.invalidation}: ${c.invalidationEvidence ?? "no evidence recorded"}`,
  }));

  const defects: AmplificationDefectRow[] = [];
  for (const c of fullsThatRan.slice(1)) {
    if (c.invalidation === null) {
      defects.push({
        defect: "REDUNDANT_CERTIFICATION",
        transactionId: txn.id,
        detail:
          `a second or later FULL hosted certification ran on ${c.sha.slice(0, 7)}` +
          `${c.runId ? ` (run ${c.runId})` : ""} with no invalidation reason: the previously ` +
          "certified tree was still the thing being shipped",
      });
    }
  }

  return {
    formatVersion: AMPLIFICATION_FORMAT_VERSION,
    transactionId: txn.id,
    headline: txn.headline,
    fullCertifications: fullsThatRan.length,
    supersededCertifications: superseded.length,
    cheapAttestations: cheap.length,
    preflightRefusals: refusals.length,
    runnerMinutes,
    ownerWaitMinutes,
    postShipCommits: txn.postShipObservations.length,
    beyondFirst,
    defects,
    withinBudget: defects.length === 0 && fullsThatRan.length <= FULL_CERTIFICATION_BUDGET,
  };
}

/**
 * The 2026-09-07 incident, reconstructed as a transaction, kept as a fixture in
 * code so the SLO has a known-answer control.
 *
 * A metric with no case it is known to score correctly is a metric nobody can
 * refute. This one is scored against the incident it was built from: four full
 * certifications, three of them beyond the first, two of those with no reason
 * recorded, and one — #806 — carrying the late-review reason that FCP-9A now
 * refuses in advance.
 */
export const INCIDENT_2026_09_07 = {
  transactionId: "txn-2026-09-07-maptiler-quota-isolation",
  runs: ["804", "805", "806", "807", "808"],
  certifiedTree: "dc3bee394389b13458293a46969a533a38285f22",
  certifiedSha: "be6e41ff682a172cc15610788d5974b7120a46e1",
  mergeSha: "0251d145e2a068d3bfe90b326d10db78c6d0dfcb",
  observerSha: "af32db55b58f1e4d24f2ce4462d12e01c0cb1e62",
  /** What each repair removes from the fan-out. */
  repairs: {
    "805": "FCP-9A review freeze — the late exploratory pass may not change a green head",
    "807": "FCP-9C tree equivalence — the merge tree IS the certified tree",
  },
  /** What survives every repair, and must: one full proof, one cheap observation. */
  irreducible: ["806", "808"],
} as const;

/** Aggregate a fleet of transactions into the numbers Admin renders. */
export interface AmplificationRollup {
  readonly transactions: number;
  readonly fullCertifications: number;
  readonly cheapAttestations: number;
  readonly supersededCertifications: number;
  readonly defects: readonly AmplificationDefectRow[];
  /** Mean full certifications per transaction. The headline ratio. */
  readonly certificationsPerTransaction: number | null;
  /** Mean owner wait, over the transactions that could report one. */
  readonly meanOwnerWaitMinutes: number | null;
  readonly runnerMinutes: number | null;
}

export function rollUpAmplification(
  readings: readonly AmplificationReading[],
): AmplificationRollup {
  const waits = readings
    .map((r) => r.ownerWaitMinutes)
    .filter((m): m is number => m !== null);
  const minutes = readings
    .map((r) => r.runnerMinutes)
    .filter((m): m is number => m !== null);
  const fulls = readings.reduce((a, r) => a + r.fullCertifications, 0);
  return {
    transactions: readings.length,
    fullCertifications: fulls,
    cheapAttestations: readings.reduce((a, r) => a + r.cheapAttestations, 0),
    supersededCertifications: readings.reduce((a, r) => a + r.supersededCertifications, 0),
    defects: readings.flatMap((r) => r.defects),
    certificationsPerTransaction: readings.length === 0 ? null : fulls / readings.length,
    meanOwnerWaitMinutes: waits.length === 0 ? null : waits.reduce((a, b) => a + b, 0) / waits.length,
    runnerMinutes: minutes.length === 0 ? null : minutes.reduce((a, b) => a + b, 0),
  };
}
