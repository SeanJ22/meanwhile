import { easternDay } from "./periods.ts";
import type { HourlyDatabaseTransfer } from "../../db/transfer.ts";

/** The day's reading target for both databases together. */
export const DAILY_READING_TARGET_GB = 10;

export interface DatabaseReadingDay {
  readonly day: string;
  readonly gb: number;
}
export interface DatabaseReadingView {
  readonly yesterday: DatabaseReadingDay;
  readonly today: DatabaseReadingDay;
  readonly targetGb: number;
  readonly asOf: string;
}

/** Yesterday's and today's Eastern-day reading: request plus response bytes of every hour, both databases. */
export function databaseReadingView(hours: readonly HourlyDatabaseTransfer[], asOf: string): DatabaseReadingView {
  const today = easternDay(new Date(asOf));
  const yesterday = easternDay(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000));
  const bytes = new Map<string, number>();
  for (const hour of hours) {
    const day = easternDay(new Date(hour.hour));
    bytes.set(day, (bytes.get(day) ?? 0) + hour.requestBytes + hour.responseBytes);
  }
  const of = (day: string): DatabaseReadingDay => ({ day, gb: (bytes.get(day) ?? 0) / 1e9 });
  return { yesterday: of(yesterday), today: of(today), targetGb: DAILY_READING_TARGET_GB, asOf };
}

export function databaseReadingSentence(view: DatabaseReadingView): string {
  const gb = (value: number) => `${value.toFixed(1)} GB`;
  return `Database reading: yesterday ${gb(view.yesterday.gb)}, today ${gb(view.today.gb)} so far, against the ${view.targetGb} GB a day target.`;
}
