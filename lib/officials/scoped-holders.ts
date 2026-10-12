import type { SeatHolder } from "./lookup.ts";
import { officeIdentity } from "./office-identity.ts";
import { sameNativePerson } from "./people-identity.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";

const SINGLE_OFFICES = new Set([
  "governor", "lieutenant_governor", "secretary_of_state", "attorney_general", "state_treasurer",
  "superintendent_of_public_instruction", "state_mine_inspector", "state_auditor", "state_comptroller",
  "insurance_commissioner", "chief_election_officer", "mayor",
]);

/** Combine sources for one exact division, preferring official fields and current officeholders. */
export function scopedHolders(primary: readonly SeatHolder[], additional: readonly SeatHolder[]): SeatHolder[] {
  const holders = [...primary];
  const words = (value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const state = (holder:SeatHolder)=>holder.state ?? /\/(?:state|district|territory):([a-z]{2})/.exec(holder.officeJurisdictionOcdId ?? "")?.[1];
  const office = (holder:SeatHolder)=>officeIdentity(holder.officeTitle) ?? words(holder.officeTitle);
  for (const holder of additional) {
    const matching = holders.findIndex(row=>office(row) === office(holder) &&
      (sameNativePerson(row,holder) || words(row.name) === words(holder.name) &&
        Boolean(state(row) && state(holder) && state(row)!.toUpperCase() === state(holder)!.toUpperCase())));
    if (matching >= 0) {
      const prior = holders[matching];
      const newer = (holder.provenance?.collectedAt ?? "") >= (prior.provenance?.collectedAt ?? "");
      const merged = {...prior, nativeIds: Object.fromEntries([...new Set([...Object.keys(prior.nativeIds ?? {}),...Object.keys(holder.nativeIds ?? {})])].map(key=>[key,[...new Set([...(prior.nativeIds?.[key] ?? []),...(holder.nativeIds?.[key] ?? [])])]])),
        fieldSources: {...prior.fieldSources}, memberships: holder.memberships ?? prior.memberships};
      merged.nativeIds.reader=[...new Set([...(merged.nativeIds.reader??[]),prior.id,prior.personId??prior.id,holder.id,holder.personId??holder.id])];
      const fields = ["name","officeTitle","termStart","termEnd","birthDate","websiteUrl","phone","email","contactFormUrl","photoUrl","campaignUrl","selectionMethod","selectionMethodSourceUrl"] as const;
      for (const field of fields) if (holder[field] !== null && holder[field] !== undefined && holder[field] !== "") {
        const source = holder.fieldSources?.[field === "photoUrl" ? "photo" : field] ?? holder.provenance;
        const priorSource = prior.fieldSources?.[field === "photoUrl" ? "photo" : field] ?? prior.provenance;
        const official = Boolean(source?.sourceUrl && isOfficialSource(source.sourceUrl) || source?.kind === "OFFICIAL");
        const priorOfficial = Boolean(priorSource?.sourceUrl && isOfficialSource(priorSource.sourceUrl) || priorSource?.kind === "OFFICIAL");
        if (!prior[field] || official && !priorOfficial || official === priorOfficial && newer) {
          Object.assign(merged,{[field]:holder[field]});
          if (source) merged.fieldSources[field] = source;
        }
      }
      if (newer && holder.provenance) {merged.provenance=holder.provenance;merged.sourceUrl=holder.sourceUrl;}
      holders[matching] = merged;
      continue;
    }
    // A complete newer official single-seat source replaces the older holder.
    const key = officeIdentity(holder.officeTitle);
    const sameSeat = key && SINGLE_OFFICES.has(key) ? holders.findIndex(row=>officeIdentity(row.officeTitle) === key && state(row)?.toUpperCase() === state(holder)?.toUpperCase()) : -1;
    if (sameSeat >= 0) {
      const prior = holders[sameSeat];
      if (holder.provenance?.sourceUrl && (holder.provenance.kind === "OFFICIAL" || isOfficialSource(holder.provenance.sourceUrl)) && (holder.provenance.collectedAt >= (prior.provenance?.collectedAt ?? ""))) holders[sameSeat]=holder;
      continue;
    }
    holders.push(holder);
  }
  return holders;
}

/** State or district-wide executive offices, excluding Congress and legislative seats on the same index. */
export function isStatewideExecutive(holder: SeatHolder): boolean {
  if (holder.selectionMethod === "UNKNOWN") return false;
  if (holder.memberships?.some(row=>row.current !== false && row.level === "STATE" &&
    /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(row.divisionId ?? "") &&
    !["lower", "upper", "house", "senate"].includes(row.chamber ?? ""))) return true;
  const office = officeIdentity(holder.officeTitle);
  return office !== null && (SINGLE_OFFICES.has(office) && office !== "mayor" || office === "corporation_commissioner"
    || office === "mayor" && holder.officeJurisdictionOcdId === "ocd-division/country:us/district:dc");
}
