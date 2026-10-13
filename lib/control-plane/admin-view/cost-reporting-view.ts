/** Eastern calendar bounds for the existing spend-and-facts query. */
import { EASTERN_ZONE, easternLocalToIso } from "../eastern-time.ts";
export const dayInEastern = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: EASTERN_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function yesterdayWindow(now: string): { from: string; through: string } {
  const today = dayInEastern(now);
  const previous = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { from: easternLocalToIso(`${previous}T00:00`)!, through: easternLocalToIso(`${today}T00:00`)! };
}
