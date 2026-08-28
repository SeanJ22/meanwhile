import type { BindableEntity } from "../routing/named-entity.ts";

/**
 * **THE GOVERNMENTS A READER CAN NAME, read off the canonical division id.**
 *
 * Shared by `app/api/ask/agenda` and `app/api/ask/grounded` (RULING 103, the
 * duplicate-implementation guard caught this the moment both routes were
 * staged). One inventory, so the deterministic rung and the grounded rung can
 * never disagree about which governments exist.
 *
 * ## Why the division id and not `bodyName`
 *
 * The snapshot's `bodyName` cannot be used for this. For Vail Unified it reads
 * **"Governing Board Meeting"** — the meeting's title, carried onto the body —
 * so an inventory built from it contains no government called "Vail" and the
 * reader's own word could never have matched. The division id does carry it,
 * canonically:
 *
 * ```
 *   ocd-division/country:us/state:az/school_district:vail_unified_district
 *                                    ^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^
 *                                    divisionType    the name, slugged
 * ```
 *
 * Un-slugging that is a mechanical read of an identifier this product mints
 * itself, not a guess about what a government is called — and it is the same
 * string the registry's own `divisionLabel` is built from.
 */
export function snapshotEntities(
  meetings: readonly { ocdId: string | null }[],
): BindableEntity[] {
  const seen = new Map<string, BindableEntity>();
  for (const meeting of meetings) {
    const ocdId = meeting.ocdId;
    if (!ocdId || seen.has(ocdId)) continue;
    const last = ocdId.split("/").pop() ?? "";
    const [divisionType, slug] = last.split(":");
    if (!divisionType || !slug) continue;
    seen.set(ocdId, {
      id: ocdId,
      name: slug.replace(/_/g, " "),
      nameClass: "body",
      divisionType,
    });
  }
  return [...seen.values()];
}

/**
 * A slugged division name, as a reader should see it.
 *
 * Mechanical and deliberately dumb: capitalise each word. It is not a claim
 * about what a government calls itself — the canonical id is still the identity
 * and the matcher still binds on the normalized form — it is only the
 * difference between "vail unified district" and "Vail Unified District" in a
 * sentence a person reads.
 *
 * This is the agenda route's original implementation, moved here rather than
 * merged with the grounded route's slightly different one. The two were a
 * word-boundary regex and a split-and-capitalise, equivalent for the slugged
 * names both actually receive; keeping the one that had already shipped and
 * been exercised is the conservative half of the consolidation.
 */
export function titleCaseName(slugWords: string): string {
  return slugWords
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
