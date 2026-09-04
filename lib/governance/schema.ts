/**
 * The canonical governance schema — the type system that replaces
 * chronological archaeology with structured authority.
 *
 * ## Why this file exists
 *
 * `CLAUDE.md` and `docs/rulings.md` grew into two hand-maintained authorities
 * holding current law, superseded law, decisions, rationale, measurements,
 * approvals and implementation history in one undifferentiated stream. A
 * session answering "what is true now?" had to reason through chronology and
 * supersession, and the same current rule was written down twice — once in each
 * file — by hand, in the same session, with nothing checking that the two
 * copies agreed. That dual write is what let `CLAUDE.md` carry RULING 169 and
 * RULING 170 while `docs/rulings.md` stopped at 168.
 *
 * That mismatch is RESOLVED at this HEAD — both files carry 169, 170 and 171,
 * measured rather than assumed. The guard is built anyway, because the mismatch
 * was never the defect. The ARCHITECTURE that permitted it was, and it is still
 * standing until this file replaces it.
 *
 * ## What is a record here
 *
 * Not every durable decision is a "ruling". A measurement recorded on a date is
 * not constitutional merely because somebody numbered it. So the ledger is
 * TYPED, and only two of the eight kinds can create binding law.
 */

/** Canonical normalized id. Immutable once adopted. */
export type DecisionId = string & { readonly __brand?: "DecisionId" };

/**
 * The record kinds.
 *
 * `LAW_DECISION` and `DECISION` bind. The other six do not, and the difference
 * is the whole point: a `FACT` emitted as a current normative instruction is a
 * measurement wearing law's clothes, which is how "the Census key is invalid on
 * 2026-08-22" becomes a standing rule about the Census key.
 */
