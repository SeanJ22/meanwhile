/** Generated from the clock, never a fixed list. Days and months are Eastern. PURE; client-safe. */
export interface PeriodOption { readonly id: string; readonly label: string }
export interface PeriodGroup { readonly label: string | null; readonly options: readonly PeriodOption[] }

export const TODAY = "today";
export const LAST_7_DAYS = "last-7d";
export const LAST_30_DAYS = "last-30d";
const MONTH = /^(20\d\d)-(0[1-9]|1[0-2])$/;

/** The Eastern calendar day of an instant, `YYYY-MM-DD`. */
export const easternDay = (now: Date): string => now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** The Eastern calendar month of an instant, `YYYY-MM`. */
export const easternMonth = (now: Date): string => easternDay(now).slice(0, 7);

export const monthWords = (month: string): string => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function periodGroups(now: Date, earliest: string | null): readonly PeriodGroup[] {
  const current = easternMonth(now);
  const months: string[] = [];
  const stop = earliest !== null && MONTH.test(earliest) && earliest < current ? earliest : current;
  for (let m = current; ; m = previousMonth(m)) {
    months.push(m);
    if (m <= stop || months.length >= 120) break;
  }
  const rolling: PeriodGroup = { label: null, options: [{ id: TODAY, label: "Today" }, { id: LAST_7_DAYS, label: "Last 7 days" }, { id: LAST_30_DAYS, label: "Last 30 days" }] };
  const label = (m: string) => (m === current ? `This month (${monthWords(m)})` : monthWords(m));
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  if (years.length <= 1) return [rolling, { label: null, options: months.map((m) => ({ id: m, label: label(m) })) }];
  return [rolling, ...years.map((y): PeriodGroup => ({ label: y, options: months.filter((m) => m.startsWith(y)).map((m) => ({ id: m, label: label(m) })) }))];
}

export function isPeriod(id: string, now: Date, earliest: string | null): boolean {
  return periodGroups(now, earliest).some((g) => g.options.some((o) => o.id === id));
}

export function periodLabel(id: string, now: Date): string {
  if (id === TODAY) return "Today";
  if (id === LAST_7_DAYS) return "Last 7 days";
  if (id === LAST_30_DAYS) return "Last 30 days";
  return MONTH.test(id) ? (id === easternMonth(now) ? `This month (${monthWords(id)})` : monthWords(id)) : id;
}

/** The first and last Eastern day a period covers, inclusive. Today's end is today; a past month ends on its last day. */
export function periodDays(id: string, now: Date): { readonly from: string; readonly to: string } | null {
  const today = easternDay(now);
  const back = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  if (id === TODAY) return { from: today, to: today };
  if (id === LAST_7_DAYS) return { from: back(6), to: today };
  if (id === LAST_30_DAYS) return { from: back(29), to: today };
  if (!MONTH.test(id)) return null;
  const [y, m] = id.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${id}-01`, to: id === today.slice(0, 7) ? today : last };
}
