/**
 * **WHAT A SCOUT RETURNS, AND WHAT THE MACHINE REFUSES TO ACCEPT FROM ONE.**
 * (Level 1 activation, 2026-09-01. RULING 240. Machine-owned provenance,
 * 2026-09-02, RULING 243. Worker Efficiency Law instrumentation, 2026-09-02,
 * RULING 244.)
 *
 * A Scout is a bounded model worker whose job is NOVELTY: a representation
 * nothing deterministic can open yet, a route the method store has not
 * learned, a wall whose compliant alternative has not been found. It reasons
 * over evidence its tools vaulted during the Attempt; it never creates
 * evidence by describing what it remembers seeing. Its output is therefore a
 * TYPED RESULT this file defines, validated here against the artifacts the
 * Attempt actually vaulted, and never chat prose.
 *
 * ## The invariants, each of which is a refusal below
 *
 * ```
 *   NO TOOL, NO RESULT      a Scout that called no research tool wrote prose;
 *                           it is refused (SCOUT_NO_TOOL_USED)
 *   A URL IS NOT A ROUTE    a candidate must cite artifact ids vaulted in THIS
 *                           Attempt (or inherited evidence cited by id); an id
 *                           the vault does not hold is a memory, not evidence
 *   NO EARLY ABSENCE        NO_PROGRESS / BLOCKED / NEEDS_ADAPTER require the
 *                           declared minimum of DISTINCT evidence-backed rungs,
 *                           unless the Attempt's own bound ended the walk — in
 *                           which case the result says so and carries the
 *                           rungs walked and the next rungs, so the next
 *                           Attempt resumes rather than restarts
 *   THE RUNG LIST IS OWED   a result without the walked-rung list is refused
 *   PROVENANCE IS THE       a candidate's observedOn, permission, recordClass
 *   MACHINE'S               and evidenceArtifactIds are DERIVED from the
 *                           artifact, obligation and permission records; the
 *                           model's values are recorded as CLAIMS, and a claim
 *                           that disagrees with the record is refused
 *                           (SCOUT_PROVENANCE_DISAGREES), an absent one refused
 *                           (SCOUT_PROVENANCE_ABSENT), and a citation set from
 *                           which no single verdict follows refused
 *                           (SCOUT_PROVENANCE_UNDERIVABLE)
 * ```
 *
 * The rung list is DERIVED by the executor from the tool calls that actually
 * ran and the artifacts they vaulted — never taken from the model's account of
 * itself. The model annotates rungs; it does not invent them.
 *
 * ## FIELD OWNERSHIP (RULING 243) — every field, and who writes it
 *
 * ```
 *   ScoutCandidate
 *     routeId, title, url, procedure, relevance   MODEL-PROPOSED  (procedure, relevance)
 *     permissionReading                          MODEL-PROPOSED  (its reading of the rules, prose)
 *     deterministic                              MODEL-PROPOSED  (replayability)
 *     unverified                                 MODEL-PROPOSED  (what remains unverified)
 *     claims                                     MODEL-PROPOSED, RECORDED VERBATIM, NEVER USED AS PROVENANCE
 *     observedOn                                 MACHINE-OWNED   earliest retrievedAt date among the cited artifacts
 *     permission                                 MACHINE-OWNED   the cited artifacts' permission verdict (robots documents excluded)
 *     recordClass                                MACHINE-OWNED   the obligation's record class
 *     evidenceArtifactIds                        MACHINE-OWNED   the cited ids the vault (or inherited evidence) holds
 *     provenance                                 MACHINE-OWNED   which artifacts the derivation rested on, and the rule
 *   ScoutFinding
 *     summary, kind                              MODEL-PROPOSED
 *     artifactIds                                MODEL-CITED, MACHINE-CHECKED against the vault
 *   ScoutRung
 *     rung (the label)                           MODEL-PROPOSED  (stated on the tool call)
 *     note                                       MODEL-PROPOSED
 *     index, tool, target, observed, ok,
 *     permission, artifactIds, at                MACHINE-OWNED
 *   ScoutResult
 *     outcome, nextRungs, unverified, narrative  MODEL-PROPOSED  (outcome validated against the ladder)
 *     everything else                            MACHINE-OWNED   (identity, usage, steps, cost, refusal, stamps)
 * ```
 */

