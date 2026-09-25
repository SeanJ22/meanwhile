/**
 * **WHAT THE ONE SCOPE FILTER OFFERS, AND WHAT THE STRIP CALLS IT.** (Admin
 * redesign, 2026-09-23; registration standing, 2026-09-25.)
 *
 * The header's scope select lists, in this order:
 *
 * ```
 *   Everywhere · N tracked states   every state tracked with figures
 *   Tracked states                  each tracked state
 *   Your geographies                the Census geographies the owner selected
 *                                   (the policy row), each under its state
 *   Registered, no figures yet      every state whose REGISTRATION pointer is
 *                                   promoted: its Census governments are on
 *                                   file, and nothing of ours is measured there
 *   Nothing registered              every state and territory with no promoted
 *                                   registration — one line each, so a scope
 *                                   with nothing in it can be chosen and
 *                                   answers in sentences, never zeros
 * ```
 *
 * Tracked means the product carries coverage there today (`COVERED_STATES`:
 * the reviewed registry, and the runner's coverage and readiness figures); it
 * is not a claim about how complete that coverage is. Registered means the
 * runner's promoted registration pointer names the state
 * (`lib/control-plane/admin-view/registration-standing.ts`). When the
 * pointers were not read, the untracked states sit under "Registration not
 * read" — never under "Nothing registered", which would claim an absence
 * nobody checked. PURE apart from the types it reads.
 */
import { COVERED_STATES } from "@/lib/coverage/states.ts";
import type { RegistrationPointers } from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { STANDING_GROUP, standingLabel, stateStanding, type StateStanding } from "@/lib/control-plane/admin-view/registration-standing.ts";
import type { ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";

import type { ScopeOptionGroup } from "./header-controls.tsx";
import { GEO_TYPE_WORDS, scopeParam, type MwGeoType, type MwScope } from "./scope.ts";

/** The states tracked with coverage and readiness figures, in onboarding order. */
export const TRACKED_STATE_CODES: readonly string[] = COVERED_STATES.map((s) => s.slug);

export function isTrackedState(code: string): boolean {
  return TRACKED_STATE_CODES.includes(code.toLowerCase());
}

export function stateName(code: string): string {
  return US_STATES.find((s) => s.code === code.toLowerCase())?.name ?? code.toUpperCase();
}

/** Where a state stands, from the registration pointers this page read. */
export function standingOf(code: string, registration: RegistrationPointers): StateStanding {
  return stateStanding(code, isTrackedState(code), registration);
}

/** Every state and territory with where it stands, tracked first, then registered, then the rest, each in catalog order. */
export function statesByStanding(registration: RegistrationPointers): readonly { readonly code: string; readonly name: string; readonly standing: StateStanding }[] {
  const order: Readonly<Record<StateStanding["kind"], number>> = { TRACKED: 0, REGISTERED: 1, NOT_READ: 2, NOT_REGISTERED: 3 };
  return US_STATES.map((s) => ({ code: s.code, name: s.name, standing: standingOf(s.code, registration) }))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => order[a.s.standing.kind] - order[b.s.standing.kind] || a.i - b.i)
    .map(({ s }) => s);
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
  /** False when the scope sits in a state that is not tracked with figures. */
  readonly tracked: boolean;
  /** Where the scope's state stands; null for everywhere. */
  readonly standing: StateStanding | null;
  /** The selected geography this scope names, when it is one. */
  readonly decision: ExpansionScopeDecision | null;
}

export function shellScope(
  scope: MwScope,
  selected: readonly ExpansionScopeDecision[],
  registration: RegistrationPointers,
  lookedUpLabel: string | null = null,
): ShellScope {
  const states = statesByStanding(registration);
  const tracked = states.filter((s) => s.standing.kind === "TRACKED");
  const everywhere = `Everywhere · ${tracked.length} tracked ${tracked.length === 1 ? "state" : "states"}`;

  const groups: ScopeOptionGroup[] = [
    { label: null, options: [{ value: "all", label: everywhere }] },
    { label: STANDING_GROUP.TRACKED, options: tracked.map((s) => ({ value: s.code, label: s.name })) },
  ];
  const geoOptions = selected
    .map((d) => ({ d, sc: scopeOfDecision(d) }))
    .filter((x): x is { d: ExpansionScopeDecision; sc: MwScope } => x.sc !== null)
    .map(({ d, sc }) => ({ value: scopeParam(sc) ?? "all", label: `${stateName(d.geography.stateAbbr)} · ${d.geography.label}` }));
  if (geoOptions.length > 0) groups.push({ label: "Your geographies", options: geoOptions });
  for (const kind of ["REGISTERED", "NOT_READ", "NOT_REGISTERED"] as const) {
    const these = states.filter((s) => s.standing.kind === kind);
    if (these.length > 0) groups.push({ label: STANDING_GROUP[kind], options: these.map((s) => ({ value: s.code, label: standingLabel(s.name, s.standing) })) });
  }

  let label: string;
  let standing: StateStanding | null = null;
  let decision: ExpansionScopeDecision | null = null;
  if (scope.kind === "all") {
    label = everywhere;
  } else if (scope.kind === "state") {
    standing = standingOf(scope.state, registration);
    label = standingLabel(stateName(scope.state), standing);
  } else {
    standing = standingOf(scope.state, registration);
    decision =
      selected.find((d) => d.geography.geoid === scope.geoid && d.geography.type === scope.type && d.geography.stateAbbr.toLowerCase() === scope.state) ?? null;
    label = `${stateName(scope.state)} · ${decision ? decision.geography.label : lookedUpLabel !== null ? lookedUpLabel : `${GEO_TYPE_WORDS[scope.type]} ${scope.geoid}`}`;
    // A geography reached by link that is not on the selected list still gets
    // its own option, so the select never shows a value it does not offer.
    if (!geoOptions.some((o) => o.value === scopeParam(scope))) {
      groups.splice(2, 0, { label: "This page", options: [{ value: scopeParam(scope) ?? "all", label }] });
    }
  }
  return { scope, label, groups, tracked: standing === null || standing.kind === "TRACKED", standing, decision };
}
