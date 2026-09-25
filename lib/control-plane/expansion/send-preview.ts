/**
 * **HOW MANY GOVERNMENTS A SEND WOULD CREATE WORK FOR, BEFORE IT IS SENT.**
 * (2026-09-25. docs/rulings.md §1.)
 *
 * The composer's preview (`/api/admin/geography-preview`) states, per state the
 * geography reaches, where its governments come from and — for a state read
 * from its registration — how many governments a Send places there:
 *
 * ```
 *   REVIEWED_REGISTRY  the state's reviewed registry (the promoted operational
 *                      reference) defines its governments; the runner places
 *                      them by their Census unit territory, which this page
 *                      does not hold, so the runner's receipt carries the count
 *   REGISTRATION       no reviewed registry: the state's promoted registration
 *                      names them. Each government it minted a body for owes
 *                      one requirement, its meetings discovery
 *   NOT_READ           the registration could not be read: named, never zero
 * ```
 *
 * **Certain, and at the edge.** The runner places a government by the runner's
 * rule (`certainlyOverlaps`) on its sampled share of each ZCTA
 * (`data/derived/zip-governments.json`, 30 MB, which Admin does not ship). The
 * preview reads the reader's ZIP index for the scope's own codes, which says
 * whether a division covers each code whole (share 1, known exactly) or only
 * part of it (share unknown). So it counts exactly the governments the runner
 * must place (`certain`), and separately the ones that touch the scope only
 * where they cover part of a code the scope holds more than the margin of
 * (`edge`): the runner places each of those only if its sampled share is large
 * enough. The runner's count lies in `[certain, certain + edge]`, and its
 * receipt states it exactly. PURE.
 */
import { certainlyOverlaps, OVERLAP_CERTAINTY_MARGIN, type DivisionTerritory, type ScopeGeometry } from "./overlap.ts";

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
  | { readonly kind: "REVIEWED_REGISTRY"; readonly state: string }
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
export function stateSendPreviewSentence(p: StateSendPreview, cap: number): string {
  if (p.kind === "REVIEWED_REGISTRY") {
    return `${p.state}: its governments come from the reviewed ${p.state} jurisdiction registry. The runner places them by their Census territory and counts what it creates at its next cycle.`;
  }
  if (p.kind === "NOT_READ") return `${p.state}: its registration could not be read (${p.why}), so no count is claimed.`;
  const n = p.governments.length;
  const e = p.edge.length;
  return (
    `${p.state}: a Send creates work for ${n} ${n === 1 ? "government" : "governments"} here` +
    (e > 0 ? `, and up to ${e} more at the edge (the runner places each only if its share of a shared ZIP code is large enough)` : "") +
    `, from registration (the 2022 Census of Governments, promoted version ${p.versionId}) — no reviewed registry exists for ${p.state}. ` +
    "Each owes one requirement, its meetings discovery; a government an earlier Send reached is not created twice" +
    (n + e > cap ? `, and at most ${cap.toLocaleString("en-US")} are created for one geography.` : ".")
  );
}
