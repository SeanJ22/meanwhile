import type { PersonMembership } from "../../officials/types.ts";
import { designationKey } from "../../officials/office-identity.ts";
import { tribalSeatReferenceFor } from "../../officials/tribal-seats.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { overlayDistrictCode, overlayDistrictIdentity, overlaySourceRows } from "../../overlay-geography/reference.ts";
import discrepancies from "../../../data/reference/geography/overlay-source-discrepancies.json" with { type: "json" };

export interface RepresentationLinks {
  readonly divisionIds: readonly string[];
  readonly representation?: PersonMembership["representation"];
  readonly nation?: string;
  readonly gap?: string;
}

function sourcesFor(state: string, chamber: string) {
  return overlaySourceRows.filter(source => FIPS_TO_STATE[source.stateFips]?.postal.toLowerCase() === state.toLowerCase() && source.chamber === chamber);
}

/** Code aliases come only from published district identities and their reference rule. */
export function indexOverlayDesignation(state: string, chamber: string, ocdId: string, index: Map<string, string>): void {
  const suffix = ocdId.slice(ocdId.lastIndexOf(":") + 1);
  for (const source of sourcesFor(state, chamber)) {
    const code = overlayDistrictCode(source, suffix);
    if (code && overlayDistrictIdentity(source, code)?.ocdId === ocdId) index.set(`${state}|${chamber}|${designationKey(code)}`, ocdId);
  }
}

/** A nation can have several separate Census areas but holds one legislative seat. */
export function representationSeatLinks(state: string, chamber: string, district: string, index: Map<string, string>, baseId?: string): RepresentationLinks {
  const tribal = tribalSeatReferenceFor(state, chamber, district);
  if (tribal) {
    const areas = [...new Set(tribal.aiannhIds ?? tribal.aiannhAreaIds.map(id => id.slice(0, 4)))];
    const divisionIds = areas.flatMap(area => index.get(`${state}|aiannh|${area.toLowerCase()}`) ?? []);
    const missing = areas.filter(area => !index.has(`${state}|aiannh|${area.toLowerCase()}`));
    return { divisionIds, representation: "tribal", nation: tribal.nation,
      ...(missing.length ? { gap: `Referenced Census tribal areas have not been published: ${missing.join(", ")}` } : {}) };
  }
  let divisionId = baseId;
  for (const source of sourcesFor(state, chamber)) {
    const code = overlayDistrictCode(source, district);
    if (!code) continue;
    divisionId ??= index.get(`${state}|${chamber}|${designationKey(code)}`);
    if (divisionId && overlayDistrictIdentity(source, code)?.ocdId === divisionId) return { divisionIds: [divisionId], representation: "overlay" };
    if (!divisionId) {
      const difference = discrepancies.differences.find(row => row.sourceId === source.id && row.code === code);
      if (difference) return { divisionIds: [], gap: `${difference.reason}; only in the election authority document: ${difference.documentOnly.join(", ")}` };
    }
  }
  return { divisionIds: divisionId ? [divisionId] : [] };
}