import type { PermissionState } from "../../workstate/types.ts";
import type { ArtifactProvenance } from "./scout-contract.ts";
import type { ModelEffort } from "./model-routing.ts";

/** The typed outcomes. The closest canonical equivalents are noted on each. */
export const SCOUT_OUTCOMES = [
  /** A concrete, evidence-backed route/method proposal. Disposes DISCOVERED. */
  "ROUTE_CANDIDATE",
  /** Evidence of the record itself was acquired and vaulted. Disposes INGESTED. */
  "EVIDENCE_FOUND",
  /** A specific adapter is named and nothing else stands in the way. REQUIRES_NEW_ADAPTER. */
  "NEEDS_ADAPTER",
  /** Every walked rung hit a wall or a disallow. BLOCKED_CURRENTLY. */
  "BLOCKED",
  /** The ladder was walked to the declared minimum and nothing advanced. The Attempt ABORTS; the obligation stays owed. */
  "NO_PROGRESS",
  /** Only a human or offline act remains. RECORDS_REQUEST_PENDING-shaped; keeps the obligation live. */
  "HUMAN_REQUIRED",
] as const;
export type ScoutOutcome = (typeof SCOUT_OUTCOMES)[number];

/** The outcomes that assert something like an absence and therefore owe the ladder. */
export const LADDER_OWED_OUTCOMES: readonly ScoutOutcome[] = ["NO_PROGRESS", "BLOCKED", "NEEDS_ADAPTER"];

/**
 * The ladder, as named rungs. A starting point, never a limit: the model may
 * label a rung it walked with any of these, or with `other:<name>`.
 */
export const SCOUT_LADDER = [
  "primary-site-navigation",
  "site-search-or-sitemap",
  "in-browser-network-observation",
  "linked-documents-or-bulk-download",
  "open-data-portal",
  "alternate-official-host-or-mirror",
  "public-archive",
  "records-request-disclosure-log",
  "notices-agendas-minutes-citing-location",
  "compliant-alternate-route",
] as const;

/** The minimum DISTINCT evidence-backed rungs before an absence-shaped outcome is accepted. */
export const MIN_DISTINCT_RUNGS = 4;

/** Who ended the walk. The rung minimum applies only when the MODEL chose to stop. */
export type ScoutStop = "MODEL" | "BOUND";

/** One rung walked — DERIVED from a tool call that ran, annotated by the model. */
export interface ScoutRung {
  /** Additive machine observations; absent on legacy walks means not recorded. */
  readonly transport?: import("../../workstate/types.ts").TransportState | "NOT_ATTEMPTED";
  readonly httpStatus?: number | null;
  readonly returnedCount?: number | null;
  readonly nextHopUrls?: readonly string[];
  readonly applicableBecause?: string;
  readonly index: number;
  /** A SCOUT_LADDER name, or `other:<name>`. Stated by the model when it called the tool. */
  readonly rung: string;
  readonly tool: string;
  /** The URL or host the tool acted on. */
  readonly target: string;
  /** What the tool observed: an HTTP status, a permission verdict, a byte count. Machine-written. */
  readonly observed: string;
  /** Artifact ids this rung vaulted. Empty means the rung produced no evidence. */
  readonly artifactIds: readonly string[];
  /** The model's one-sentence reading of what this rung returned. */
  readonly note: string | null;
  readonly at: string;
  /** Whether the tool call succeeded. Machine-written; absent on results recorded before 2026-09-02. */
  readonly ok?: boolean;
  /** The permission verdict the call ran under. Machine-written; absent on older results. */
  readonly permission?: PermissionState;
}

/** The model's own statements about provenance facts. Recorded verbatim; never used as provenance. */
export interface ScoutProvenanceClaims {
  readonly observedOn: string | null;
  readonly permission: string | null;
  readonly recordClass: string | null;
}

