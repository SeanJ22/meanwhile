/**
 * **THE OWNER CONTROL CENTRE'S DOMAIN, AND ITS REFUSALS.**
 * (Session C final, ITEM H, 2026-09-01.)
 *
 * The admin host (`ADMIN_ORIGIN`) replaces the Drive-mirror digest file as the place
 * the owner reads pilot health and acts on decisions. This module is the part
 * of that surface which has nothing to do with HTML: the record shapes, and the
 * checks that make three constitutional rules STRUCTURAL rather than habitual.
 *
 * ## Why this exists at all, rather than the page just reading things
 *
 * The admin page runs on Netlify, in standalone mode, inside a function bundle.
 * Six of the seven panels the owner wants — pilot health, the digest, the
 * Needs-Sean queue, the reader-suite grid, the intake status, and the caller-key
 * half of cost — are produced today by scripts that write JSON to the repo
 * working tree or markdown to a Google Drive folder. **None of that exists in a
 * deploy.** `next.config.ts` has a long, hard-won list of files that must be
 * named per route or they are silently absent from the bundle, and the failure
 * mode it documents over and over is the one that matters here: an untraced
 * read returns nothing, the catch returns null, and the surface renders its own
 * gap wording — which is INDISTINGUISHABLE FROM HONEST MISSING DATA.
 *
 * An admin page that did that would tell the owner his pilot was fine because
 * it could not find the file that says otherwise. So the data plane is
 * Postgres, the runner PUBLISHES to it, and the page only ever reads records
 * that a writer actually wrote.
 *
 * ## The three rules this file makes impossible to break
 *
 * ```
 *   1  EVERY NUMBER CARRIES ITS DENOMINATOR AND ITS INTERPRETATION CONTRACT
 *      -> you cannot construct a bare number here; `Measured` has no shape
 *         that omits them
 *   2  A NULL RENDERS AS ITS NAMED GAP, AND THE NAME SAYS WHOSE GAP IT IS
 *      -> `Gap` requires `whose`, so "we have not recorded this" and "they do
 *         not publish it" cannot come out as the same sentence
 *   3  STATED N EQUALS RENDERED ROWS
 *      -> `checkStatedEqualsRendered` is run by the page against itself
 * ```
 *
 * ## AGGREGATE-ONLY, and the owner is not an exception
 *
 * CLAUDE.md: there is NO user-to-user surface, reactions are write-only from
 * the reader's perspective, and anything EXPOSED, RENDERED or LICENSED is
 * aggregate-only WITHOUT EXCEPTION. The owner reading his own admin page is a
 * rendering. So no record in this module carries a reaction row, a demand
 * signal row, a search-log row, a question, an answer, an IP, a session, or any
 * field that could key back to one reader — and {@link assertAggregateOnly}
 * refuses one that tries, by field name, at write time.
 */

/* ------------------------------------------------------------------ *
 * 1. NUMBERS THAT CANNOT BE STATED WITHOUT THEIR DENOMINATOR
 * ------------------------------------------------------------------ */

/**
 * A number the owner is allowed to read, with the two things that make it
 * mean something.
 *
 * `value` alone is a statistic looking for a story. The pilot-health contracts
 * in `lib/health/contracts.ts` already refuse a zero denominator that was never
 * established (a zero out of zero is RED there, not a vacuous green), and this
 * is the same discipline carried onto the page: a panel may not print `12`
 * without saying twelve OF WHAT and what twelve MEANS.
 *
 * `contract` is the interpretation — the sentence that says what a reader of
 * this number is entitled to conclude. It is not a label and not a unit.
 */
export interface Measured {
  readonly value: number;
  /** What the value is out of. Never omitted, never inferred, never guessed. */
  readonly denominator: number;
  /** What this number licenses the reader to conclude. Prose, required. */
  readonly contract: string;
  /**
   * How the denominator itself was established. A denominator nobody can
   * account for makes the numerator unaccountable too, which is the failure
   * `assertDenominatorIsIndependent` exists to catch in the reader suite.
   */
  readonly denominatorSource: string;
}

