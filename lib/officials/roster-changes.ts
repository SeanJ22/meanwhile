import type { Officeholder, OfficeholderSet, SeatVacancy } from "./types.ts";
import { personIdentityKeys } from "./people-identity.ts";

/** One seat that changed between a source's last published read and this one, with the page that says so. */
export interface RosterChange {
  readonly kind: "appointed" | "departed" | "vacant" | "changed";
  readonly name: string | null;
  readonly officeTitle: string;
  readonly divisionId: string;
  readonly sourceUrl: string | null;
  readonly since?: string | null;
}

function identities(roster: OfficeholderSet): { readonly find: (person: Officeholder) => Officeholder | undefined; readonly links: (id: string) => readonly string[] } {
  const byKey = new Map<string, Officeholder>(), links = new Map<string, string[]>();
  for (const person of roster.officeholders) for (const key of personIdentityKeys(person)) if (!byKey.has(key)) byKey.set(key, person);
  for (const link of roster.divisions) links.set(link.officeholderId, [...links.get(link.officeholderId) ?? [], link.ocdId]);
  return { find: person => [...personIdentityKeys(person)].map(key => byKey.get(key)).find(row => row !== undefined), links: id => links.get(id) ?? [] };
}

/** Compare by exact publisher identity; a name never joins two people. A departure needs the source's own statement. */
export function rosterChanges(prior: OfficeholderSet | null, next: OfficeholderSet,
  vacancies: { readonly prior?: readonly SeatVacancy[]; readonly next?: readonly SeatVacancy[] } = {}): RosterChange[] {
  const changes: RosterChange[] = [];
  const stated = vacancies.next ?? next.vacancies ?? [];
  // A source's first read is its baseline: every holder is new to it, not newly in office.
  if (prior) {
    const before = identities(prior), after = identities(next);
    for (const person of next.officeholders) {
      const held = before.find(person);
      const priorDivisions = new Set(held ? before.links(held.id) : []);
      for (const divisionId of after.links(person.id)) {
        if (held && priorDivisions.has(divisionId) && held.name === person.name && held.officeTitle === person.officeTitle) continue;
        changes.push({ kind: held && priorDivisions.has(divisionId) ? "changed" : "appointed", name: person.name, officeTitle: person.officeTitle,
          divisionId, sourceUrl: person.provenance.sourceUrl ?? null, ...(person.termStart ? { since: person.termStart } : {}) });
      }
    }
    const priorIds = new Set(prior.officeholders.map(person => person.id));
    for (const person of prior.officeholders) {
      const now = after.find(person);
      const remaining = new Set(now ? after.links(now.id) : []);
      for (const divisionId of before.links(person.id)) {
        if (remaining.has(divisionId)) continue;
        // The source's own statement: the seat empty, another holder in it, or the seat removed from a person it still lists.
        const vacancy = stated.find(row => row.ocdId === divisionId);
        const successor = next.divisions.filter(link => link.ocdId === divisionId && !priorIds.has(link.officeholderId))
          .map(link => next.officeholders.find(row => row.id === link.officeholderId)).find(row => row !== undefined);
        if (!vacancy && !now && !successor) continue;
        changes.push({ kind: "departed", name: person.name, officeTitle: person.officeTitle, divisionId,
          sourceUrl: vacancy?.sourceUrl ?? now?.provenance.sourceUrl ?? successor?.provenance.sourceUrl ?? null });
      }
    }
  }
  const before = vacancies.prior ?? prior?.vacancies ?? [];
  for (const vacancy of stated) {
    if (before.some(row => row.ocdId === vacancy.ocdId && row.sourceUrl === vacancy.sourceUrl)) continue;
    changes.push({ kind: "vacant", name: null, officeTitle: vacancy.officeTitle ?? "", divisionId: vacancy.ocdId, sourceUrl: vacancy.sourceUrl, since: vacancy.since ?? null });
  }
  return changes;
}
