/** BR-11: Eastern capture-health counts from immutable batches; exact times stay inside the decoder. */
import { historyEvents, netlifyHistoryStore, readerQuery, type HistoryStore, type Query } from "./live.ts";
import { liveZipPlaceIndex } from "./places.ts";
import { daysBefore, periodOf } from "./slice.ts";
import type { CapturedEvent, CohortRow, TotalsRow } from "./types.ts";
import type { Sources, Loaded, TotalsQuery } from "./read.ts";

const cache = new Map<string, CapturedEvent[]>();
export function easternSources(options: { readonly history?: HistoryStore; readonly query?: Query | null } = {}): Sources {
  const events = historyEvents(options.history ?? netlifyHistoryStore(), options.history ? new Map() : cache, "America/New_York");
  const query = options.query === undefined ? readerQuery() : options.query;
  const reads = new Map<string, Promise<Loaded<CapturedEvent>>>();
  const load = (window: { from: string; to: string }) => {
    const key = `${window.from}:${window.to}`;
    let read = reads.get(key);
    if (!read) { read = events(window); reads.set(key, read); }
    return read;
  };
  const matches = (e: CapturedEvent, q: TotalsQuery) => q.family === "all" || q.family === "zip" && e.zip !== null && (!q.zips || q.zips.includes(e.zip))
    || q.family === "district" && e.district !== null && (!q.districts || q.districts.includes(e.district)) && (!q.districtState || e.district.includes(`state:${q.districtState}/`));
  return {
    places: liveZipPlaceIndex,
    events: load,
    async totals(q) {
      const read = await load({ from: periodOf(q.from, q.grain), to: q.to });
      if (read.kind !== "ROWS" || read.truncated) return read.kind !== "ROWS" ? read : { kind: "ROWS", rows: [], truncated: true };
      const groups = new Map<string, { row: TotalsRow; readers: Set<string> }>();
      for (const e of read.rows) {
        if (!matches(e, q)) continue;
        const period = periodOf(e.day, q.grain);
        const zip = q.family === "zip" ? e.zip : null;
        const district = q.family === "district" ? e.district : null;
        for (const topic of new Set(["*", e.topic])) for (const type of new Set(["*", e.type])) {
          if (q.topics && topic !== "*" && !q.topics.includes(topic)) continue;
          const key = JSON.stringify([period, zip, district, topic, type]);
          const held = groups.get(key) ?? { row: { grain: q.grain, period, zip, district, topic, type, events: 0, users: 0 }, readers: new Set<string>() };
          held.readers.add(e.reader);
          held.row = { ...held.row, events: held.row.events + 1, users: held.readers.size };
          groups.set(key, held);
        }
      }
      return { kind: "ROWS", rows: [...groups.values()].map(g => g.row) };
    },
    async cohorts(q) {
      if (!query) return { kind: "NOT_INSTALLED", detail: "The reader history could not be checked, so new and returning readers are unknown." };
      // The extra Eastern day resolves the UTC-midnight boundary of a first-ever day.
      const firstPeriod = periodOf(q.from, q.grain);
      const from = daysBefore(firstPeriod, 1);
      const read = await load({ from, to: q.to });
      if (read.kind !== "ROWS" || read.truncated) return read.kind !== "ROWS" ? read : { kind: "ROWS", rows: [], truncated: true };
      const relevant = read.rows.filter(e => q.family === "all" || q.family === "zip" && e.zip === q.key || q.family === "district" && e.district === q.key);
      const readers = [...new Set(relevant.map(e => e.reader))];
      if (!readers.length) return { kind: "ROWS", rows: [] };
      // Anonymous hashes remain internal. Earlier UTC days establish returning readers;
      // first days within this bounded archive window use their actual Eastern day.
      const earliest = await query(`SELECT reader_hash, min(period_start)::text AS first_day FROM reader_event_members
        WHERE period = 'DAY' AND zip = $1 AND district = $2 AND topic = '*' AND event_type = '*' AND reader_hash = ANY($3::text[])
        GROUP BY reader_hash`, [q.family === "zip" ? q.key ?? "" : "", q.family === "district" ? q.key ?? "" : "", readers]);
      const firstUtc = new Map(earliest.map(r => [String(r.reader_hash), String(r.first_day)]));
      if (readers.some(r => !firstUtc.has(r))) return { kind: "NOT_INSTALLED", detail: "Some archived readers have not reached the counts, so new and returning readers are unknown." };
      const firstEastern = new Map<string, string>();
      for (const e of relevant) if (!firstEastern.has(e.reader) || e.day < firstEastern.get(e.reader)!) firstEastern.set(e.reader, e.day);
      const periods = new Map<string, Set<string>>();
      for (const e of relevant) if (e.day >= firstPeriod) {
        const period = periodOf(e.day, q.grain);
        const held = periods.get(period) ?? new Set<string>(); held.add(e.reader); periods.set(period, held);
      }
      const rows: CohortRow[] = [...periods].map(([period, members]) => ({ grain: q.grain, period, readers: members.size,
        newReaders: [...members].filter(r => firstUtc.get(r)! >= from && periodOf(firstEastern.get(r)!, q.grain) === period).length }));
      return { kind: "ROWS", rows };
    },
  };
}