/** Build a {@link Measured}, refusing the shapes that would mislead. */
export function measured(
  value: number,
  denominator: number,
  contract: string,
  denominatorSource: string,
): Measured {
  if (!Number.isFinite(value) || !Number.isFinite(denominator)) {
    throw new Error(
      `measured() requires finite numbers and got value=${value} denominator=${denominator}. ` +
        "NaN rendered through a template literal reads as the word NaN on the owner's page, " +
        "which looks like a bug in the page rather than a hole in the data.",
    );
  }
  if (denominator < 0 || value < 0) {
    throw new Error("measured() refuses negative counts — a count below zero is a bug, not a fact.");
  }
  if (value > denominator) {
    throw new Error(
      `measured() refuses value ${value} over denominator ${denominator}. A numerator larger ` +
        "than its denominator means the two were computed over different populations, and the " +
        "resulting percentage would be a confident sentence about nothing.",
    );
  }
  if (contract.trim() === "" || denominatorSource.trim() === "") {
    throw new Error(
      "measured() requires both an interpretation contract and a denominator source. A number " +
        "on the owner's page with neither is exactly the 'green standing in for verified' that " +
        "the constitution's order-of-trade forbids.",
    );
  }
  return { value, denominator, contract, denominatorSource };
}

/* ------------------------------------------------------------------ *
 * 2. A NULL IS A NAMED GAP, AND THE NAME SAYS WHOSE
 * ------------------------------------------------------------------ */

/**
 * Whose gap this is.
 *
 * CLAUDE.md is explicit and this is the whole of it: *"'We haven't recorded
 * this yet' is a fact about us; 'not in this chamber for this vote' is a fact
 * about them. They may never render as the same sentence."*
 *
 * `UNKNOWABLE_NOW` is the third state the constitution insists on separately —
 * `CANNOT_TELL` fails safe. A recording path that is not wired yet has NOT
 * observed an absence; it has observed nothing, and saying "not yet" there
 * would be asserting an absence we have no evidence for.
 */
export type GapOwner = "OURS" | "THEIRS" | "UNKNOWABLE_NOW";

/** A value we do not have, rendered as the specific reason we do not have it. */
export interface Gap {
  readonly whose: GapOwner;
  /** Plain language, for the owner. No enum value, no NO_SOURCE_FOUND. */
  readonly says: string;
}

/** A value, or the named gap where it would have been. Never a bare null. */
export type Held<T> = { readonly held: true; readonly value: T } | { readonly held: false; readonly gap: Gap };

export function held<T>(value: T): Held<T> {
  return { held: true, value };
}

export function gap<T>(whose: GapOwner, says: string): Held<T> {
  if (says.trim() === "") {
    throw new Error(
      "gap() requires the sentence the owner will actually read. An unnamed gap renders as " +
        "blank space, and blank space on a health page reads as 'fine'.",
    );
  }
  return { held: false, gap: { whose, says } };
}

/* ------------------------------------------------------------------ *
 * 3. STATED N EQUALS RENDERED ROWS
 * ------------------------------------------------------------------ */

export interface CountClaim {
  /** What the page said, in prose, e.g. "7 decisions await you". */
  readonly label: string;
  readonly stated: number;
  readonly rendered: number;
}

export interface StatedEqualsRenderedVerdict {
  readonly ok: boolean;
  readonly mismatches: readonly CountClaim[];
  readonly detail: string;
}

/**
 * The page's own check on itself, run at render time.
 *
 * A headline that says seven over a list of five is not a rounding error; it is
 * the page telling the owner that two things exist which he cannot see, and it
 * is precisely the failure mode "show everything we find" exists to prevent.
 * Running this at render — rather than trusting the code that built both — is
 * the point: the two numbers come from different places, so only comparing the
 * ACTUAL rendered row count can catch a divergence.
 */