export const RECORD_KINDS = [
  /** Promoted into the constitution or a domain policy. Binds every session. */
  "LAW_DECISION",
  /** An active author decision that has not become law. Binds, does not legislate. */
  "DECISION",
  /** A session's reading of an existing rule. Never binding on its own. */
  "INTERPRETATION",
  /** The author accepting a specific piece of work. Not a general rule. */
  "ACCEPTANCE",
  /** The author confirming a session's prior interpretation was correct. */
  "RATIFICATION",
  /** A measurement or observation, true on its date. Never an instruction. */
  "FACT",
  /** A retired id. Preserved so the number can never be reused. */
  "TOMBSTONE",
  /** Recorded, but its type or authority could not be established. */
  "PENDING_INTERPRETATION",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** The kinds that may create binding law or decision state. */
export const BINDING_KINDS: readonly RecordKind[] = ["LAW_DECISION", "DECISION"];

/**
 * Authority provenance.
 *
 * **An LLM may not upgrade its own confident prose into "Sean ruled this."**
 * Only `author_explicit` and `author_confirmed` may sit on a binding record;
 * the validator enforces it, because the distinction is invisible in prose and
 * a session writing a rule it invented reads exactly like a session recording
 * one it was given.
 */
export const PROVENANCE_KINDS = [
  "author_explicit",
  "author_confirmed",
  "session_interpretation",
  "observed_fact",
] as const;
export type Provenance = (typeof PROVENANCE_KINDS)[number];

export const AUTHORITATIVE_PROVENANCE: readonly Provenance[] = [
  "author_explicit",
  "author_confirmed",
];

/** Lifecycle status. */
export const STATUSES = [
  "ACTIVE",
  "SUPERSEDED",
  "AMENDED",
  "HISTORICAL",
  "RETIRED",
] as const;
export type Status = (typeof STATUSES)[number];

/**
 * The status values that may appear in compiled CURRENT authority.
 *
 * `AMENDED` is current: a rule whose clause was narrowed by a later ruling is
 * still in force in everything the later ruling did not touch. Folding it into
 * `SUPERSEDED` is exactly the boolean this architecture exists to refuse.
 */
export const CURRENT_STATUSES: readonly Status[] = ["ACTIVE", "AMENDED"];

/**
 * Domains. These map one-to-one onto `docs/governance/policies/*.md` and onto
 * the `--task` argument of `pnpm governance:open`.
 */
export const DOMAINS = [
  "discovery",
  "rendering-neutrality",
  "data-privacy",
  "sources-licensing",
  "shipping-ci",
  "tracker-workflow",
  "visual-feedback",
  "business",
  "meta-governance",
] as const;
export type Domain = (typeof DOMAINS)[number];

/**
 * Relations, as structured data.
 *
 * **Partial supersession must name what changed and what survives.** Reducing a
 * clause-level amendment to a boolean `superseded` is how RULING 78's cadence
 * clause got replaced while its CI-duplication clause stayed law, with nothing
 * in either file able to say which half a session was reading.
 */
export const RELATION_KINDS = [
  "supersedes_full",
  "supersedes_clause",
  "amends",
  "extends",
  "clarifies",
  "implements",
  "ratifies",
  "derived_from",
  "related_to",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** The relations that require scope prose naming what changed and what survives. */
export const SCOPED_RELATIONS: readonly RelationKind[] = ["supersedes_clause", "amends"];

/** The relations that retire the target's operative force in full. */
export const FULL_SUPERSESSION: readonly RelationKind[] = ["supersedes_full"];

export interface Relation {
  kind: RelationKind;
  target: DecisionId;
  /** Required on SCOPED_RELATIONS: what changed. */
  changed?: string;
  /** Required on SCOPED_RELATIONS: what survives, in force. */
  survives?: string;
}

/**
 * A semantic key is a NAMED RULE SLOT that may hold exactly one active value.
 *
 * This is the instrument that catches a contradiction text search cannot. Two
 * paragraphs saying "verify against production" and "verify against a local
 * production build" share no string, contradict absolutely, and both read as
 * law. Declaring `verification.target` makes the collision a failing test
 * rather than something a session has to notice.
 */
export interface SemanticClaim {
  key: string;
  value: string;
}

export interface GovernanceRecord {
  id: DecisionId;
  /** Legacy strings that must keep resolving, e.g. "RULING 26". */
  aliases: string[];
  kind: RecordKind;
  status: Status;
  provenance: Provenance;
  domain: Domain;
  title: string;
  /** ISO date. Required on everything that is not a TOMBSTONE. */
  adopted: string | null;
  /** The original narrative, preserved verbatim. Never paraphrased. */
  body: string;
  /**
   * The OTHER hand-written copy of this rule, where one existed.
   *
   * **This field is the dual write's actual cost, measured.** `CLAUDE.md` and
   * `docs/rulings.md` each held a copy of 90 rulings, written by hand in the
   * same session, with nothing checking that the two agreed. **87 of the 90
   * diverged**: 697 substantial sentences existed only in the constitution and
   * 699 only in the rulings document. Neither file was ever a complete record
   * of any of them.
   *
   * So the migration keeps BOTH. `body` is the fuller copy; this holds the
   * other, verbatim. **Merging them automatically would be composition** — an
   * importer writing prose neither author wrote — and picking one would delete
   * several hundred sentences of the author's own reasoning, which is the
   * failure that made the mismatch worth fixing in the first place.
   */
  variants: Array<{ source: string; body: string }>;
  relations: Relation[];
  /** Required on ACTIVE LAW_DECISION: where the operative current text lives. */
  operativePolicy: string | null;
  /**
   * The stable rule slot this record is the current holder of (RULING 247).
   *
   * **One independently amendable rule, one key, exactly one CURRENT holder.**
   * This is the STRUCTURAL half of "law is written once": the validator refuses
   * a second active LAW_DECISION on the same key, so the consolidation's central
   * promise — a principle is not re-issued as a new ruling every time an
   * incident illustrates it — is a failing build rather than a discipline. A
   * later holder that legitimately takes the slot over carries an explicit
   * supersession or amendment relation to the prior holder; an incident that
   * merely illustrates an existing rule is a non-law history note linked to this
   * key, never a new active law record. Required on ACTIVE LAW_DECISION.
   *
   * It is deliberately NOT the record id: an id is immutable and dies with the
   * ruling, while a ruleKey survives supersession so "who states this rule now?"
   * has one answer across the whole amendment chain. Keyed uniqueness is the
   * guarantee; a paraphrase that shares no key and no text still needs a human
   * read, and that is out of scope by design.
   */
  ruleKey?: string | null;
  /** Semantic rule slots this record sets. */
  claims: SemanticClaim[];
  /** Set where import could not establish kind, provenance or relations. */
  uncertain: string[];
  /**
   * Routing notes — which policy file this record files under, and how sure the
   * router was. Deliberately SEPARATE from `uncertain`: filing is metadata and
   * never authority, and conflating the two downgraded 74 real rulings to
   * PENDING_INTERPRETATION on the first import run.
   */
  routingNotes: string[];
  /** Where this record was imported from. */
  sourceRef: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The declaration prefix that turns a null adopted date from a MISSING date
 * into an honest UNKNOWN. See `validateRecord`.
 */
export const UNSTAMPED_NOTE = "source carried no adoption stamp";

/** Normalize a legacy label to a canonical id. `RULING 26` -> `R-0026`. */
export function canonicalId(n: number): DecisionId {
  return `R-${String(n).padStart(4, "0")}`;
}

export function parseLegacyAlias(alias: string): DecisionId | null {
  const m = /^RULING\s+(\d+)$/i.exec(alias.trim());
  return m ? canonicalId(Number(m[1])) : null;
}

export interface ValidationIssue {
  id: string;
  rule: string;
  detail: string;
}

/**
 * Structural validation of ONE record. Cross-record checks (alias collisions,
 * dangling relations, supersession cycles, duplicate active claims) live in the
 * validator, because they cannot be answered from a single record.
 */
export function validateRecord(r: GovernanceRecord): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (rule: string, detail: string) => out.push({ id: r.id, rule, detail });

  // Three id namespaces, kept apart on purpose.
  //
  //   `R-0026`     the numeric space — adopted rulings ONLY, immutable forever.
  //   `R-X-<slug>` the un-numbered entries of `docs/rulings.md`: acceptances,
  //                recorded measurements, reserved-and-unassigned entries.
  //   `R-C-<slug>` the constitution's own un-numbered law: the transparency
  //                mandate, the ladder, the photo doors, the Kelly standard.
  //
  // Three origins, three namespaces, no collision possible. None of the last
  // two were ever rulings, and minting ruling numbers for them would spend a
  // hundred immutable ids on records that never had one — which is exactly the
  // collision the amendment procedure exists to refuse.
  if (!/^R-(\d{4,}|[XC]-[a-z0-9-]+)$/.test(r.id)) bad("id-format", `not a canonical id: ${r.id}`);
  if (!RECORD_KINDS.includes(r.kind)) bad("kind", `unknown kind: ${r.kind}`);
  if (!STATUSES.includes(r.status)) bad("status", `unknown status: ${r.status}`);
  if (!PROVENANCE_KINDS.includes(r.provenance)) bad("provenance", `unknown: ${r.provenance}`);
  if (!DOMAINS.includes(r.domain)) bad("domain", `unknown domain: ${r.domain}`);

  // Binding authority requires author provenance. A session may not legislate.
  if (BINDING_KINDS.includes(r.kind) && !AUTHORITATIVE_PROVENANCE.includes(r.provenance)) {
    bad("binding-provenance", `${r.kind} requires author provenance, has ${r.provenance}`);
  }

  // An adopted date is required, with one declared exception. RULING 107 says
  // that where no read is evidenced the answer is UNKNOWN and reads as stale —
  // never a plausible date filled in to satisfy a field. A source that carried
  // no stamp is exactly that case, and the record must SAY SO: a null date with
  // no declaration is a missing date, and a null date with one is an honest
  // UNKNOWN. Declaring costs a diff, which is the point.
  const declaresUnstamped = r.routingNotes.some((n) => n.startsWith(UNSTAMPED_NOTE));
  if (r.kind !== "TOMBSTONE" && (!r.adopted || !ISO_DATE.test(r.adopted))) {
    if (!(r.adopted === null && declaresUnstamped)) {
      bad("adopted-date", `missing or malformed adopted date: ${r.adopted}`);
    }
  }

  // A TOMBSTONE is a retired id and may carry nothing that reads as current.
  if (r.kind === "TOMBSTONE") {
    if (r.claims.length > 0) bad("tombstone-claims", "a tombstone may not set a semantic claim");
    if (CURRENT_STATUSES.includes(r.status)) {
      bad("tombstone-status", `a tombstone may not be ${r.status}`);
    }
  }

  // A FACT is a measurement. It may never be emitted as a current instruction,
  // which is what setting a semantic rule slot would make it.
  if (r.kind === "FACT" && r.claims.length > 0) {
    bad("fact-as-instruction", "a FACT may not set a semantic claim");
  }

  // Promoted law must say where its operative text lives, or the constitution
  // is claiming a rule with no current home.
  if (r.kind === "LAW_DECISION" && CURRENT_STATUSES.includes(r.status) && !r.operativePolicy) {
    bad("law-without-policy", "active LAW_DECISION has no operativePolicy pointer");
  }

  // Current law must name the stable rule slot it holds (RULING 247). A new
  // active law record with no key cannot be checked for "one rule, one holder",
  // so it is refused — the structural half of "law is written once".
  if (r.kind === "LAW_DECISION" && CURRENT_STATUSES.includes(r.status)) {
    if (!r.ruleKey || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(r.ruleKey)) {
      bad("law-without-rulekey", `active LAW_DECISION has no valid ruleKey: ${r.ruleKey ?? "(none)"}`);
    }
  }
  // A ruleKey is only meaningful on current law. A non-current record may carry
  // one to LINK an incident/history note to the rule it illustrates, but a
  // record that is neither current nor related to the keyed rule may not.
  if (r.ruleKey && r.kind !== "LAW_DECISION" && CURRENT_STATUSES.includes(r.status)) {
    bad("rulekey-on-nonlaw", `a ${r.kind} may not hold a ruleKey as current authority: ${r.ruleKey}`);
  }

  for (const rel of r.relations) {
    if (!RELATION_KINDS.includes(rel.kind)) bad("relation-kind", `unknown: ${rel.kind}`);
    if (rel.target === r.id) bad("self-relation", `${rel.kind} targets itself`);
    if (SCOPED_RELATIONS.includes(rel.kind) && (!rel.changed || !rel.survives)) {
      bad("unscoped-partial", `${rel.kind} -> ${rel.target} must name what changed AND what survives`);
    }
  }

  // Uncertainty is a legal state and is recorded rather than guessed. It is
  // only illegal on a record claiming to bind.
  if (r.uncertain.length > 0 && BINDING_KINDS.includes(r.kind)) {
    bad("uncertain-binding", `binding record carries uncertainty: ${r.uncertain.join("; ")}`);
  }

  return out;
}
