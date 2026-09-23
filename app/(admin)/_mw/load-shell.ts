/**
 * **WHAT THE ONE SCOPE FILTER OFFERS, AND WHAT THE STRIP CALLS IT.** (Admin
 * redesign, 2026-09-23.)
 *
 * The header's scope select lists, in this order:
 *
 * ```
 *   Everywhere · N states         every state with registered coverage
 *   each registered state
 *   Your geographies              the Census geographies the owner selected
 *                                 (the policy row), each under its state
 *   Nothing registered            every other state and territory — one line
 *                                 each, so a scope with nothing in it can be
 *                                 chosen and answers in sentences, never zeros
 * ```
 *
 * Registered means the product carries coverage there today
 * (`COVERED_STATES`); it is not a claim about how complete that coverage is.
 * PURE apart from the types it reads.
 */
import { COVERED_STATES } from "@/lib/coverage/states.ts";
import type { ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import type { ScopeOptionGroup } from "./header-controls.tsx";
import { GEO_TYPE_WORDS, scopeParam, type MwGeoType, type MwScope } from "./scope.ts";

export const REGISTERED_STATE_CODES: readonly string[] = COVERED_STATES.map((s) => s.slug);

export function isRegisteredState(code: string): boolean {
  return REGISTERED_STATE_CODES.includes(code.toLowerCase());
}

export function stateName(code: string): string {
  return US_STATES.find((s) => s.code === code.toLowerCase())?.name ?? code.toUpperCase();
}

function isGeoType(value: string): value is MwGeoType {
  return value in GEO_TYPE_WORDS;
}

/** The scope a selected geography is, in the filter's own terms. */
export function scopeOfDecision(d: ExpansionScopeDecision): MwScope | null {
  const type = d.geography.type;
  if (!isGeoType(type)) return null;
  return { kind: "geo", type, geoid: d.geography.geoid, state: d.geography.stateAbbr.toLowerCase() };
}

export interface ShellScope {
  readonly scope: MwScope;
  readonly label: string;
  readonly groups: readonly ScopeOptionGroup[];
  /** False when the scope sits in a state with no registered coverage. */
  readonly registered: boolean;
  /** The selected geography this scope names, when it is one. */
  readonly decision: ExpansionScopeDecision | null;
}

export function shellScope(scope: MwScope, selected: readonly ExpansionScopeDecision[], lookedUpLabel: string | null = null): ShellScope {
  const registeredStates = US_STATES.filter((s) => isRegisteredState(s.code));
  const others = US_STATES.filter((s) => !isRegisteredState(s.code));

  const groups: ScopeOptionGroup[] = [
    { label: null, options: [{ value: "all", label: `Everywhere · ${registeredStates.length} states` }] },
    { label: "Registered states", options: registeredStates.map((s) => ({ value: s.code, label: s.name })) },
  ];
  const geoOptions = selected
    .map((d) => ({ d, sc: scopeOfDecision(d) }))
    .filter((x): x is { d: ExpansionScopeDecision; sc: MwScope } => x.sc !== null)
    .map(({ d, sc }) => ({ value: scopeParam(sc) ?? "all", label: `${stateName(d.geography.stateAbbr)} · ${d.geography.label}` }));
  if (geoOptions.length > 0) groups.push({ label: "Your geographies", options: geoOptions });
  groups.push({ label: "Nothing registered", options: others.map((s) => ({ value: s.code, label: `${s.name} — nothing registered` })) });

  let label: string;
  let registered = true;
  let decision: ExpansionScopeDecision | null = null;
  if (scope.kind === "all") {
    label = `Everywhere · ${registeredStates.length} states`;
  } else if (scope.kind === "state") {
    registered = isRegisteredState(scope.state);
    label = registered ? stateName(scope.state) : `${stateName(scope.state)} — nothing registered`;
  } else {
    registered = isRegisteredState(scope.state);
    decision =
      selected.find((d) => d.geography.geoid === scope.geoid && d.geography.type === scope.type && d.geography.stateAbbr.toLowerCase() === scope.state) ?? null;
    label = `${stateName(scope.state)} · ${decision ? decision.geography.label : lookedUpLabel !== null ? lookedUpLabel : `${GEO_TYPE_WORDS[scope.type]} ${scope.geoid}`}`;
    // A geography reached by link that is not on the selected list still gets
    // its own option, so the select never shows a value it does not offer.
    if (!geoOptions.some((o) => o.value === scopeParam(scope))) {
      groups.splice(2, 0, { label: "This page", options: [{ value: scopeParam(scope) ?? "all", label }] });
    }
  }
  return { scope, label, groups, registered, decision };
}
