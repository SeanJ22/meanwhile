import { nameForms, normalizeNameText } from "../../identity/name-forms.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { LdaHonoreeJoin, LdaRoster } from "./types.ts";

/** Annotation parsing and exact equality, as in the people joins. No inferred nicknames. */
function honoreeScope(raw: string) {
  let name = normalizeNameText(raw);
  const title = /^(?:(?:U\.?S\.?|United States)\s+)?(Sen(?:ator)?\.?|Rep(?:resentative)?\.?|Congressman|Congresswoman|Delegate)\s+/i.exec(name);
  const chamber = title ? /^sen/i.test(title[1]) ? "senate" : "house" : null;
  if (title) name = name.slice(title[0].length);
  // State belongs to the honoree, never the registrant's or lobbyist's address.
  const states = Object.values(FIPS_TO_STATE);
  const annotation = /\s*\((?:[DRI]-)?([A-Z]{2})(?:-\d+)?\)\s*$/i.exec(name);
  const state = annotation && states.some(row => row.postal === annotation[1].toUpperCase()) ? annotation[1].toUpperCase() : null;
  if (state && annotation) name = name.slice(0, annotation.index).trim();
  // The publisher's comma format is a name form only with exactly two parts.
  const comma = /^([^,]+),\s*([^,]+)$/.exec(name);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  return { name, chamber, state };
}

function forms(name: string) {
  const result: { form: string; rules: string[] }[] = nameForms(name.replace(/\(([^)]+)\)/g, '"$1"'));
  for (const form of [...result]) {
    const words = form.form.split(" ");
    // Omit an annotated middle initial, keeping both ends and every surname token.
    const kept = words.filter((word, index) => index === 0 || index === words.length - 1 || !/^[a-z]$/.test(word));
    if (kept.length !== words.length) result.push({ form: kept.join(" "), rules: [...form.rules, "MIDDLE_INITIAL_OMITTED"] });
  }
  return result;
}
type RosterForm = { member: LdaRoster["members"][number]; name: string; rules: string[]; initials: string[] };
const indexes = new WeakMap<LdaRoster, Map<string, RosterForm[]>>();
function rosterIndex(roster: LdaRoster) {
  const held = indexes.get(roster);
  if (held) return held;
  const index = new Map<string, RosterForm[]>();
  for (const member of roster.members) {
    const initials = member.names.flatMap(name => nameForms(name)[0]?.form.split(" ").slice(1, -1).filter(word => /^[a-z]$/.test(word)) ?? []);
    for (const name of member.names) for (const form of forms(name)) {
      const rows = index.get(form.form) ?? [];
      rows.push({ member, name, rules: form.rules, initials }); index.set(form.form, rows);
    }
  }
  indexes.set(roster, index); return index;
}

export function joinLdaHonoree(raw: string, roster?: LdaRoster, unavailable?: string): { join: LdaHonoreeJoin; bioguideId?: string; state?: string } {
  const scope = honoreeScope(raw);
  const unjoined = (reason: Extract<LdaHonoreeJoin, { status: "UNJOINED" }>["reason"], detail: string) => ({
    join: { status: "UNJOINED" as const, reason, detail }, ...(scope.state ? { state: scope.state } : {}),
  });
  if (!scope.name || /^(none|n\/a|not applicable)$/i.test(scope.name)) return unjoined("NO_HONOREE", "The filing names no person as honoree.");
  if (!roster) return unjoined("ROSTER_UNAVAILABLE", unavailable ?? "The held federal roster could not be read.");
  const sourceForms = forms(scope.name);
  const sourceInitials = nameForms(scope.name)[0]?.form.split(" ").slice(1, -1).filter(word => /^[a-z]$/.test(word)) ?? [];
  const index = rosterIndex(roster);
  const matches = new Map<string, { member: LdaRoster["members"][number]; name: string; form: string; rules: string[] }>();
  for (const shared of sourceForms) for (const { member, name, rules, initials } of index.get(shared.form) ?? []) {
    if (scope.chamber && member.chamber !== scope.chamber || scope.state && member.state !== scope.state) continue;
    if (sourceInitials.length && initials.length && sourceInitials.some(initial => !initials.includes(initial))) continue;
    if (!matches.has(member.bioguideId)) matches.set(member.bioguideId, { member, name, form: shared.form,
      rules: [...new Set([...shared.rules, ...rules])] });
  }
  if (matches.size !== 1) return unjoined(matches.size ? "AMBIGUOUS_MATCH" : "NO_MATCH",
    matches.size ? `${matches.size} federal roster people match the honoree name and published chamber/state; no member link was published.`
      : "No federal roster person matches the honoree name and published chamber/state.");
  const { member, name, form, rules } = [...matches.values()][0];
  return { bioguideId: member.bioguideId, state: member.state,
    join: { status: "JOINED", rosterVersionId: roster.versionId, matchedName: member.names[0], nameForm: form,
      rules: [...rules, ...(name !== member.names[0] ? ["PUBLISHED_ROSTER_NAME_FORM"] : [])],
      chamber: member.chamber, state: member.state, sourceUrl: member.sourceUrl, sourceOrg: member.sourceOrg, checkedAt: member.checkedAt } };
}
