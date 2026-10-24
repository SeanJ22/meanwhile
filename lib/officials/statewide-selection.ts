import type { StatewideExecutive } from "./statewide-executives.ts";
import { scopedHolders } from "./scoped-holders.ts";
import type { SeatHolder } from "./lookup.ts";
import { personName } from "./person-name.ts";
import { photoForPerson } from "../photos/person.ts";

function sourcedStatewideHolder(row: StatewideExecutive): SeatHolder {
  return { ...row.holder, officeJurisdictionOcdId: row.stateOcdId,
    ...(row.holder.partyLabel && row.partySourceUrl ? { fieldSources: { ...row.holder.fieldSources,
      partyLabel: row.holder.fieldSources?.partyLabel ?? { sourceUrl: row.partySourceUrl, sourceOrg: row.partySourceOrg ?? row.sourceOrg,
        collectedAt: row.collectedAt, verifiedAt: null } } } : {}),
    provenance: { sourceUrl: row.sourceUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt, verifiedAt: null } };
}

export function statewideHolder(row: StatewideExecutive): SeatHolder {
  const holder = sourcedStatewideHolder(row);
  const photo = photoForPerson(holder.personId ?? holder.id, row.stateOcdId.split(":").at(-1));
  return { ...holder, photoUrl: photo?.url ?? holder.photoUrl,
    ...(photo?.provenance ? { fieldSources: { ...holder.fieldSources, photoUrl: photo.provenance } } : {}) };
}

/** The same selection serves stored records and readers; duplicate person IDs remain aliases. */
export function selectStatewideExecutives(rows: readonly StatewideExecutive[]): StatewideExecutive[] {
  const valid = rows.filter(row => personName(row.holder.name));
  // Stored selection uses source fields; resolving reader portraits also consults this selection's identity links.
  return scopedHolders(valid.map(sourcedStatewideHolder), []).map(selected => {
    const origin = valid.find(row => row.stateOcdId === selected.officeJurisdictionOcdId &&
      row.sourceUrl === selected.provenance?.sourceUrl && row.collectedAt === selected.provenance.collectedAt)!;
    const sources = valid.filter(row => row.holder.id === selected.id || selected.nativeIds?.reader?.includes(row.holder.id));
    if (sources.length === 1 && sources[0].holder.id === selected.id) return sources[0];
    const party = sources.find(row => row.holder.partyLabel === selected.partyLabel && row.partySourceUrl && row.partySourceUrl === selected.fieldSources?.partyLabel?.sourceUrl)
      ?? sources.find(row => row.holder.partyLabel === selected.partyLabel && row.partySourceUrl);
    const { provenance: _provenance, officeJurisdictionOcdId: _division, ...holder } = selected;
    return { ...origin, holder, ...(party ? { partySourceUrl: party.partySourceUrl, ...(party.partySourceOrg ? { partySourceOrg: party.partySourceOrg } : {}) } : {}) };
  });
}