export function checkStatedEqualsRendered(
  claims: readonly CountClaim[],
): StatedEqualsRenderedVerdict {
  const mismatches = claims.filter((c) => c.stated !== c.rendered);
  return {
    ok: mismatches.length === 0,
    mismatches,
    detail:
      mismatches.length === 0
        ? `${claims.length} count claim(s) checked; every stated number equals its rendered row count`
        : mismatches
            .map((m) => `${m.label}: stated ${m.stated}, rendered ${m.rendered}`)
            .join("; "),
  };
}

/* ------------------------------------------------------------------ *
 * 3b. THE PAGE AUDITS ITS OWN NUMBERS BEFORE IT SHOWS THEM
 * ------------------------------------------------------------------ */

/**
 * One number the page is about to put on screen, declared with its context.
 *
 * The page builds this list as it renders. It is not documentation — it is the
 * input to {@link auditRenderedNumbers}, which the page runs against ITSELF and
 * whose failure replaces the numbers with a refusal.
 */
export interface RenderedNumber {
  readonly label: string;
  readonly value: number;
  readonly denominator: number | null;
  readonly contract: string | null;
}

export interface RenderAuditVerdict {
  readonly ok: boolean;
  readonly offenders: readonly string[];
  readonly detail: string;
  readonly checked: number;
}

/**
 * **A NUMBER WITHOUT A DENOMINATOR DOES NOT GET RENDERED.**
 *
 * This is a seeded failure, and it is seeded because the failure it prevents is
 * one nobody notices. "14 obligations overdue" is not information: fourteen of
 * eighteen is an emergency, fourteen of nine thousand is a Tuesday, and the
 * owner reading a bare fourteen will supply a denominator from his own
 * imagination — which is the one place it certainly is not measured.
 *
 * The check runs at render time against the numbers ACTUALLY being emitted,
 * rather than trusting the types that produced them, because the types only
 * cover the values that came through `Measured`. A number computed inline in
 * the page — the exact way this rule gets broken — is caught here and nowhere
 * else.
 */
export function auditRenderedNumbers(numbers: readonly RenderedNumber[]): RenderAuditVerdict {
  const offenders = numbers
    .filter(
      (n) =>
        n.denominator === null ||
        n.denominator === undefined ||
        n.contract === null ||
        (typeof n.contract === "string" && n.contract.trim() === ""),
    )
    .map((n) =>
      n.denominator === null || n.denominator === undefined
        ? `${n.label} (no denominator)`
        : `${n.label} (no interpretation contract)`,
    );
  return {
    ok: offenders.length === 0,
    offenders,
    checked: numbers.length,
    detail:
      offenders.length === 0
        ? `${numbers.length} rendered number(s) checked; each carries a denominator and an interpretation contract`
        : `refusing to render: ${offenders.join("; ")}`,
  };
}

/* ------------------------------------------------------------------ *
 * 4. AGGREGATE-ONLY, ENFORCED BY FIELD NAME AT WRITE TIME
 * ------------------------------------------------------------------ */

/**
 * Field names that may never appear anywhere inside an owner-surface record.
 *
 * This is a blunt instrument on purpose. A subtle check would be one somebody
 * could reason their way around at 3 a.m.; a refused field name is not. The
 * list covers the identity columns of the collection stores (`lib/db/
 * schema.ts`) and the free-text a reader can type.
 *
 * **The collection stores never join**, and this is the boundary reaching the
 * one surface a human reads: nothing here may carry a value from the reaction
 * store, the search log, the demand-signal store or the ask store that could
 * be lined up against anything else.
 */
export const FORBIDDEN_RECORD_FIELDS: readonly string[] = [
  "email",
  "ip",
  "ipAddress",
  "userId",
  "sessionId",
  "session",
  "zipTyped",
  "address",
  "questionText",
  "answerText",
  "reaction",
  "reactionId",
  "demandSignal",
  "demandSignalId",
  "searchLogId",
  "token",
  "tokenDigest",
  "digestToken",
  "userAgent",
  "candidateOpinion",
  "freeText",
  "comment",
];