/** How the machine-owned fields were derived. */
export interface ScoutCandidateProvenance {
  /** The artifact ids the derivation rested on, in the order cited. */
  readonly derivedFrom: readonly string[];
  readonly rule: string;
}

/** A route or method candidate, grounded in evidence acquired during THIS Attempt. */
export interface ScoutCandidate {
  /** A stable id the model proposes for the route, e.g. `wikimedia-rest-search`. */
  readonly routeId: string;
  readonly title: string;
  /** The URL or route identity. Must be substantiated by `evidenceArtifactIds`. */
  readonly url: string;
  /** GET/POST and any parameters the procedure needs, in words. */
  readonly procedure: string;
  readonly relevance: string;
  /** MACHINE-OWNED once accepted: the verdict the cited evidence was retrieved under. */
  readonly permission: PermissionState;
  readonly permissionReading: string;
  /** MACHINE-OWNED once accepted: the cited ids the vault (or inherited evidence) holds. */
  readonly evidenceArtifactIds: readonly string[];
  /** MACHINE-OWNED once accepted: the earliest retrieval date (UTC, YYYY-MM-DD) among the cited artifacts. */
  readonly observedOn: string;
  /** MACHINE-OWNED once accepted: the obligation's record class. */
  readonly recordClass: string;
  /** Whether the procedure appears replayable without a model. */
  readonly deterministic: boolean;
  readonly unverified: readonly string[];
  /** The model's original provenance statements. Absent on results recorded before RULING 243. */
  readonly claims?: ScoutProvenanceClaims;
  /** The machine's derivation record. Absent on results recorded before RULING 243. */
  readonly provenance?: ScoutCandidateProvenance;
}

/** An evidence finding: the record itself, or a pointer to it, was acquired. */
export interface ScoutFinding {
  readonly summary: string;
  readonly artifactIds: readonly string[];
  /** POINTER when the artifact points at the record; RECORD when it is the record. */
  readonly kind: "RECORD" | "POINTER";
}

/** Provider-reported usage, summed over the Attempt's model turns. Null where unreported. */
export interface ScoutUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
  readonly turns: number;
  readonly toolCalls: number;
}

/** Token counts by category for one step. Zero, never null: a step that ran reported its counts or ran no model. */
export interface StepTokens {
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly uncachedInput: number;
  readonly output: number;
}

/**
 * **ONE STEP OF THE ATTEMPT, INSTRUMENTED.** (RULING 244.) A MODEL step is one
 * provider turn: the model, the effort, the four token categories and the
 * cost at that model's rate. A DETERMINISTIC step is aggregated: how many
 * times the code ran and how many bytes of representation it handed the
 * model. No model, no tokens, no cost — and that is the measurement.
 */
export interface ScoutStep {
  readonly step: string;
  readonly kind: "MODEL" | "DETERMINISTIC";
  /** The provider turn, 1-based, for MODEL steps; null otherwise. */
  readonly turn: number | null;
  readonly model: string | null;
  readonly effort: ModelEffort | null;
  readonly tokens: StepTokens;
  /** Null when the model has no stated rate or reported no usage. */
  readonly usd: number | null;
  /** Bytes of sanitized representation this step handed the model. */
  readonly representationBytes: number;
  /** How many times a deterministic step ran; 1 for a model turn. */
  readonly count: number;
}

/** A turn after the first with zero cache-read tokens over an identical prefix. A defect, recorded. */
export interface ScoutCacheDefect {
  readonly turns: readonly number[];
  readonly detail: string;
}

/** A research call the executor refused under the no re-read / no re-walk rule. */
export interface ScoutGuardRefusal {
  readonly kind: "RE_READ" | "RE_WALK";
  readonly tool: string;
  readonly target: string;
  readonly detail: string;
}

/** A tool result larger than its step's representation budget, truncated with a stated notice. */
export interface ScoutRepresentationOverrun {
  readonly tool: string;
  readonly target: string;
  readonly bytes: number;
  readonly budget: number;
  readonly artifactIds: readonly string[];
}

