import { currentElectionFields } from "../civic-data/curated-reader-read-model.ts";
import type { PublishedElectionField } from "../civic-data/election-fields.ts";

export interface DatedStep {
  label: string;
  date: string;
  detail: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  verifiedAt: string;
}

export interface ElectionDates {
  state: string;
  electionDay: string;
  steps: DatedStep[];
}

const LABELS: Readonly<Partial<Record<PublishedElectionField["value"]["fieldKind"], string>>> = {
  registration_deadline: "Voter registration",
  mail_ballot_request_deadline: "Mail-ballot request",
  early_voting: "Early voting",
};

export function currentElectionDates(): readonly ElectionDates[] {
  const calendars = new Map<string, ElectionDates>();
  for (const { value } of currentElectionFields()) {
    const label = LABELS[value.fieldKind];
    if (!label || !value.electionDate) continue;
    const key = `${value.state}:${value.electionDate}`;
    const calendar = calendars.get(key) ?? { state: value.state, electionDay: value.electionDate, steps: [] };
    calendar.steps.push({ label, date: value.dates.join(" – "), detail: value.quote,
      sourceUrl: value.url, sourceOrg: value.sourceOrg, collectedAt: value.collectedAt, verifiedAt: value.verifiedAt });
    calendars.set(key, calendar);
  }
  return [...calendars.values()];
}

export function electionDatesFor(state: string, projection: readonly ElectionDates[] = currentElectionDates(), electionDay = "2026-11-03"): ElectionDates | null {
  return projection.find(calendar => calendar.state === state && calendar.electionDay === electionDay) ?? null;
}
