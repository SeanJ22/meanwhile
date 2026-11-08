import type { BodyRoster, RosterMember, RosterReaderDisposition } from "../../lib/registry/body-rosters.ts";
import { AZ_CAWCD_ROSTERS } from "./cawcd-rosters.ts";
import { NJ_MORRIS_ROSTERS } from "./rosters-nj-morris.ts";
import { bodyRosterFixture } from "./held-record-shapes.ts";
import DATA from "./held-body-rosters.json" with { type: "json" };

/** Raw held rows and their original source annotations remain in the JSON fixture. */
export const HELD_BODY_ROSTERS: BodyRoster[] = [
  ...bodyRosterFixture(DATA.initialRosters),
  ...NJ_MORRIS_ROSTERS,
  ...AZ_CAWCD_ROSTERS,
  ...bodyRosterFixture(DATA.finalRosters),
];

/** A navigation label cannot identify a person; identical rows are one answer. */
export function projectReaderRoster(roster: BodyRoster): { roster: BodyRoster; dispositions: RosterReaderDisposition[] } {
  const members: RosterMember[] = [];
  const dispositions: RosterReaderDisposition[] = [];
  const exactRows = new Map<string, string>();
  for (const member of roster.members) {
    const label = member.name.trim().toLowerCase().replace(/\s+/g, " ");
    // A single word ("Actions", "Menu") is a page label, never a US officeholder's name.
    const navigation = !/\s/.test(label) || ["contact us", "contact information", "staff directory", "email us", "town hall", "member name"].includes(label)
      || (/^members\S/i.test(member.name) && /agendas.*minutes/i.test(member.officeTitle));
    if (!label || navigation) {
      dispositions.push({ sourceId: member.id, canonicalId: null, state: "IDENTITY_UNRESOLVED", reason: "The held extraction contains navigation text instead of an established person identity. Its contact fields are not attached to another person." });
      continue;
    }
    const exact = JSON.stringify(Object.entries(member).filter(([key]) => key !== "id").sort(([a], [b]) => a.localeCompare(b)));
    const existing = exactRows.get(exact);
    if (existing) {
      dispositions.push({ sourceId: member.id, canonicalId: existing, state: "EXACT_DUPLICATE", reason: "Every held field is identical within the same sourced body roster except the source-row ID. The first source row supplies the single current answer." });
      continue;
    }
    exactRows.set(exact, member.id);
    members.push(member);
    dispositions.push({ sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE", reason: "The sourced roster row identifies this member; no name-only identity join is performed." });
  }
  return { roster: { ...roster, members }, dispositions };
}

const READER_ROSTERS = HELD_BODY_ROSTERS.map(projectReaderRoster);
/** Real roster records read from each body's own page, for tests. */
export const BODY_ROSTERS: BodyRoster[] = READER_ROSTERS.map(result => result.roster);
export const ROSTER_READER_DISPOSITIONS = READER_ROSTERS.flatMap(result => result.dispositions);