/** The typed result, as persisted. */
export interface ScoutResult {
  readonly formatVersion: 1;
  readonly attemptId: string;
  readonly obligationId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly subjectId: string;
  readonly routeId: string | null;
  readonly recordClass: string;
  readonly providerId: string | null;
  /** Why the executor decision sent this to a Scout. */
  readonly reason: string;
  readonly outcome: ScoutOutcome;
  readonly stoppedBy: ScoutStop;
  readonly rungs: readonly ScoutRung[];
  readonly distinctEvidenceRungs: number;
  readonly candidates: readonly ScoutCandidate[];
  readonly findings: readonly ScoutFinding[];
  /** What the Scout would have tried next. Required when the bound ended the walk. */
  readonly nextRungs: readonly string[];
  readonly unverified: readonly string[];
  /** The Scout's own statement, one paragraph, for the owner. Never evidence. */
  readonly narrative: string;
  readonly worker: { readonly provider: string; readonly model: string; readonly modelReported: string | null };
  readonly usage: ScoutUsage;
  readonly usd: number | null;
  readonly elapsedMs: number;
  readonly artifactIds: readonly string[];
  /** Method candidate ids proposed into the candidate store, if any. */
  readonly methodCandidateIds: readonly string[];
  /**
   * Non-null when the executor REFUSED the model's finish (an early absence,
   * a candidate without evidence, no tool used). The record is persisted so
   * the audit trail and the resume cursor survive; its `outcome` is never a
   * legitimate finding, and every reader must show it as REFUSED.
   */
  readonly refusal: readonly ScoutIssue[] | null;
  readonly startedAt: string;
  readonly recordedAt: string;
  /* ---- RULING 244 instrumentation. Absent on results recorded before 2026-09-02. ---- */
  /** The effort the SCOUT role ran at. */
  readonly effort?: ModelEffort;
  readonly steps?: readonly ScoutStep[];
  readonly cacheDefect?: ScoutCacheDefect | null;
  readonly guardRefusals?: readonly ScoutGuardRefusal[];
  readonly representationOverruns?: readonly ScoutRepresentationOverrun[];
  /** How many prior rungs the brief listed as the resume cursor. */
  readonly resumedFromRungs?: number;
}

/* ------------------------------------------------------------- validation */

/**
 * THE CLOSED LIST OF REFUSALS. A finish is refused with one or more of these
 * and nothing else; a new way to be wrong is added here, documented, and
 * tested, never improvised in a detail string.
 */
export const SCOUT_REFUSALS = [
  "SCOUT_NO_TOOL_USED",
  "SCOUT_RUNG_LIST_MISSING",
  "SCOUT_EARLY_ABSENCE",
  "SCOUT_CANDIDATE_WITHOUT_EVIDENCE",
  "SCOUT_FINDING_WITHOUT_EVIDENCE",
  "SCOUT_OUTCOME_UNKNOWN",
  "SCOUT_BOUND_WITHOUT_NEXT_RUNGS",
  "SCOUT_EVIDENCE_OUTCOME_WITHOUT_FINDING",
  "SCOUT_CANDIDATE_OUTCOME_WITHOUT_CANDIDATE",
  /** The provider never answered, or refused the request. Nothing the model said stands. */
  "SCOUT_TRANSPORT_FAILED",
  /** The turns ran out with no accepted finish. */
  "SCOUT_NO_FINISH",
  /** RULING 243: a candidate omits observedOn, permission or recordClass, so no claim was made to check. */
  "SCOUT_PROVENANCE_ABSENT",
  /** RULING 243: the model's observedOn / permission / recordClass disagrees with the machine's derivation. */
  "SCOUT_PROVENANCE_DISAGREES",
  /** RULING 243: the cited artifacts yield no single verdict (none with provenance, disagreeing verdicts, or a DISALLOWED retrieval). */
  "SCOUT_PROVENANCE_UNDERIVABLE",
  /** RULING 244: the executor decision was DETERMINISTIC (a graduated or declared route) and the model executor was reached anyway. */
  "SCOUT_GRADUATED_ROUTE",
] as const;
export type ScoutRefusal = (typeof SCOUT_REFUSALS)[number];

