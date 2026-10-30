import { matchPerson, type PersonEvidence } from "../../identity/match-person.ts";
import { foldAccents, parsePersonName } from "../../identity/name-parts.ts";
import { normalizeNameText } from "../../identity/name-forms.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { LdaHonoreeJoin, LdaRoster } from "./types.ts";

/** The honoree as the filing prints it: a title names the chamber, a parenthesis names the honoree's state (never the lobbyist's), and a comma puts the surname first. */
function honoreeScope(raw: string) {
  let name = normalizeNameText(raw);
  const title = /^(?:(?:U\.?S\.?|United States)\s+)?(Sen(?:ator)?\.?|Rep(?:resentative)?\.?|Congressman|Congresswoman|Delegate)\s+/i.exec(name);
  const chamber = title ? /^sen/i.test(title[1]) ? "senate" : "house" : null;
  if (title) name = name.slice(title[0].length);
  const states = Object.values(FIPS_TO_STATE);
  const annotation = /\s*\((?:[DRI]-)?([A-Z]{2})(?:-\d+)?\)\s*$/i.exec(name);
  const state = annotation && states.some(row => row.postal === annotation[1].toUpperCase()) ? annotation[1].toUpperCase() : null;
  if (state && annotation) name = name.slice(0, annotation.index).trim();
  const comma = /^([^,]+),\s*([^,]+)$/.exec(name);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  return { name, chamber, state };
}

/** Every name the roster prints for a person, each read by the one matcher. */
const memberEvidence = (member: LdaRoster["members"][number]): PersonEvidence[] =>
  member.names.map(name => ({ id: member.bioguideId, name: parsePersonName(foldAccents(name)), state: member.state, seats: ["congress"] }));
/** A middle initial the filing prints that none of the roster's names print is another person. */
const initials = (name: string) => parsePersonName(foldAccents(name)).middles.filter(middle => middle.length === 1);
const people = new WeakMap<LdaRoster, PersonEvidence[]>();

export function joinLdaHonoree(raw: string, roster?: LdaRoster, unavailable?: string): { join: LdaHonoreeJoin; bioguideId?: string; state?: string } {
  const scope = honoreeScope(raw);
  const unjoined = (reason: Extract<LdaHonoreeJoin, { status: "UNJOINED" }>["reason"], detail: string) => ({
    join: { status: "UNJOINED" as const, reason, detail }, ...(scope.state ? { state: scope.state } : {}),
  });
  if (!scope.name || /^(none|n\/a|not applicable)$/i.test(scope.name)) return unjoined("NO_HONOREE", "The filing names no person as honoree.");
  if (!roster) return unjoined("ROSTER_UNAVAILABLE", unavailable ?? "The held federal roster could not be read.");
  let evidence = people.get(roster);
  if (!evidence) people.set(roster, evidence = roster.members.flatMap(memberEvidence));
  const members = roster.members.filter(member => !scope.chamber || member.chamber === scope.chamber), listed = new Set(members.map(member => member.bioguideId));
  const found = matchPerson({ id: "honoree", name: foldAccents(scope.name), state: scope.state, seats: ["congress"] }, evidence.filter(row => listed.has(row.id)));
  const printed = initials(scope.name);
  const ids = new Set((found.kind === "MATCH" ? [found.candidate] : found.kind === "TIE" ? found.candidates : []).map(row => row.id).filter(id => {
    const held = new Set(members.find(row => row.bioguideId === id)!.names.flatMap(initials));
    return !held.size || printed.every(letter => held.has(letter));
  }));
  if (ids.size !== 1) return unjoined(ids.size ? "AMBIGUOUS_MATCH" : "NO_MATCH",
    ids.size ? `${ids.size} federal roster people match the honoree name and published chamber/state; no member link was published.`
      : "No federal roster person matches the honoree name and published chamber/state.");
  const member = members.find(row => ids.has(row.bioguideId))!;
  return { bioguideId: member.bioguideId, state: member.state,
    join: { status: "JOINED", rosterVersionId: roster.versionId, matchedName: member.names[0], nameForm: normalizeNameText(scope.name).toLowerCase(),
      rules: [found.kind === "MATCH" ? found.basis : "SEAT_AND_NAME"], chamber: member.chamber, state: member.state, sourceUrl: member.sourceUrl, sourceOrg: member.sourceOrg, checkedAt: member.checkedAt } };
}
