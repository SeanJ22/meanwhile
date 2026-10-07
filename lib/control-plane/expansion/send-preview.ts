/**
 * How many governments a Send would create work for, before it is sent, per
 * state the geography reaches:
 *
 * ```
 *   REVIEWED_REGISTRY  the reviewed registry defines its governments; the
 *                      runner places them by territory this page does not hold,
 *                      so the runner's receipt carries the count
 *   REGISTRATION       no reviewed registry: each government the promoted
 *                      registration minted a body for owes its meetings discovery
 *   NOT_READ           the registration could not be read: named, never zero
 * ```
 *
 * The preview reads the reader's ZIP index (whole or partial coverage per
 * code) rather than the runner's sampled shares, so it counts `certain`
 * governments exactly and `edge` ones separately; the runner's count lies in
 * `[certain, certain + edge]`. Pure.
 */
import { certainlyOverlaps, OVERLAP_CERTAINTY_MARGIN, type DivisionTerritory, type ScopeGeometry } from "./overlap.ts";
import type { TerritoryIndex } from "./membership.ts";
import type { JurisdictionRegistry } from "../../hunt/jurisdiction-universe.ts";

/** A government a state's registration holds a body for, on its Census division. */
export interface RegisteredGovernment {
  readonly jurisdictionId: string;
  readonly ocdId: string;
}

/** The scope's codes with their ZIP-index entries: the divisions reaching each, and those covering only part of it. */
export interface PreviewCode {
  readonly zcta5: string;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly divisions: readonly string[];
  readonly partial: readonly string[];
}

export type StateSendPreview =
  | { readonly kind: "REVIEWED_REGISTRY"; readonly state: string; readonly versionId?: string; readonly governments?: readonly PlacedGovernment[]; readonly unplaced?: readonly { readonly id: string; readonly name: string; readonly why: string }[] }
  | {
      readonly kind: "REGISTRATION";
      readonly state: string;
      /** The promoted registration version counted from. */
      readonly versionId: string;
      /** Jurisdiction ids the runner must place here, sorted: one meetings-discovery requirement each. */
      readonly governments: readonly string[];
      /** Jurisdiction ids at the edge, sorted: placed only if their sampled share of a shared code is large enough. */
      readonly edge: readonly string[];
    }
  | { readonly kind: "NOT_READ"; readonly state: string; readonly why: string };

export interface PlacedGovernment {
  readonly id: string;
  readonly name: string;
  readonly basis: string;
}

/** Uses the dispatch index itself, including district rules. An unresolved
 * territory remains a named gap, never a claim that the body is outside. */
export function reviewedGovernmentsPlaced(codes: readonly PreviewCode[], registry: JurisdictionRegistry, index: TerritoryIndex): {
  governments: PlacedGovernment[];
  unplaced: { id: string; name: string; why: string }[];
} {
  const scope = previewScope(codes);
  const governments: PlacedGovernment[] = [];
  const unplaced: { id: string; name: string; why: string }[] = [];
  for (const jurisdiction of registry.jurisdictions) {
    const territory = index.bySubject.get(jurisdiction.id);
    if (index.statewide.has(jurisdiction.id) || (territory && certainlyOverlaps(territory, scope))) {
      governments.push({ id: jurisdiction.id, name: jurisdiction.name, basis: index.statewide.has(jurisdiction.id)
        ? "Shared statewide government"
        : jurisdiction.govClass === "SPECIAL_DISTRICT"
          ? "Dispatch territory; approximate fire boundaries are discovery leads, not verified reader governance"
          : "Dispatch Census territory and adopted district membership rules" });
    } else if (index.unplaced.has(jurisdiction.id)) {
      unplaced.push({ id: jurisdiction.id, name: jurisdiction.name, why: index.unplaced.get(jurisdiction.id)! });
    }
  }
  governments.sort((a, b) => a.name.localeCompare(b.name));
  unplaced.sort((a, b) => a.name.localeCompare(b.name));
  return { governments, unplaced };
}

