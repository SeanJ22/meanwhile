/** Plain labels and Eastern times shared by the measured cost screens. */
import { EASTERN_ZONE, easternLocalToIso } from "../eastern-time.ts";
export function roleWords(role: string): string {
  return ({ SCOUT: "Research", ACQUIRER: "Acquisition", CURATOR: "Curation", CLERK: "Meeting records", DETECTIVE: "Repair", AUDITOR: "Auditing", ASK: "Ask", BUILDER: "Building records", COACH: "Coordination", PORTRAIT: "Portraits" } as Record<string, string>)[role] ?? "Other work";
}
export function moneyTime(iso: string | null): string {
  return iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso)) : "—";
}
export function measuredHuntSpend(hunt: { reportedSpendUsd?: number | null }): number | null {
  return typeof hunt.reportedSpendUsd === "number" && Number.isFinite(hunt.reportedSpendUsd) ? hunt.reportedSpendUsd : null;
}

export const dayInEastern = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function yesterdayWindow(now: string): { from: string; through: string } {
  const today = dayInEastern(now);
  const previous = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { from: easternLocalToIso(`${previous}T00:00`)!, through: easternLocalToIso(`${today}T00:00`)! };
}