/**
 * Refuse an owner-surface record that carries a reader-level field.
 *
 * Recursive, because the field that sinks this is never at the top level — it
 * is three objects down in something that looked like a summary.
 */
export function assertAggregateOnly(record: unknown, context: string): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_RECORD_FIELDS.includes(key)) {
        throw new Error(
          `${context} refused: the owner-surface record carries the field '${key}' at ${path}.${key}. ` +
            "Aggregate-only is a boundary, not a storage rule (RULING 226) — anything EXPOSED, " +
            "RENDERED or LICENSED is aggregate-only without exception, and the owner reading his " +
            "own control centre is a rendering like any other.",
        );
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(record, context);
}

/* ------------------------------------------------------------------ *
 * 5. THE RECORDS THEMSELVES
 * ------------------------------------------------------------------ */

/** Every owner-surface record carries the version it was written under. */
export const OWNER_SURFACE_FORMAT_VERSION = 1;

/**
 * The runner's durable heartbeat.
 *
 * The admin site may not read the always-on machine's filesystem, its Drive
 * mirror, its process table or its scratch output — so "is the runner alive?"
 * has to be a fact the runner itself WROTE somewhere the deploy can read. A
 * heartbeat that the reader infers from the absence of bad news is not a
 * heartbeat.
 */
export interface RunnerHeartbeat {
  readonly formatVersion: number;
  /** Written by the runner at the end of every cycle. */
  readonly beatAt: string;
  readonly lastCycleStartedAt: string | null;
  readonly lastCycleFinishedAt: string | null;
  /** When the runner itself believes the next cycle is due. */
  readonly nextCycleDueAt: string | null;
  readonly lastCycleOk: boolean | null;
  /** The SHA the runner was executing at. */
  readonly testedSha: string | null;
  readonly host: string;
}

/**
 * ALIVE is DERIVED from the beat and the clock, never stored.
 *
 * A stored `alive: true` is a claim that stops being true without anything
 * rewriting it — which is exactly how a dead runner reports itself healthy.
 */
export type RunnerLiveness = "ALIVE" | "LATE" | "SILENT" | "NEVER_BEAT";

/** Past this, a runner that should beat every cycle has missed several. */
export const HEARTBEAT_LATE_MINUTES = 90;
export const HEARTBEAT_SILENT_MINUTES = 360;

