import { KELLY_FIELDS, type ProfileFieldKey } from "./checklist-map.ts";
import type { PlaceOwedItem } from "./place-owed.ts";

/**
 * **PEOPLE COVERAGE: WHO HAS A FULL PROFILE.** For the officials and candidates a
 * place knows about, how many have every field that applies to them, and how
 * many people have each field. A field is counted only for the people it applies
 * to: campaign site and money for people with a campaign, votes for voting
 * members. A field that cannot be joined to a person yet is reported as not
 * measured, never as missing, and is left out of "full" rather than failing
 * everyone for it. It is a measure and never a gate, and it only reads the owed
 * list.
 *
 * PURE.
 */
export interface FieldCoverage {
  readonly key: ProfileFieldKey;
  readonly label: string;
  /** People this field applies to. */
  readonly applies: number;
  /** Of those, how many hold it. Null when the field cannot be joined to a person yet. */
  readonly held: number | null;
}

export interface PeopleCoverage {
  readonly people: number;
  /** People with every measurable field that applies to them. */
  readonly full: number;
  readonly percent: number | null;
  readonly fields: readonly FieldCoverage[];
  /** Fields no source can be joined to a person for yet. */
  readonly notMeasured: readonly string[];
}

type Person = { readonly id: string; readonly kind: "seat" | "candidate"; readonly campaign: boolean; readonly voting: boolean };
const VOTING_SEATS = new Set(["federal-legislator", "state-legislator", "local-officeholder"]);

export function peopleCoverage(rows: readonly PlaceOwedItem[]): PeopleCoverage {
  const people = new Map<string, Person>();
  for (const row of rows) {
    const subject = row.subject;
    if (subject.kind === "seat" && !subject.id.includes("#inventory:")) people.set(subject.id, { id: subject.id, kind: "seat", campaign: false, voting: VOTING_SEATS.has(subject.captureKind ?? "") });
    else if (subject.captureKind === "candidate") people.set(subject.id, { id: subject.id, kind: "candidate", campaign: true, voting: false });
  }
  const holds = (person: Person, ids: readonly string[]) => rows.some(row => row.subject.id === person.id && ids.includes(row.checklistId)
    && (row.state === "published" || row.state === "held"));
  const appliesTo = (person: Person, rule: { readonly appliesTo: string }) =>
    rule.appliesTo === "everyone" || rule.appliesTo === "campaign" && person.campaign || rule.appliesTo === "voting-member" && person.voting;
  const fields = (Object.entries(KELLY_FIELDS) as [ProfileFieldKey, (typeof KELLY_FIELDS)[ProfileFieldKey]][]).map(([key, rule]): FieldCoverage => {
    const who = [...people.values()].filter(person => appliesTo(person, rule));
    const measurable = who.filter(person => rule.ids[person.kind].length > 0);
    return { key, label: rule.label, applies: who.length,
      held: who.length > 0 && measurable.length === 0 ? null : measurable.filter(person => holds(person, rule.ids[person.kind])).length };
  });
  const notMeasured = fields.filter(field => field.held === null).map(field => field.label);
  const full = [...people.values()].filter(person => (Object.values(KELLY_FIELDS)).every(rule =>
    !appliesTo(person, rule) || rule.ids[person.kind].length === 0 || holds(person, rule.ids[person.kind]))).length;
  return { people: people.size, full, percent: people.size === 0 ? null : Math.floor((full / people.size) * 1000) / 10, fields, notMeasured };
}

/** "Officials and candidates with a full profile: 4 of 9". */
export function peopleCoverageWords(coverage: PeopleCoverage): string {
  return `Officials and candidates with a full profile: ${coverage.full} of ${coverage.people}`;
}
