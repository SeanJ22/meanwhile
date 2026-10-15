import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import { electionFieldIssue, type PublishedElectionField } from "../civic-data/election-fields.ts";
import { ballotNavigationScope, ballotNavigationDivision } from "../civic-data/ballot-navigation-scope.ts";
import type { ElectionDates } from "./election-dates.ts";

export interface RegistrationLink {
  state: string; label: string; url: string; sourceOrg: string; verification: string; verifiedAt: string;
  purpose: "registration_page" | "registration_lookup"; sourceUrl?: string;
}
export interface PollingPlaceLink {
  state: string; label: string; url: string; sourceOrg: string; note: string; verification: string; verifiedAt: string;
  purpose: "polling_lookup" | "ballot_lookup"; sourceUrl?: string;
}
export interface BallotNavigation {
  readonly offices: readonly PublishedElectionField["value"][];
  readonly registrations: readonly RegistrationLink[];
  readonly polling: readonly PollingPlaceLink[];
  readonly dates: readonly ElectionDates[];
}
interface DivisionNavigation {
  offices: PublishedElectionField["value"][];
  registrations: RegistrationLink[];
  polling: PollingPlaceLink[];
  dates: ElectionDates[];
}
const indexed = new WeakMap<object, { version: string; state: string; divisions: Map<string, DivisionNavigation> }>();
const LABELS: Readonly<Partial<Record<PublishedElectionField["value"]["fieldKind"], string>>> = {
  registration_deadline: "Voter registration", mail_ballot_request_deadline: "Mail-ballot request", early_voting: "Early voting",
};
const latest = <T extends { readonly verifiedAt: string }>(rows: readonly T[], key: (row: T) => string): T[] => {
  const values = new Map<string, T>();
  for (const row of rows) {
    const old = values.get(key(row));
    if (!old || Date.parse(row.verifiedAt) >= Date.parse(old.verifiedAt)) values.set(key(row), row);
  }
  return [...values.values()];
};

export function ballotNavigationFor(state: string, projection: CuratedReaderProjection, version: string,
  divisions: readonly string[]): BallotNavigation {
  ballotNavigationScope(state);
  let index = indexed.get(projection);
  if (!index || index.version !== version || index.state !== state) {
    if (projection.kind !== "ballot-navigation" || !Array.isArray(projection.records) || !projection.records.length) {
      throw new Error(`Navigation ${version} has no records.`);
    }
    const byDivision = new Map<string, DivisionNavigation>(), ids = new Set<string>();
    for (const row of projection.records) {
      if (!row?.id || ids.has(row.id)) throw new Error(`Navigation ${version} repeats or omits a record identity.`);
      ids.add(row.id);
      const value = row.value as PublishedElectionField["value"];
      if (value?.state !== state) throw new Error(`Navigation ${version} crosses a state boundary.`);
      const division = value.divisionId ?? ballotNavigationDivision(state);
      const entry: DivisionNavigation = byDivision.get(division) ?? { offices: [], registrations: [], polling: [], dates: [] };
      byDivision.set(division, entry);
      if (row.kind === "REGISTRATION_LINK" || row.kind === "POLLING_PLACE_LINK") {
        if (!/^https:\/\//.test(value.url) || !Number.isFinite(Date.parse(value.verifiedAt))) throw new Error(`Navigation ${version} has an invalid link.`);
        if (row.kind === "REGISTRATION_LINK") entry.registrations.push({ ...(row.value as unknown as RegistrationLink), purpose: "registration_lookup" });
        else entry.polling.push({ ...(row.value as unknown as PollingPlaceLink), purpose: "polling_lookup" });
        continue;
      }
      const issue = electionFieldIssue(row);
      if (issue) throw new Error(`Navigation ${version}: ${issue}`);
      if (value.fieldKind === "election_office") entry.offices.push(value);
      else if (value.fieldKind === "registration_page" || value.fieldKind === "registration_lookup") entry.registrations.push({
        state, purpose: value.fieldKind, label: value.fieldKind === "registration_page" ? "Voter registration" : "Registration status",
        url: value.navigationUrl!, sourceUrl: value.url, sourceOrg: value.sourceOrg, verification: value.quote, verifiedAt: value.verifiedAt,
      });
      else if (value.fieldKind === "polling_lookup" || value.fieldKind === "ballot_lookup") entry.polling.push({
        state, purpose: value.fieldKind, label: value.fieldKind === "ballot_lookup" ? "Look up your sample ballot" : "Find your polling place",
        url: value.navigationUrl!, sourceUrl: value.url, sourceOrg: value.sourceOrg, note: value.quote, verification: value.quote, verifiedAt: value.verifiedAt,
      });
      else if (LABELS[value.fieldKind] && value.electionDate) entry.dates.push({ state, electionDay: value.electionDate,
        steps: [{ label: LABELS[value.fieldKind]!, date: value.dates.join(" – "), detail: value.quote, sourceUrl: value.url,
          sourceOrg: value.sourceOrg, collectedAt: value.collectedAt, verifiedAt: value.verifiedAt }] });
    }
    index = { version, state, divisions: byDivision };
    indexed.set(projection, index);
  }
  const root = ballotNavigationDivision(state);
  const byDivision = index.divisions;
  const entries = [...new Set([root, ...divisions])].flatMap(id => byDivision.get(id) ?? []);
  const dates = new Map<string, ElectionDates>();
  for (const calendar of entries.flatMap(entry => entry.dates)) {
    const existing = dates.get(calendar.electionDay) ?? { state, electionDay: calendar.electionDay, steps: [] };
    existing.steps.push(...calendar.steps); dates.set(calendar.electionDay, existing);
  }
  return { offices: latest(entries.flatMap(entry => entry.offices), office => `${office.divisionId}:${office.phone!.replace(/\D/g, "")}`),
    registrations: latest(entries.flatMap(entry => entry.registrations), row => `${row.purpose}:${row.url}`),
    polling: latest(entries.flatMap(entry => entry.polling), row => `${row.purpose}:${row.url}`), dates: [...dates.values()] };
}