export interface ScoutIssue {
  readonly code: ScoutRefusal;
  readonly detail: string;
}

/** What the model hands to `finish`. Everything else on the result is machine-written. */
export interface ScoutFinishInput {
  readonly outcome: string;
  readonly rungsWalked: readonly { readonly index: number; readonly note: string }[];
  readonly candidates: readonly ScoutCandidate[];
  readonly findings: readonly ScoutFinding[];
  readonly nextRungs: readonly string[];
  readonly unverified: readonly string[];
  readonly narrative: string;
}

/** Count rungs that are DISTINCT by (rung, target) AND carry at least one artifact. */
export function distinctEvidenceRungs(rungs: readonly ScoutRung[]): number {
  const seen = new Set<string>();
  for (const r of rungs) {
    if (r.artifactIds.length === 0) continue;
    seen.add(`${r.rung} | ${r.target}`);
  }
  return seen.size;
}

/* --------------------------------------------- machine-owned provenance */

/** The methodRouteId of a robots document. It is the permission INSTRUMENT, never the route's evidence. */
export const ROBOTS_ROUTE_ID = "scout:read_permission";

export const PROVENANCE_RULE =
  "observedOn = the earliest retrievedAt date (UTC) among the cited artifacts; permission = the verdict the cited " +
  "non-robots artifacts were retrieved under (those at the candidate URL first, then its host, then all cited), " +
  "refused when they disagree or any cited retrieval was DISALLOWED; recordClass = the obligation's; " +
  "evidenceArtifactIds = the cited ids the vault or inherited evidence holds";

export interface MachineProvenance {
  readonly observedOn: string;
  readonly permission: PermissionState;
  readonly recordClass: string;
  readonly evidenceArtifactIds: readonly string[];
  readonly provenance: ScoutCandidateProvenance;
}

export type ProvenanceDerivation =
  | { readonly ok: true; readonly value: MachineProvenance }
  | { readonly ok: false; readonly code: "SCOUT_PROVENANCE_UNDERIVABLE"; readonly detail: string };

/** The UTC date part of an ISO stamp, or null when it does not parse. */
export function utcDateOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * DERIVE a candidate's machine-owned provenance from the artifact records.
 * Pure. `provenance` is every artifact the Attempt vaulted or inherited WITH
 * a machine record; `known` is every id the finish may cite at all.
 */
