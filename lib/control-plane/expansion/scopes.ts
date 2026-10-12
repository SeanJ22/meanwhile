/**
 * The owner's expansion scopes: one geography from the Census geography lookup
 * (county, congressional district, metro/micro area, state legislative
 * district, or state) with two owner decisions:
 *
 * ```
 *   priority   an integer order among the selected scopes; 1 runs first
 *   budgetUsd  a rolling-24-hour cap on paid model work (Scouts) for work in
 *              that scope; 0 is allowed and means "no paid work there"
 * ```
 *
 * A scope reorders, restricts and (through the runner, `dispatch-work.ts`)
 * materializes missing requirement instances. Its budget only refuses paid
 * work; the Fleet's rolling ceiling stays the global cap.
 *
 * Stored on `AdminConfig.expansionScopes`, written only by
 * `expansion.scope.set` / `expansion.scope.remove`.
 *
 * Pure. No store, no clock, no environment.
 */

import { isWorkQuestion, type WorkQuestion } from "../work-question.ts";

/** The five primary groupings the owner may select, in the lookup's own vocabulary. */
export const EXPANSION_SCOPE_TYPES = [
  "zcta",
  "state",
  "county",
  "congressional_district",
  "cbsa",
  "state_leg_upper",
  "state_leg_lower",
] as const;
export type ExpansionScopeType = (typeof EXPANSION_SCOPE_TYPES)[number];

/** The version-key prefix each type's plan carries (`"cd:119"`, `"county:2020"`, …). */
export const VERSION_PREFIX: Readonly<Record<ExpansionScopeType, string>> = {
  zcta: "zcta",
  state: "state",
  county: "county",
  congressional_district: "cd",
  cbsa: "cbsa",
  state_leg_upper: "sldu",
  state_leg_lower: "sldl",
};

/** The words a type renders as. */
export const SCOPE_TYPE_WORDS: Readonly<Record<ExpansionScopeType, string>> = {
  zcta: "ZIP (Census ZCTA)",
  state: "State",
  county: "County",
  congressional_district: "Congressional district",
  cbsa: "Metro or micro area",
  state_leg_upper: "State senate district",
  state_leg_lower: "State house district",
};



export const SCOPE_PRIORITY_MAX = 999;
export const SCOPE_LABEL_MAX_CHARS = 160;
export const SCOPE_NOTE_MAX_CHARS = 500;
/** A typo guard, not a spend permission: the same ceiling the Fleet dial accepts. */
export const SCOPE_BUDGET_MAX_USD = 10_000;

/** The geography a scope names: the lookup's stable address plus what the owner saw. */
export interface ExpansionScopeGeography {
  readonly type: ExpansionScopeType;
  /** The Census GEOID, leading zeros kept. */
  readonly geoid: string;
  /** The plan/delineation version key, e.g. `"county:2020"`. */
  readonly version: string;
  /** The label the lookup gave it, as the owner saw it when choosing. */
  readonly label: string;
  /** The state the lookup files it under (two letters). */
  readonly stateAbbr: string;
}

/** One selected scope, as the owner decided it. */
export interface ExpansionScopeDecision {
  /** `<version>/<geoid>` — stable, and unique per geography version. */
  readonly key: string;
  readonly geography: ExpansionScopeGeography;
  /** 1 runs first. Ties go to the scope decided earlier. */
  readonly priority: number;
  /** Rolling-24-hour cap on paid model work in this scope, in USD. May be 0. */
  readonly budgetUsd: number;
  /** Absent on legacy rolling budgets. Immutable start of a lifetime Anthropic budget. */
  readonly budgetStartedAt?: string;
  /** Send implementation version: old saved scopes do not silently launch newly connected acquisition. */
  readonly sourceWorkVersion?: 1;
  readonly note: string | null;
  /** The questions the owner asked of this Send, recorded on every obligation it reaches. Absent when none was asked. */
  readonly questions?: readonly WorkQuestion[];
  readonly decidedAt: string;
  /** The admin session reference that decided it. Never a person's name. */
  readonly decidedBy: string;
  /** Instruction receipt; immutable for a continued lifetime hunt. */
  readonly receiptId: string;
  /** Latest policy edit receipt, distinct from the continuing hunt's instruction. */
  readonly latestDecisionReceiptId?: string;
  /** What stood for this key the instant before, or null for a new selection. */
  readonly previous: { readonly priority: number; readonly budgetUsd: number } | null;
}

