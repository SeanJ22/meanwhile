/** The Phoenix day, `YYYY-MM-DD`. */
export function phoenixToday(now: Date = new Date()): string {
  // `en-CA` formats as ISO.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface DatedWindow {
  /** `YYYY-MM-DD`. */
  start: string;
  /** `YYYY-MM-DD`, inclusive; null for a single-day event. The calendar layer computes the exclusive end. */
  end: string | null;
}

const ISO = /(\d{4}-\d{2}-\d{2})/g;

export function windowOf(date: string): DatedWindow | null {
  const found = date.match(ISO);
  if (!found || found.length === 0) return null;
  const start = found[0];
  const last = found[found.length - 1];
  return { start, end: last !== start ? last : null };
}

export function isUpcoming(window: DatedWindow, today: string = phoenixToday()): boolean {
  return (window.end ?? window.start) >= today;
}

export function calendarableSteps<T extends { label: string; date: string }>(
  steps: readonly T[],
  today: string = phoenixToday(),
): { step: T; window: DatedWindow | null; upcoming: boolean }[] {
  return steps.map((step) => {
    const window = windowOf(step.date);
    return {
      step,
      window,
      upcoming: window !== null && isUpcoming(window, today),
    };
  });
}