export function deriveCandidateProvenance(input: {
  readonly candidate: { readonly routeId?: string; readonly url: string; readonly evidenceArtifactIds: readonly string[] };
  readonly provenance: ReadonlyMap<string, ArtifactProvenance>;
  readonly known: (id: string) => boolean;
  readonly recordClass: string;
}): ProvenanceDerivation {
  const label = `candidate ${input.candidate.routeId ?? "(unnamed)"} at ${input.candidate.url}`;
  const cited = [...new Set(input.candidate.evidenceArtifactIds ?? [])].filter((id) => input.known(id));
  const withRecord = cited.map((id) => input.provenance.get(id)).filter((p): p is ArtifactProvenance => p !== undefined);
  if (withRecord.length === 0) {
    return {
      ok: false,
      code: "SCOUT_PROVENANCE_UNDERIVABLE",
      detail: `${label} cites no artifact with a machine provenance record (cited ${cited.join(", ") || "nothing the vault holds"}); observedOn and permission cannot be derived, and a model's values are not a substitute`,
    };
  }
  const dates = withRecord.map((p) => utcDateOf(p.retrievedAt)).filter((d): d is string => d !== null);
  if (dates.length === 0) {
    return { ok: false, code: "SCOUT_PROVENANCE_UNDERIVABLE", detail: `${label}: no cited artifact carries a parseable retrievedAt` };
  }
  const observedOn = dates.reduce((a, b) => (a < b ? a : b));

  const disallowed = withRecord.filter((p) => p.permission === "DISALLOWED");
  if (disallowed.length > 0) {
    return {
      ok: false,
      code: "SCOUT_PROVENANCE_UNDERIVABLE",
      detail: `${label} cites ${disallowed.map((p) => p.artifactId).join(", ")}, retrieved under DISALLOWED; a disallowed retrieval cannot substantiate a route`,
    };
  }
  const pages = withRecord.filter((p) => p.methodRouteId !== ROBOTS_ROUTE_ID);
  if (pages.length === 0) {
    return {
      ok: false,
      code: "SCOUT_PROVENANCE_UNDERIVABLE",
      detail: `${label} cites only robots documents (${withRecord.map((p) => p.artifactId).join(", ")}); a permission instrument is not evidence of a route — cite the artifact the route answered as`,
    };
  }
  const host = hostOf(input.candidate.url);
  const atUrl = pages.filter((p) => p.canonicalUrl === input.candidate.url);
  const atHost = host === null ? [] : pages.filter((p) => hostOf(p.canonicalUrl) === host);
  const tier = atUrl.length > 0 ? atUrl : atHost.length > 0 ? atHost : pages;
  const tierName = atUrl.length > 0 ? "at the candidate URL" : atHost.length > 0 ? "on the candidate's host" : "cited";
  const verdicts = [...new Set(tier.map((p) => p.permission))];
  if (verdicts.length !== 1) {
    return {
      ok: false,
      code: "SCOUT_PROVENANCE_UNDERIVABLE",
      detail:
        `${label}: the artifacts ${tierName} disagree on permission — ` +
        tier.map((p) => `${p.artifactId} ${p.permission}`).join(", ") +
        "; cite the evidence for THIS route so one verdict follows",
    };
  }
  return {
    ok: true,
    value: {
      observedOn,
      permission: verdicts[0],
      recordClass: input.recordClass,
      evidenceArtifactIds: cited,
      provenance: {
        derivedFrom: withRecord.map((p) => p.artifactId),
        rule: `${PROVENANCE_RULE}; permission taken from the artifacts ${tierName}`,
      },
    },
  };
}

/** The model's provenance statements, exactly as supplied. Non-strings record as null. */
export function claimsOf(c: Partial<ScoutCandidate>): ScoutProvenanceClaims {
  const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
  return { observedOn: s(c.observedOn), permission: s(c.permission), recordClass: s(c.recordClass) };
}

/**
 * Validate what the model proposed against what the Attempt actually did.
 *
 * `rungs` are the executor's derived rungs. `vaulted` is every artifact id the
 * Attempt's tools vaulted; `inherited` every id the executor handed the model
 * as inherited evidence. A cited id outside both sets is a memory.
 *
 * When `machine` is supplied (the executor always supplies it), every
 * candidate's provenance claims are checked against the derivation and the
 * accepted candidates are returned REWRITTEN with machine-owned values in
 * `candidates`. Absent (older callers, unit tests of the other rules), the
 * provenance rules are not applied and `candidates` echoes the input.
 */
export function validateScoutFinish(input: {
  readonly finish: ScoutFinishInput;
  readonly rungs: readonly ScoutRung[];
  readonly toolCalls: number;
  readonly stoppedBy: ScoutStop;
  readonly vaulted: ReadonlySet<string>;
  readonly inherited: ReadonlySet<string>;
  readonly minRungs?: number;
  readonly machine?: {
    readonly provenance: ReadonlyMap<string, ArtifactProvenance>;
    readonly recordClass: string;
  };
}): ScoutIssue[] {
  return validateScoutFinishWithCandidates(input).issues;
}