/** The stable key a geography is stored and addressed under. */
export function scopeKeyOf(geography: Pick<ExpansionScopeGeography, "version" | "geoid">): string {
  return `${geography.version}/${geography.geoid}`;
}

const collapse = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export type ScopeValidation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

/** A plain type check, so a stored row and a submitted form are held to one rule. */
export function isExpansionScopeType(value: unknown): value is ExpansionScopeType {
  return typeof value === "string" && (EXPANSION_SCOPE_TYPES as readonly string[]).includes(value);
}

/**
 * Check the geography half of a submission. Pure: it cannot ask the lookup
 * whether the geography exists, so the runner resolves it against the
 * published lookup every cycle and says so by name when it cannot.
 */
export function validateScopeGeography(input: Readonly<Record<string, unknown>>): ScopeValidation<ExpansionScopeGeography> {
  const type = collapse(input.type);
  if (!isExpansionScopeType(type)) {
    return { ok: false, why: "choose a state, county, congressional district, metro area or state legislative district" };
  }
  const geoid = collapse(input.geoid);
  if (type === "zcta" && !/^\d{5}$/.test(geoid)) return { ok: false, why: "Enter a five-digit ZIP with published Census ZCTA coverage." };
  if (!/^[0-9A-Za-z]{2,12}$/.test(geoid)) return { ok: false, why: "the geography's Census code is missing or malformed" };
  const version = collapse(input.version);
  const prefix = VERSION_PREFIX[type];
  if (!new RegExp(`^${prefix}:[0-9]{2,4}$`).test(version)) {
    return { ok: false, why: `the geography's plan version is missing or is not a ${SCOPE_TYPE_WORDS[type].toLowerCase()} plan` };
  }
  const label = collapse(input.label);
  if (label === "") return { ok: false, why: "the geography has no name" };
  if (label.length > SCOPE_LABEL_MAX_CHARS) return { ok: false, why: `the geography's name is longer than ${SCOPE_LABEL_MAX_CHARS} characters` };
  const stateAbbr = collapse(input.stateAbbr).toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateAbbr)) return { ok: false, why: "the geography's state is missing" };
  return { ok: true, value: { type, geoid, version, label, stateAbbr } };
}

/** An integer order, 1 first. A form sends strings; a chat tool may send numbers. */
export function validateScopePriority(raw: unknown): ScopeValidation<number> {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > SCOPE_PRIORITY_MAX) {
    return { ok: false, why: `say the priority as a whole number from 1 (first) to ${SCOPE_PRIORITY_MAX}` };
  }
  return { ok: true, value: parsed };
}

/** A dollar amount, 0 allowed, whole cents. */
export function validateScopeBudget(raw: unknown): ScopeValidation<number> {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(parsed)) return { ok: false, why: "say the budget as a dollar amount — $0 is allowed and means no paid work there" };
  if (parsed < 0) return { ok: false, why: "a budget cannot be below $0" };
  if (parsed > SCOPE_BUDGET_MAX_USD) return { ok: false, why: `that budget is above the $${SCOPE_BUDGET_MAX_USD} maximum this control allows` };
  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

export function validateScopeNote(raw: unknown): ScopeValidation<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, why: "the note has to be words" };
  const note = raw.replace(/\r\n/g, "\n").trim();
  if (note.length > SCOPE_NOTE_MAX_CHARS) return { ok: false, why: `the note is longer than ${SCOPE_NOTE_MAX_CHARS} characters` };
  return { ok: true, value: note === "" ? null : note };
}

/** A stored entry that is not a scope decision reads as malformed, never as "no restriction". */
export function isExpansionScopeDecision(value: unknown): value is ExpansionScopeDecision {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<ExpansionScopeDecision>;
  const g = v.geography as Partial<ExpansionScopeGeography> | undefined;
  return (
    typeof v.key === "string" &&
    g !== undefined &&
    g !== null &&
    isExpansionScopeType(g.type) &&
    typeof g.geoid === "string" &&
    typeof g.version === "string" &&
    typeof g.label === "string" &&
    typeof g.stateAbbr === "string" &&
    v.key === scopeKeyOf({ version: g.version, geoid: g.geoid }) &&
    typeof v.priority === "number" &&
    Number.isInteger(v.priority) &&
    v.priority >= 1 &&
    typeof v.budgetUsd === "number" &&
    Number.isFinite(v.budgetUsd) &&
    v.budgetUsd >= 0 &&
    (v.budgetStartedAt === undefined || (typeof v.budgetStartedAt === "string" && Number.isFinite(Date.parse(v.budgetStartedAt)))) &&
    (v.sourceWorkVersion === undefined || v.sourceWorkVersion === 1) &&
    typeof v.decidedAt === "string" &&
    typeof v.decidedBy === "string" &&
    typeof v.receiptId === "string" &&
    (v.latestDecisionReceiptId === undefined || typeof v.latestDecisionReceiptId === "string") &&
    /* A question list that is not six-question vocabulary is a malformed decision, never "no questions". */
    (v.questions === undefined || (Array.isArray(v.questions) && v.questions.every(isWorkQuestion)))
  );
}