/** The scope's geometry, as the runner resolves it from the same published lookup. */
export function previewScope(codes: readonly PreviewCode[]): ScopeGeometry {
  const fractions = new Map<string, number>();
  for (const c of codes) if (!c.whole && c.fraction !== null) fractions.set(c.zcta5, c.fraction);
  return {
    zctas: new Set(codes.map((c) => c.zcta5)),
    whole: new Set(codes.filter((c) => c.whole).map((c) => c.zcta5)),
    fractions,
  };
}

/**
 * Each division's territory within these codes, from the ZIP index: share 1 where it covers a code whole, and no
 * share where the index marks it partial (its sampled share is not in the index).
 */
export function divisionTerritoriesIn(codes: readonly PreviewCode[], wanted: ReadonlySet<string>): Map<string, DivisionTerritory> {
  const out = new Map<string, { zctas: Set<string>; shares: Map<string, number> }>();
  for (const c of codes) {
    const partial = new Set(c.partial);
    for (const id of c.divisions) {
      if (!wanted.has(id)) continue;
      let t = out.get(id);
      if (t === undefined) {
        t = { zctas: new Set(), shares: new Map() };
        out.set(id, t);
      }
      t.zctas.add(c.zcta5);
      if (!partial.has(id)) t.shares.set(c.zcta5, 1);
    }
  }
  return out;
}

/** The governments of one registered state a Send in this scope must place, and those at its edge: sorted jurisdiction ids. */
export function registrationGovernmentsPlaced(
  codes: readonly PreviewCode[],
  governments: readonly RegisteredGovernment[],
): { readonly certain: readonly string[]; readonly edge: readonly string[] } {
  const scope = previewScope(codes);
  const territories = divisionTerritoriesIn(codes, new Set(governments.map((g) => g.ocdId)));
  const certain = new Set<string>();
  const edge = new Set<string>();
  for (const g of governments) {
    const t = territories.get(g.ocdId);
    if (t === undefined) continue;
    if (certainlyOverlaps(t, scope)) {
      certain.add(g.jurisdictionId);
      continue;
    }
    /* A code it covers only part of, which the scope holds more than the margin of: its sampled share decides. */
    const maybe = [...t.zctas].some((z) => !t.shares.has(z) && (scope.fractions.get(z) ?? 0) > OVERLAP_CERTAINTY_MARGIN);
    if (maybe) edge.add(g.jurisdictionId);
  }
  for (const id of certain) edge.delete(id);
  return { certain: [...certain].sort(), edge: [...edge].sort() };
}

/** One sentence for the composer, per state. */
export function stateSendPreviewSentence(p: StateSendPreview): string {
  if (p.kind === "REVIEWED_REGISTRY") {
    if (p.governments) return `${p.state}: the runner's territory rules place ${p.governments.length} governments in this scope, using promoted registry ${p.versionId}. ${p.unplaced?.length ?? 0} other registered governments have unresolved territory; their applicability remains unverified. Existing work is reused. This is work placement, not proof of completed coverage.`;
    return `${p.state}: its governments come from the reviewed ${p.state} jurisdiction registry. The runner places them by their Census territory and counts what it creates at its next cycle.`;
  }
  if (p.kind === "NOT_READ") return `${p.state}: its registration could not be read (${p.why}), so no count is claimed.`;
  const n = p.governments.length;
  const e = p.edge.length;
  return (
    `${p.state}: a Send creates work for ${n} ${n === 1 ? "government" : "governments"} here` +
    (e > 0 ? `, and up to ${e} more at the edge (the runner places each only if its share of a shared ZIP code is large enough)` : "") +
    `, from registration (the 2022 Census of Governments, promoted version ${p.versionId}) — no reviewed registry exists for ${p.state}. ` +
    "A new Send discovers meetings, officeholders, elections and finance sources where missing, and follows their downstream gaps. Existing shared work is reused; these initial families are not a claim of complete coverage" +
    "."
  );
}