export function validateScoutFinishWithCandidates(input: Parameters<typeof validateScoutFinish>[0]): {
  readonly issues: ScoutIssue[];
  /** The candidates with machine-owned provenance written in. Only meaningful when `issues` is empty. */
  readonly candidates: ScoutCandidate[];
} {
  const issues: ScoutIssue[] = [];
  const min = input.minRungs ?? MIN_DISTINCT_RUNGS;
  const f = input.finish;

  if (input.toolCalls === 0) {
    issues.push({
      code: "SCOUT_NO_TOOL_USED",
      detail:
        "the Scout called no research tool. A model that only wrote prose did not scout; nothing " +
        "it says is evidence about a government.",
    });
  }
  if (!SCOUT_OUTCOMES.includes(f.outcome as ScoutOutcome)) {
    issues.push({
      code: "SCOUT_OUTCOME_UNKNOWN",
      detail: `outcome ${JSON.stringify(f.outcome)} is not one of ${SCOUT_OUTCOMES.join(", ")}`,
    });
  }
  if (!Array.isArray(f.rungsWalked)) {
    issues.push({
      code: "SCOUT_RUNG_LIST_MISSING",
      detail: "the typed result omits the walked-rung list; a Scout must account for every rung it walked",
    });
  } else {
    const indices = new Set(input.rungs.map((r) => r.index));
    const covered = new Set(f.rungsWalked.map((r) => r.index));
    const missing = [...indices].filter((i) => !covered.has(i));
    if (input.rungs.length > 0 && missing.length > 0) {
      issues.push({
        code: "SCOUT_RUNG_LIST_MISSING",
        detail: `rung(s) ${missing.join(", ")} were walked and are not accounted for in rungsWalked`,
      });
    }
  }

  const known = (id: string): boolean => input.vaulted.has(id) || input.inherited.has(id);
  const rewritten: ScoutCandidate[] = [];
  for (const c of f.candidates ?? []) {
    const cited = c.evidenceArtifactIds ?? [];
    const unknown = cited.filter((id) => !known(id));
    if (cited.length === 0 || unknown.length > 0) {
      issues.push({
        code: "SCOUT_CANDIDATE_WITHOUT_EVIDENCE",
        detail:
          `candidate ${c.routeId ?? "(unnamed)"} at ${c.url ?? "(no url)"} cites ` +
          (cited.length === 0
            ? "NO artifact"
            : `artifact id(s) the Attempt never vaulted: ${unknown.join(", ")}`) +
          ". A URL invented from memory is not a route candidate.",
      });
      rewritten.push(c);
      continue;
    }
    if (input.machine === undefined) {
      rewritten.push(c);
      continue;
    }
    /* RULING 243: the machine derives; the model's values are claims. */
    const claims = claimsOf(c);
    const label = `candidate ${c.routeId ?? "(unnamed)"} at ${c.url ?? "(no url)"}`;
    const absent = (["observedOn", "permission", "recordClass"] as const).filter((k) => claims[k] === null);
    if (absent.length > 0) {
      issues.push({
        code: "SCOUT_PROVENANCE_ABSENT",
        detail: `${label} states no ${absent.join(", ")}; state each as the tool results showed it so the claim can be checked against the vault record`,
      });
    }
    const derived = deriveCandidateProvenance({
      candidate: { routeId: c.routeId, url: c.url, evidenceArtifactIds: cited },
      provenance: input.machine.provenance,
      known,
      recordClass: input.machine.recordClass,
    });
    if (!derived.ok) {
      issues.push({ code: derived.code, detail: derived.detail });
      rewritten.push(c);
      continue;
    }
    const m = derived.value;
    const disagreements: string[] = [];
    if (claims.observedOn !== null) {
      const claimedDate = utcDateOf(claims.observedOn) ?? claims.observedOn.slice(0, 10);
      const citedDates = new Set(
        m.provenance.derivedFrom.map((id) => utcDateOf(input.machine?.provenance.get(id)?.retrievedAt)).filter((d) => d !== null),
      );
      if (claimedDate !== m.observedOn && !citedDates.has(claimedDate)) {
        disagreements.push(`observedOn: the model says ${claims.observedOn}; the cited artifacts were retrieved on ${[...citedDates].join(", ")} (machine value ${m.observedOn})`);
      }
    }
    if (claims.permission !== null && claims.permission !== m.permission) {
      disagreements.push(`permission: the model says ${claims.permission}; the cited evidence was retrieved under ${m.permission}`);
    }
    if (claims.recordClass !== null && claims.recordClass !== m.recordClass) {
      disagreements.push(`recordClass: the model says ${claims.recordClass}; the obligation's record class is ${m.recordClass}`);
    }
    if (disagreements.length > 0) {
      issues.push({
        code: "SCOUT_PROVENANCE_DISAGREES",
        detail: `${label} — ${disagreements.join("; ")}. Provenance is written from the record; restate the claim as the tool results showed it`,
      });
    }
    rewritten.push({
      ...c,
      observedOn: m.observedOn,
      permission: m.permission,
      recordClass: m.recordClass,
      evidenceArtifactIds: m.evidenceArtifactIds,
      claims,
      provenance: m.provenance,
    });
  }
  for (const finding of f.findings ?? []) {
    const cited = finding.artifactIds ?? [];
    const unknown = cited.filter((id) => !known(id));
    if (cited.length === 0 || unknown.length > 0) {
      issues.push({
        code: "SCOUT_FINDING_WITHOUT_EVIDENCE",
        detail:
          `finding "${(finding.summary ?? "").slice(0, 80)}" cites ` +
          (cited.length === 0 ? "NO artifact" : `unknown artifact id(s): ${unknown.join(", ")}`),
      });
    }
  }

  const outcome = f.outcome as ScoutOutcome;
  if (outcome === "ROUTE_CANDIDATE" && (f.candidates ?? []).length === 0) {
    issues.push({
      code: "SCOUT_CANDIDATE_OUTCOME_WITHOUT_CANDIDATE",
      detail: "ROUTE_CANDIDATE with no candidate is a label over nothing",
    });
  }
  if (outcome === "EVIDENCE_FOUND" && (f.findings ?? []).length === 0) {
    issues.push({
      code: "SCOUT_EVIDENCE_OUTCOME_WITHOUT_FINDING",
      detail: "EVIDENCE_FOUND with no finding is a label over nothing",
    });
  }

  if (LADDER_OWED_OUTCOMES.includes(outcome)) {
    const distinct = distinctEvidenceRungs(input.rungs);
    if (input.stoppedBy === "MODEL" && distinct < min) {
      issues.push({
        code: "SCOUT_EARLY_ABSENCE",
        detail:
          `${outcome} after ${distinct} distinct evidence-backed rung(s); the declared minimum is ` +
          `${min}. Absence is argued, never asserted — walk the ladder or state what remains.`,
      });
    }
    if (input.stoppedBy === "BOUND" && (f.nextRungs ?? []).length === 0) {
      issues.push({
        code: "SCOUT_BOUND_WITHOUT_NEXT_RUNGS",
        detail:
          "the Attempt's bound ended the walk and the result names no next rungs, so the next " +
          "Attempt would restart rather than resume",
      });
    }
  }
  return { issues, candidates: rewritten };
}