/**
 * The scopes a stored policy carries, in run order, and how many entries could
 * not be read. The runner refuses paid work while any entry is unreadable.
 */
export function expansionScopesOf(config: { readonly expansionScopes?: unknown } | null): {
  readonly scopes: readonly ExpansionScopeDecision[];
  readonly malformed: number;
} {
  const raw = config?.expansionScopes;
  if (raw === undefined || raw === null) return { scopes: [], malformed: 0 };
  if (!Array.isArray(raw)) return { scopes: [], malformed: 1 };
  const scopes: ExpansionScopeDecision[] = [];
  let malformed = 0;
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isExpansionScopeDecision(entry) || seen.has(entry.key)) {
      malformed += 1;
      continue;
    }
    seen.add(entry.key);
    scopes.push(entry);
  }
  return { scopes: orderScopes(scopes), malformed };
}

/** Run order: priority ascending (1 first), then the scope decided earlier, then the key. */
export function orderScopes<T extends Pick<ExpansionScopeDecision, "priority" | "decidedAt" | "key">>(scopes: readonly T[]): T[] {
  return [...scopes].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * The next scope list after the owner sets one scope (a new selection, or a
 * change of priority/budget/note on one already selected). Pure: the caller
 * reads, this computes, the caller compare-and-sets.
 */
export function withScopeSet(
  current: readonly ExpansionScopeDecision[],
  change: {
    readonly geography: ExpansionScopeGeography;
    readonly priority: number;
    readonly budgetUsd: number;
    readonly huntBudget?: boolean;
    /** An explicit new hunt gets a separate accounting period; edits never reset it. */
    readonly newHunt?: boolean;
    readonly note: string | null;
    /** Absent or empty: the Send asked no question. */
    readonly questions?: readonly WorkQuestion[];
    readonly decidedAt: string;
    readonly decidedBy: string;
    readonly receiptId: string;
  },
): { readonly scopes: readonly ExpansionScopeDecision[]; readonly previous: ExpansionScopeDecision | null } {
  const key = scopeKeyOf(change.geography);
  const previous = current.find((s) => s.key === key) ?? null;
  const next: ExpansionScopeDecision = {
    key,
    geography: change.geography,
    priority: change.priority,
    budgetUsd: change.budgetUsd,
    ...((previous?.budgetStartedAt || change.huntBudget) ? { budgetStartedAt: change.newHunt ? change.decidedAt : previous?.budgetStartedAt ?? change.decidedAt } : {}),
    note: change.note,
    ...(change.questions !== undefined && change.questions.length > 0 ? { questions: [...change.questions] } : {}),
    decidedAt: change.decidedAt,
    decidedBy: change.decidedBy,
    sourceWorkVersion: 1,
    receiptId: previous?.budgetStartedAt && !change.newHunt ? previous.receiptId : change.receiptId,
    latestDecisionReceiptId: change.receiptId,
    previous: previous === null ? null : { priority: previous.priority, budgetUsd: previous.budgetUsd },
  };
  return { scopes: orderScopes([...current.filter((s) => s.key !== key), next]), previous };
}

/** The next scope list after the owner removes one. Removing an absent key is a no-op the caller reports. */
export function withScopeRemoved(
  current: readonly ExpansionScopeDecision[],
  key: string,
): { readonly scopes: readonly ExpansionScopeDecision[]; readonly removed: ExpansionScopeDecision | null } {
  const removed = current.find((s) => s.key === key) ?? null;
  return { scopes: current.filter((s) => s.key !== key), removed };
}

/** A key as the remove action accepts it: `<version>/<geoid>`, nothing else. */
export function validateScopeKey(raw: unknown): ScopeValidation<string> {
  const key = collapse(raw);
  if (!/^(zcta|state|county|cd|cbsa|sldu|sldl):[0-9]{2,4}\/[0-9A-Za-z]{2,12}$/.test(key)) {
    return { ok: false, why: "say which selected geography to remove" };
  }
  return { ok: true, value: key };
}
