/**
 * **ACQUISITION IS ITS OWN TRUTHFUL FAILURE DOMAIN.**
 * (FCP-2, 2026-09-07.)
 *
 * ## The defect this closes, measured twice
 *
 * On 2026-09-01 and 2026-09-02 the daily refresh threw away three healthy
 * sources' fresh data, both days, because one test refused one source's bytes.
 * `refresh-daily.yml` now attributes the refusal and keeps the survivors, which
 * is the right repair for the blast radius and does not touch the deeper
 * error:
 *
 * > **the thing that failed was not the thing that was marked failed.**
 *
 * FEC's acquisition succeeded. LegiScan's acquisition succeeded. What failed
 * was a downstream proof about an unrelated record. In a system where the
 * refresh's verdict is a single per-source outcome computed after the gate, a
 * browser that would not start, a MapTiler quota, or a Playwright timeout can
 * rewrite the answer to *did we fetch the FEC filing* — a question none of them
 * has any bearing on.
 *
 * The 2026-09-07 MapTiler closure is the same shape one layer out: an unrelated
 * provider's quota was capable of falsifying several sources at once.
 *
 * ## The rule, and it is one sentence
 *
 * > **A failure outside acquisition may never rewrite an acquisition result.**
 *
 * `sealAcquisition` returns a value that carries its own verdict, and
 * `applyDownstream` — the ONLY function here that takes a downstream outcome —
 * structurally cannot change it. Not "does not": cannot, because it returns the
 * sealed verdict unchanged and puts the downstream verdict in a different
 * field. A test asserts the two are independent over the whole cross product.
 *
 * ## What may and may not be necessary for an acquisition verdict
 *
 * ```
 *   MAY BE       the fetch, the parse, the normalize, the source's own
 *                semantic validation, the row conservation of RULING 269
 *   MAY NOT BE   a browser, MapTiler, a battlecard, a full app render,
 *                an unrelated source, or a GitHub Action
 * ```
 *
 * `FORBIDDEN_ACQUISITION_DEPENDENCIES` states the second list as data so the
 * failure-injection matrix can assert each one in turn rather than trusting a
 * paragraph.
 *
 * ## The candidate holding is durable, so a retry does not refetch
 *
 * `ACQUIRED_CHANGED` carries the bytes it acquired and their content hash. That
 * is FCP-2's last requirement and it is the one that makes FCP-3 affordable: a
 * certification that failed because the proof infrastructure was unavailable
 * must be retryable WITHOUT asking the publisher for the same bytes again.
 * Re-fetching to satisfy our own retry is rude to the publisher and it is also
 * how a stable source acquires a change it never made.
 *
 * PURE.
 */

export const ACQUISITION_FORMAT_VERSION = 1;

/** The three outcomes FCP-2 requires, and no fourth. */
export const ACQUISITION_OUTCOMES = [
  /** The publisher's bytes are the bytes we already hold. Nothing to certify. */
  "UNCHANGED",
  /** New bytes, normalized and semantically valid. A candidate holding exists. */
  "ACQUIRED_CHANGED",
  /** The acquisition itself did not complete. Nothing was learned. */
  "SOURCE_FAILED",
] as const;
export type AcquisitionOutcome = (typeof ACQUISITION_OUTCOMES)[number];

/**
 * Why an acquisition failed, in the classes the escalation policy distinguishes.
 * `SEMANTIC` is separated from `TRANSPORT` deliberately: the first is the
 * publisher's content being wrong or unreadable, which is a finding about the
 * source; the second is the network, which is a finding about us.
 */
export const ACQUISITION_FAILURES = [
  "TRANSPORT_FAILED",
  "REFUSED_BY_HOST",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "PARSE_FAILED",
  "SEMANTIC_INVALID",
  /** RULING 269: a zero-row extraction is a failed extraction. */
  "ZERO_ROW_EXTRACTION",
] as const;
export type AcquisitionFailure = (typeof ACQUISITION_FAILURES)[number];

/**
 * The things that may NEVER be necessary for an acquisition verdict.
 *
 * Data rather than prose so `tests/freshness-control-plane.test.ts` can inject
 * each one and assert the acquisition verdict is unmoved. FCP-2 names the first
 * five; `unrelated-source` is added because the 2026-09-01/02 incidents were
 * exactly that shape.
 */
export const FORBIDDEN_ACQUISITION_DEPENDENCIES: readonly string[] = [
  "browser",
  "maptiler",
  "battlecard",
  "full-app-render",
  "github-action",
  "unrelated-source",
];

/** The bytes an acquisition produced, held durably so a retry need not refetch. */
export interface CandidateHolding {
  /** The record class this holding belongs to — "meetings", "fec", "votes". */
  readonly recordClass: string;
  readonly sourceId: string;
  /** Content hash of the normalized bytes. The candidate's identity. */
  readonly contentHash: string;
  /** The repository paths this holding would write when it is promoted. */
  readonly governedPaths: readonly string[];
  /** Rows normalized. RULING 269: a non-zero fetch owes a non-zero count. */
  readonly rows: number;
  readonly acquiredAt: string;
  /**
   * Where the bytes are parked between acquisition and certification. A path,
   * a blob id — the store's business, not this module's. Never null on an
   * ACQUIRED_CHANGED result: a changed acquisition with nowhere to park its
   * bytes is an acquisition that will be asked to happen again.
   */
  readonly evidenceRef: string;
}

