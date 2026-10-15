import type { Query } from "../../lib/facts/publish.ts";
import type { BodyRoster } from "../../lib/registry/body-rosters.ts";

/** Answers the reader's roster read from rosters a fixture holds, each member standing as live facts on its own page. */
export function rosterFactReader(rosters: readonly BodyRoster[]): Query {
  return async (text, params = []) => {
    if (!text.includes("'member:%'")) return [];
    const ids = params[0] as readonly string[] | null;
    return rosters.filter(roster => !ids || ids.includes(roster.bodyId)).flatMap(roster => roster.members.map(member => {
      const url = member.membershipSource?.sourceUrl ?? roster.sourceUrl;
      const checked = member.membershipSource?.collectedAt ?? roster.collectedAt;
      const fact = (value: string | null | undefined) => value ? { value, quote: value, url, checked } : undefined;
      const person = Object.fromEntries(Object.entries({ name: fact(member.name), [`office:${roster.bodyId}`]: fact(member.officeTitle), email: fact(member.email),
        phone: fact(member.phone), website: fact(member.websiteUrl), [`term_note:${roster.bodyId}`]: fact(member.termNote) }).filter(([, held]) => held));
      return { body_id: roster.bodyId, body_name: roster.bodyName, person_id: member.personId ?? member.id, value: { name: member.name, office: member.officeTitle },
        quote: member.name, checked_at: checked, provenance_kind: "OFFICIAL", url, shown_id: member.id, person };
    }));
  };
}