export function livenessOf(
  heartbeat: RunnerHeartbeat | null,
  nowIso: string,
): { state: RunnerLiveness; sinceMinutes: number | null; detail: string } {
  if (!heartbeat) {
    return {
      state: "NEVER_BEAT",
      sinceMinutes: null,
      detail:
        "No heartbeat record exists. That is a fact about our control plane, not about the " +
        "runner — it may be running and unable to write, and those are different problems.",
    };
  }
  const beat = Date.parse(heartbeat.beatAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(beat) || !Number.isFinite(now)) {
    return {
      state: "NEVER_BEAT",
      sinceMinutes: null,
      detail: "The heartbeat timestamp could not be read, so liveness cannot be derived.",
    };
  }
  const minutes = Math.max(0, Math.round((now - beat) / 60000));
  if (minutes >= HEARTBEAT_SILENT_MINUTES) {
    return { state: "SILENT", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
  }
  if (minutes >= HEARTBEAT_LATE_MINUTES) {
    return { state: "LATE", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
  }
  return { state: "ALIVE", sinceMinutes: minutes, detail: `Last beat ${minutes} minutes ago.` };
}

/**
 * One digest, as the runner wrote it — the SAME record, not a re-rendering.
 *
 * The acceptance clause is that the digest shown EQUALS the runner's latest
 * durable record. So the runner stores the digest body it produced, and the
 * page prints that body. A page that recomputed the digest from parts could
 * agree with the runner on a good day and disagree on the day it matters.
 */
export interface OwnerDigestRecord {
  readonly formatVersion: number;
  readonly digestId: string;
  readonly writtenAt: string;
  readonly headline: string;
  /** The digest body, line by line, exactly as the runner emitted it. */
  readonly lines: readonly string[];
  readonly cycleOk: boolean | null;
  readonly testedSha: string | null;
}

/**
 * The H1 WAIVER'S STANDING CHECK (owner, 2026-09-01) — three states, never two.
 *
 * The waiver accepted a synthetic production-path probe as the caching proof
 * and attached a standing, NON-BLOCKING check: report the first ORGANIC reader
 * request recording `callerKey = prod-ask` with cache-read tokens, and until
 * then show *"organic prod-ask cache read: not yet observed"*.
 *
 * `scripts/ask-cache-probe.mts` stamps probe traffic `synthetic-run`, never
 * `prod-ask`, which is exactly what makes the check meaningful: only an organic
 * reader can produce the row.
 *
 * **The third state is the load-bearing one.** "Not yet observed" is a claim
 * about our RECORD, and it is only honest if the recording path is actually
 * wired. If production is not writing to the control plane, we have not
 * observed an absence — we have observed nothing, and saying "not yet" would
 * assert an absence with no evidence. Absence is never asserted.
 */
export type CacheObservationState = "OBSERVED" | "NOT_YET_OBSERVED" | "RECORDING_NOT_WIRED";

/** The owner's wording, kept verbatim. Do not paraphrase this string. */
export const ORGANIC_PROD_ASK_NOT_YET = "organic prod-ask cache read: not yet observed";

export interface CacheObservationRecord {
  readonly formatVersion: number;
  readonly state: CacheObservationState;
  /** Set only when state is OBSERVED. */
  readonly firstObservedAt: string | null;
  /** Token counts only — never the request, the question, or the answer. */
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  /**
   * When the recording path last confirmed it was able to write at all. This is
   * what separates NOT_YET_OBSERVED from RECORDING_NOT_WIRED: a path that has
   * never checked in cannot testify to an absence.
   */
  readonly recorderLastSeenAt: string | null;
}

/**
 * Render the standing check, keeping the three states apart.
 *
 * Returns the owner's exact string for the not-yet case, and something
 * materially DIFFERENT for the not-wired case, because collapsing them is the
 * one thing the owner asked not to happen.
 */
export function renderCacheObservation(record: CacheObservationRecord | null): {
  state: CacheObservationState;
  says: string;
} {
  if (!record || record.state === "RECORDING_NOT_WIRED") {
    return {
      state: "RECORDING_NOT_WIRED",
      says:
        "organic prod-ask cache read: we cannot tell — production is not yet recording cache " +
        "observations to the control plane, so this is a gap in our instrumentation and not a " +
        "statement about whether a reader request has happened.",
    };
  }
  if (record.state === "NOT_YET_OBSERVED") {
    return { state: "NOT_YET_OBSERVED", says: ORGANIC_PROD_ASK_NOT_YET };
  }
  const read = record.cacheReadInputTokens ?? 0;
  const created = record.cacheCreationInputTokens ?? 0;
  return {
    state: "OBSERVED",
    says:
      `organic prod-ask cache read: first observed ${record.firstObservedAt ?? "at an unrecorded time"} ` +
      `(${read} cache-read input tokens, ${created} cache-creation input tokens)`,
  };
}

/* ------------------------------------------------------------------ *
 * 6. OWNER DECISIONS — INTENT, NEVER A DIRECT EDIT
 * ------------------------------------------------------------------ */

/**
 * What a decision button actually does.
 *
 * **It does not edit repository authority from a browser.** The canonical
 * stores — `docs/governance/ledger.jsonl`, the tracker CSVs — are changed
 * through the governance path under normal gates, by a process that can run
 * `pnpm governance:check` and regenerate every view atomically. A web request
 * cannot do that, and a web request that tried would be writing law with no
 * validator, no compile and no regeneration: precisely the "generated artifact
 * hand-edited" failure RULING 92 and RULING 102 exist to prevent.
 *
 * So the button appends an INTENT. The intent is durable, authenticated,
 * timestamped and auditable. A later local/governance run materialises it into
 * the canonical ruling or tracker supersession under the normal gates. Until
 * that has happened and merged, the card says `PENDING_CANONICALIZATION` —
 * which is the truth, and is what stops the owner believing a decision has
 * landed when it has not.
 */
export type OwnerDecisionState =
  | "RECORDED"
  | "PENDING_CANONICALIZATION"
  | "CANONICALIZED"
  | "REJECTED_BY_GATES";

export interface OwnerDecisionIntent {
  readonly formatVersion: number;
  readonly intentId: string;
  /** The Needs-Sean row or decision card this answers. */
  readonly subjectId: string;
  /** Which option the owner picked, from the card's own option list. */
  readonly chosenOption: string;
  /** The consequence text the card showed for that option, captured as read. */
  readonly consequenceShown: string;
  readonly decidedAt: string;
  readonly state: OwnerDecisionState;
  /**
   * The canonical record this became — a ruling id or tracker resolution.
   * Null until a governance run materialises it, and the page says so.
   */
  readonly canonicalRef: string | null;
  /** Set when gates refused the materialisation, so the refusal is visible. */
  readonly refusedReason: string | null;
  /**
   * WHO decided. This is the OWNER's own session, and it is the one identity
   * in this module — an admin session id, never a reader identity, and it does
   * not join to any collection store because it exists in neither.
   */
  readonly adminSessionRef: string;
}

/* ------------------------------------------------------------------ *
 * 7. THE SNAPSHOT THE PAGE RENDERS
 * ------------------------------------------------------------------ */

/** One contract reading, flattened for the surface, with its denominator. */
export interface OwnerContractReading {
  readonly contract: "READER" | "TRUTH" | "FRESHNESS";
  readonly state: string;
  readonly reason: string;
  readonly denominator: Held<Measured>;
  /** SESSION_MEASURED or INDEPENDENTLY_REPRODUCED — the proof class shown. */
  readonly proofClass: string;
  readonly runSha: string | null;
  readonly runAt: string | null;
}

/** One ZIP's row in the reader-suite grid. */
export interface OwnerZipRow {
  readonly zip: string;
  readonly green: number;
  readonly red: number;
  readonly notEvaluable: number;
  /** The named failure classes seen, plain language for the owner. */
  readonly failureClasses: readonly string[];
}

/** One decision card in the Needs-Sean queue. */
export interface OwnerDecisionCard {
  readonly rowId: string;
  readonly title: string;
  readonly whatIsNeeded: string;
  readonly whyNoMachineCanDecide: string;
  readonly options: readonly { readonly option: string; readonly consequence: string }[];
  readonly blockedDescendants: number;
  readonly openedOn: string | null;
  readonly ageDays: number | null;
  readonly priority: string;
  /** RULING 227: the predicate, or an explicit NOT_MACHINE_VERIFIABLE marking. */
  readonly verifiability: "PREDICATE" | "NOT_MACHINE_VERIFIABLE";
}

/**
 * The whole control centre, as one durable aggregate the runner publishes.
 *
 * One record rather than seven, because the panels must agree with each other:
 * a page assembling seven independently-timed reads can show a pilot-health
 * headline from 09:00 beside a runner status from 14:00 and present the pair as
 * one moment. The snapshot is written at one instant and read at one instant,
 * and it carries that instant.
 */
export interface OwnerSnapshot {
  readonly formatVersion: number;
  readonly publishedAt: string;
  readonly publishedFromSha: string | null;
  readonly publisher: string;

  /** Panel 1 — PILOT HEALTH. */
  readonly pilotGreen: boolean | null;
  readonly contracts: readonly OwnerContractReading[];

  /** Panel 3 — the Needs-Sean queue, oldest first. */
  readonly decisionCards: readonly OwnerDecisionCard[];

  /** Panel 4 — runner obligations and debt, each with a denominator. */
  readonly obligationsByState: readonly { readonly state: string; readonly count: Measured }[];
  readonly obligationsByProvider: readonly { readonly provider: string; readonly count: Measured }[];
  readonly freshnessDebtRows: Held<Measured>;
  readonly incidents: readonly {
    readonly cause: string;
    readonly target: string;
    readonly obligationsAffected: number;
    readonly oldestHours: number | null;
  }[];

  /** Panel 5 — cost. */
  readonly costByRole: readonly { readonly key: string; readonly usd: Held<Measured> }[];
  readonly costByModel: readonly { readonly key: string; readonly usd: Held<Measured> }[];
  readonly cacheHitRateByCaller: readonly { readonly callerKey: string; readonly hitRate: Held<Measured> }[];
  readonly deterministicShare: Held<Measured>;
  readonly costPerVerifiedRecord: Held<Measured>;

  /**
   * Panel 6 — the reader-suite grid by ZIP.
   *
   * HELD only when the run record actually attributes results to ZIPs.
   * Measured 2026-09-01: it does not — `InstanceResult` carries a hashed
   * `instanceId` (`rq:22ccea04…`) and the ZIP lives on the INSTANCE, which the
   * run record does not store. Lumping every result into one "unattributed"
   * row would have produced a grid that looks like a measurement and is not.
   */
  readonly zipRows: Held<readonly OwnerZipRow[]>;

  /** Panel 7 — owner intake. */
  readonly intakeFolder: Held<string>;
  readonly intakeItemsFound: Held<Measured>;
  readonly intakeItemsProcessed: Held<Measured>;
  readonly intakeUnidentifiable: Held<Measured>;
}

/**
 * The count claims a rendered snapshot must satisfy.
 *
 * Built from the snapshot's OWN arrays so that the check compares the number a
 * headline would state against the number of rows that actually exist to
 * render. The page then compares these against what it really emitted.
 */
export function countClaimsFor(snapshot: OwnerSnapshot): readonly CountClaim[] {
  return [
    {
      label: "pilot health contracts",
      stated: snapshot.contracts.length,
      rendered: snapshot.contracts.length,
    },
    {
      label: "decision cards",
      stated: snapshot.decisionCards.length,
      rendered: snapshot.decisionCards.length,
    },
    { label: "incidents", stated: snapshot.incidents.length, rendered: snapshot.incidents.length },
    {
      label: "ZIP rows",
      stated: snapshot.zipRows.held ? snapshot.zipRows.value.length : 0,
      rendered: snapshot.zipRows.held ? snapshot.zipRows.value.length : 0,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 8. THE PILOT-HEALTH READING, FLATTENED FOR AN OWNER TO ACT ON.
 *
 * The page's job is to answer, at a glance: is it healthy, which contract is
 * failing, is it FAILING or merely STALE/not-yet-proven, why, and what needs
 * attention. This is a PURE PROJECTION of the snapshot the runner already
 * published — it changes how the truth is presented, never the truth. AMBER is
 * not a new health state: it is the honest name for "not green and not a
 * failure" (a NOT_READY instrument or AWAITING_OWNER_DATA), so the owner can
 * tell a broken contract from an unproven one without reading a SHA.
 * ------------------------------------------------------------------ */

/** A display band for a contract or the rollup. Never a stored health verdict. */
export type HealthLevel = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

/** One contract, projected for the compact card. Raw SHAs/proof class stay off it. */
export interface ContractCard {
  readonly contract: string;
  readonly level: HealthLevel;
  /** A two-word plain headline: Met / Failing / Not yet proven / Awaiting data. */
  readonly headline: string;
  /** The contract's denominator (num/denom) or its named gap. */
  readonly denominator: Held<Measured>;
  /** Proof age in plain words, from the run's timestamp. */
  readonly proofAge: string;
  /** The contract's own reason sentence (already plain language). */
  readonly reason: string;
  /** The genuine next action, or null when the contract is met. */
  readonly nextAction: string | null;
}

/** The whole compact pilot-health view: an overall band, one reason, three cards. */
export interface PilotHealthView {
  readonly overall: HealthLevel;
  readonly reason: string;
  readonly cards: readonly ContractCard[];
}

/** Map a contract's four-state reading to a display band. RED is a measured
 *  failure; AMBER is "not proven yet" (NOT_READY) or "awaiting data". */
export function contractHealthLevel(state: string): HealthLevel {
  switch (state) {
    case "GREEN":
      return "GREEN";
    case "RED":
      return "RED";
    case "NOT_READY":
    case "AWAITING_OWNER_DATA":
      return "AMBER";
    default:
      return "UNKNOWN";
  }
}

function contractHeadline(state: string): string {
  switch (state) {
    case "GREEN":
      return "Met";
    case "RED":
      return "Failing";
    case "NOT_READY":
      return "Not yet proven";
    case "AWAITING_OWNER_DATA":
      return "Awaiting owner data";
    default:
      return "Unknown";
  }
}

function contractNextAction(state: string, contract: string): string | null {
  switch (state) {
    case "GREEN":
      return null;
    case "RED":
      return `Investigate: the ${contract} bar is measurably not met (see reason).`;
    case "NOT_READY":
      return `Reproduce the ${contract} instrument to move it out of NOT_READY (see reason).`;
    case "AWAITING_OWNER_DATA":
      return "Load the owner corpus / answer key this contract measures against.";
    default:
      return null;
  }
}

function proofAgeText(runAt: string | null, nowIso: string): string {
  if (!runAt) return "no run recorded";
  const then = Date.parse(runAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "proof date unreadable";
  const hours = Math.max(0, Math.floor((now - then) / 3_600_000));
  if (hours < 1) return "proof under an hour old";
  if (hours < 48) return `proof ${hours}h old`;
  return `proof ${Math.floor(hours / 24)}d old`;
}

/**
 * Project the snapshot into the compact owner view. Pure: same snapshot + clock,
 * same view. `overall` follows `pilotGreen` (green only when all three are), and
 * distinguishes a measured failure (any RED) from merely-not-proven (AMBER).
 */
export function pilotHealthView(snapshot: OwnerSnapshot | null, nowIso: string): PilotHealthView {
  if (!snapshot) {
    return {
      overall: "UNKNOWN",
      reason: "No pilot-health snapshot has been published yet — nothing has been measured.",
      cards: [],
    };
  }
  const cards: ContractCard[] = snapshot.contracts.map((c) => ({
    contract: c.contract,
    level: contractHealthLevel(c.state),
    headline: contractHeadline(c.state),
    denominator: c.denominator,
    proofAge: proofAgeText(c.runAt, nowIso),
    reason: c.reason,
    nextAction: contractNextAction(c.state, c.contract),
  }));
  const anyRed = cards.some((c) => c.level === "RED");
  const anyAmber = cards.some((c) => c.level === "AMBER" || c.level === "UNKNOWN");
  const overall: HealthLevel =
    snapshot.pilotGreen === true
      ? "GREEN"
      : snapshot.pilotGreen === null
        ? "UNKNOWN"
        : anyRed
          ? "RED"
          : anyAmber
            ? "AMBER"
            : "RED";
  const blockers = cards
    .filter((c) => c.level !== "GREEN")
    .map((c) => `${c.contract} ${c.headline.toLowerCase()}`);
  const reason =
    overall === "GREEN"
      ? "All three contracts are met, each on its own denominator."
      : overall === "UNKNOWN"
        ? "No pilot-health verdict is recorded — the runner has not published one."
        : `Not green — ${blockers.join("; ")}.`;
  return { overall, reason, cards };
}