/**
 * A SEALED acquisition verdict.
 *
 * The name is the contract. Once this exists, the outcome is decided and no
 * later stage may alter it. Everything downstream travels beside it, never
 * through it.
 */
export interface SealedAcquisition {
  readonly formatVersion: typeof ACQUISITION_FORMAT_VERSION;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly outcome: AcquisitionOutcome;
  /** Non-null exactly when the outcome is SOURCE_FAILED. */
  readonly failure: AcquisitionFailure | null;
  /** Quotable, never a verdict on anybody. Null on a clean UNCHANGED. */
  readonly detail: string | null;
  /** Non-null exactly when the outcome is ACQUIRED_CHANGED. */
  readonly holding: CandidateHolding | null;
  readonly sealedAt: string;
}

/**
 * Seal an acquisition. The one constructor, so no other code can produce a
 * verdict with a shape that contradicts itself — a SOURCE_FAILED carrying a
 * holding, or an ACQUIRED_CHANGED with nowhere to park its bytes.
 */
export function sealAcquisition(input: {
  readonly sourceId: string;
  readonly recordClass: string;
  readonly outcome: AcquisitionOutcome;
  readonly failure?: AcquisitionFailure | null;
  readonly detail?: string | null;
  readonly holding?: CandidateHolding | null;
  readonly now: string;
}): SealedAcquisition | { readonly refused: true; readonly reason: string } {
  if (input.outcome === "SOURCE_FAILED") {
    if (!input.failure) {
      return {
        refused: true,
        reason:
          "a SOURCE_FAILED with no failure class is an unexplained refusal, and an unexplained " +
          "refusal is the shape RULING 250 refuses — absence is argued, never asserted",
      };
    }
    if (input.holding) {
      return {
        refused: true,
        reason: "a failed acquisition cannot carry a candidate holding: nothing was acquired",
      };
    }
  }
  if (input.outcome === "ACQUIRED_CHANGED") {
    if (!input.holding) {
      return { refused: true, reason: "ACQUIRED_CHANGED with no holding names no change" };
    }
    if (input.holding.rows <= 0) {
      return {
        refused: true,
        reason:
          `${input.sourceId} reports ACQUIRED_CHANGED with ${input.holding.rows} row(s): a ` +
          "zero-row extraction is a failed extraction, never an empty document (RULING 269)",
      };
    }
    if (!input.holding.evidenceRef) {
      return {
        refused: true,
        reason:
          "an acquired holding with no evidenceRef has nowhere to be retried from, so a later " +
          "certification attempt would have to refetch the publisher for bytes we already have",
      };
    }
  }
  if (input.outcome === "UNCHANGED" && input.holding) {
    return { refused: true, reason: "UNCHANGED carries no candidate: there is nothing new to hold" };
  }
  return {
    formatVersion: ACQUISITION_FORMAT_VERSION,
    sourceId: input.sourceId,
    recordClass: input.recordClass,
    outcome: input.outcome,
    failure: input.failure ?? null,
    detail: input.detail ?? null,
    holding: input.holding ?? null,
    sealedAt: input.now,
  };
}

export function isSealed(
  x: SealedAcquisition | { readonly refused: true; readonly reason: string },
): x is SealedAcquisition {
  return (x as { refused?: true }).refused !== true;
}

/**
 * **THE STRUCTURAL GUARANTEE.**
 *
 * Everything a downstream stage learns arrives here, and the sealed verdict
 * comes back untouched. There is no parameter that could change it and no
 * branch that returns a different one — which is what makes "a failure outside
 * acquisition must not rewrite an acquisition result" a property of the type
 * rather than a rule somebody remembers.
 */
export interface AcquisitionWithDownstream {
  readonly acquisition: SealedAcquisition;
  /** Whatever the downstream stage concluded. Never consulted here. */
  readonly downstream: unknown;
}

export function applyDownstream(
  acquisition: SealedAcquisition,
  downstream: unknown,
): AcquisitionWithDownstream {
  return { acquisition, downstream };
}

/** The acquisitions that produced something to certify. */
export function changedHoldings(
  results: readonly SealedAcquisition[],
): readonly CandidateHolding[] {
  return results
    .filter((r) => r.outcome === "ACQUIRED_CHANGED")
    .map((r) => r.holding)
    .filter((h): h is CandidateHolding => h !== null);
}

/** A one-line count with both terms, never a bare numerator. */
export function acquisitionSummary(results: readonly SealedAcquisition[]): string {
  const changed = results.filter((r) => r.outcome === "ACQUIRED_CHANGED").length;
  const unchanged = results.filter((r) => r.outcome === "UNCHANGED").length;
  const failed = results.filter((r) => r.outcome === "SOURCE_FAILED");
  const names = failed.map((r) => `${r.sourceId} (${r.failure})`).join(", ");
  return (
    `${results.length} source(s) attempted: ${changed} changed, ${unchanged} unchanged, ` +
    `${failed.length} failed${failed.length > 0 ? ` — ${names}` : ""}`
  );
}
