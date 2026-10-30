import type { OfficialCandidacyBridgeRow } from "./runtime-data-plane.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";

type Holder = OfficialCandidacyBridgeRow["holder"];
const fullName = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const SINGLE_STATE_EXECUTIVES = new Set(["governor", "lieutenant_governor", "secretary_of_state", "attorney_general",
  "state_treasurer", "superintendent_of_public_instruction", "state_mine_inspector", "state_auditor", "state_comptroller",
  "insurance_commissioner", "chief_election_officer", "agriculture_commissioner", "public_lands_commissioner", "labor_commissioner"]);
const executiveAuthority = (holder: Holder) => holder.authority === "REGISTRY_STATEWIDE_EXECUTIVE" || holder.authority === "STATE_PEOPLE";
const officialPage = (holder: Holder) => Boolean(holder.sourceUrl && isOfficialSource(holder.sourceUrl) ||
  holder.officialProfileUrl && isOfficialSource(holder.officialProfileUrl));

/** Two official publishers can describe the same holder of a single statewide
 * office. Their source slots remain aliases; distinct native people do not. */
export function sameSourcedExecutivePerson(left: Holder, right: Holder): boolean {
  const office = officeIdentity(left.officeTitle);
  if (!executiveAuthority(left) || !executiveAuthority(right) ||
      !office || !SINGLE_STATE_EXECUTIVES.has(office) || officeIdentity(right.officeTitle) !== office ||
      !left.sourceUrl || !right.sourceUrl || !officialPage(left) || !officialPage(right) ||
      !fullName(left.name) || fullName(left.name) !== fullName(right.name)) return false;
  const a = [...new Set(left.divisions)], b = [...new Set(right.divisions)];
  if (a.length !== 1 || b.length !== 1 || a[0] !== b[0] ||
      !/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(a[0]) ||
      !sameSeatDiscriminators(left.officeTitle, right.officeTitle, a[0])) return false;
  const keys = personIdentityKeys(left);
  const shared = [...personIdentityKeys(right)].some(key => keys.has(key));
  if (left.personId && right.personId && left.personId !== right.personId && !shared) return false;
  for (const [source, ids] of Object.entries(left.nativeIds ?? {})) {
    if (source === "reader" || !ids.length) continue;
    const other = right.nativeIds?.[source];
    if (other?.length && !ids.some(id => other.includes(id))) return false;
  }
  return true;
}