/* --------------------------------------------------- prior-rung classes */

/**
 * Whether a prior rung's failure is DURABLE (a wall, a disallow, a not-found,
 * a permission the tools will not open) or TRANSIENT (their side broke, the
 * transport timed out). RULING 244 forbids re-walking a rung recorded FAILED;
 * RULING 53 says absences expire and a transport failure is a fact about a
 * moment. So a durable failure is refused for `REWALK_REFUSAL_DAYS`, and a
 * transient one is not refused at all. Classified from the machine-written
 * `observed` line, which is the only record older results carry.
 */
export const REWALK_REFUSAL_DAYS = 30;

export type PriorFailureClass = "DURABLE" | "TRANSIENT" | "NOT_A_FAILURE";

export function classifyPriorRung(rung: { readonly observed: string; readonly ok?: boolean | null }): PriorFailureClass {
  const o = rung.observed;
  if (rung.ok === true) return "NOT_A_FAILURE";
  if (/transport failure|browser failure|timed out|timeout|aborted|HTTP 5\d\d|empty render/i.test(o)) return "TRANSIENT";
  if (/\(wall\)|HTTP 4\d\d|permission (DISALLOWED|CANNOT_TELL)|NOT VAULTED|0 bytes/i.test(o)) return "DURABLE";
  if (rung.ok === false) return "TRANSIENT";
  return "NOT_A_FAILURE";
}
