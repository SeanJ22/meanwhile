/** Publisher-side portion of River's hourly vital signs. No database reads,
 * timers, browser processes or writes: the long-lived parent owns those.
 * A sample is an exact record on a public reader page, never an Admin view or
 * a pointer/store readback. Publishers without a page binding remain unsampled.
 */
export interface PublishedFactSample {
  readonly recordId: string;
  readonly url: string;
  /** Selector for this record's rendered container, supplied by its reader. */
  readonly selector: string;
  /** Visible values from this exact accepted record, not the source document. */
  readonly fields: readonly { selector: string; text: string }[];
}
interface Sample extends PublishedFactSample { readonly priority: number }
export interface PublicationHour {
  readonly hour: string;
  readonly facts_live: number;
  readonly facts_sampled: number;
  readonly facts_confirmed: number;
  readonly records_without_page_binding: number;
  readonly sample_failures: readonly { recordId: string; detail: string }[];
}
export interface PublicationVitalsCheckpoint {
  readonly hour: string;
  readonly facts: number;
  readonly unbound: number;
  readonly seen: readonly string[];
  readonly samples: readonly Sample[];
  readonly results: readonly { recordId: string; confirmed: boolean; detail: string }[] | null;
}
const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const hourOf = (at: string) => {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) throw Error("PUBLICATION_VITAL_TIME_INVALID");
  return new Date(Math.floor(time / 3_600_000) * 3_600_000).toISOString();
};

/** One collector per UTC hour; the writer persists checkpoint() with its
 * partial row every ten minutes, and restores it before accepting events.
 * Three smallest independent random priorities form a uniform reservoir.
 */
export class PublicationVitals {
  private facts = 0;
  private unbound = 0;
  private seen = new Set<string>();
  private samples: Sample[] = [];
  private results: PublicationVitalsCheckpoint["results"] = null;
  private sampling: Promise<PublicationHour> | null = null;
  private readonly random: () => number;
  readonly hour: string;
  constructor(at: string, random: () => number = Math.random, restored?: PublicationVitalsCheckpoint) {
    this.random = random;
    this.hour = hourOf(at);
    if (restored) {
      if (restored.hour !== this.hour) throw Error("PUBLICATION_VITAL_RESTORE_HOUR_MISMATCH");
      this.facts = restored.facts; this.unbound = restored.unbound;
      this.seen = new Set(restored.seen); this.samples = structuredClone([...restored.samples]);
      this.results = structuredClone(restored.results);
    }
  }
  published(event: { id: string; at: string; changedRecords: number; samples?: readonly PublishedFactSample[] }): void {
    if (hourOf(event.at) !== this.hour) throw Error("PUBLICATION_VITAL_EVENT_HOUR_MISMATCH");
    if (this.seen.has(event.id)) return;
    if (this.sampling || this.results) throw Error("PUBLICATION_VITAL_HOUR_CLOSED");
    const samples = event.samples ?? [];
    if (!Number.isSafeInteger(event.changedRecords) || event.changedRecords < 0 || samples.length > event.changedRecords ||
        new Set(samples.map(s => s.recordId)).size !== samples.length) throw Error("PUBLICATION_VITAL_COUNT_INVALID");
    const prepared = samples.map(sample => {
      const url = new URL(sample.url);
      if (url.protocol !== "https:" || url.hostname !== "meanwhileusa.com" || url.username || url.password || url.port ||
          url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || !sample.recordId || !sample.selector ||
          !sample.fields.length || new Set(sample.fields.map(field => field.selector)).size !== sample.fields.length ||
          sample.fields.some(field => !field.selector || !normalize(field.text))) throw Error("PUBLICATION_VITAL_PUBLIC_PAGE_REQUIRED");
      const priority = this.random();
      if (!Number.isFinite(priority) || priority < 0 || priority >= 1) throw Error("PUBLICATION_VITAL_RANDOM_INVALID");
      return { ...sample, fields: structuredClone([...sample.fields]), priority };
    });
    this.seen.add(event.id); this.facts += event.changedRecords;
    this.unbound += event.changedRecords - samples.length;
    this.samples = [...this.samples, ...prepared].sort((a, b) => a.priority - b.priority).slice(0, 3);
  }
  checkpoint(): PublicationVitalsCheckpoint {
    return structuredClone({ hour: this.hour, facts: this.facts, unbound: this.unbound, seen: [...this.seen], samples: this.samples, results: this.results });
  }
  reading(): PublicationHour {
    return { hour: this.hour, facts_live: this.facts, facts_sampled: this.results?.length ?? 0,
      facts_confirmed: this.results?.filter(r => r.confirmed).length ?? 0, records_without_page_binding: this.unbound,
      sample_failures: this.results?.filter(r => !r.confirmed).map(({ recordId, detail }) => ({ recordId, detail })) ?? [] };
  }
  /** Called once after the hour closes. The parent supplies its supervised
   * browser read: final URL, HTTP status and the one matching visible container.
   * Promise reuse prevents concurrent ten-minute flushes repeating the probes.
   */
  sample(readPage: (sample: PublishedFactSample) => Promise<{
    url: string; status: number;
    /** Each record container, with visible text matches for each relative field selector. */
    matches: readonly { fields: Readonly<Record<string, readonly string[]>> }[];
  }>): Promise<PublicationHour> {
    if (this.results) return Promise.resolve(this.reading());
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      const results: { recordId: string; confirmed: boolean; detail: string }[] = [];
      for (const sample of this.samples) {
        try {
          const page = await readPage(sample);
          const confirmed = page.status === 200 && page.url === sample.url && page.matches.length === 1 &&
            sample.fields.every(field => {
              const values = page.matches[0].fields[field.selector] ?? [];
              return values.length === 1 && normalize(values[0]) === normalize(field.text);
            });
          results.push({ recordId: sample.recordId, confirmed, detail: confirmed ? "Exact record values found on its public reader page" : "Public page did not show the exact record and values" });
        } catch {
          results.push({ recordId: sample.recordId, confirmed: false, detail: "Public reader page could not be checked" });
        }
      }
      this.results = results;
      return this.reading();
    })();
    return this.sampling;
  }
}

// Attach to the existing append-only flow log identity, shared by publication
// jobs in one parent. Counts use newly appended LIVE receipts, not rechecks.
type FlowLog = object;
const collectors = new WeakMap<FlowLog, (at: string) => PublicationVitals>();
const issues = new WeakMap<FlowLog, Map<string, string>>();
/** Writer must report unknown publication totals when this is non-null. */
export const publicationVitalsIssue = (log: FlowLog, at: string): string | null =>
  issues.get(log)?.get(hourOf(at)) ?? issues.get(log)?.get("UNKNOWN") ?? null;
export function observePublicationVitals(log: FlowLog, forHour: (at: string) => PublicationVitals): () => void {
  collectors.set(log, forHour);
  return () => { if (collectors.get(log) === forHour) collectors.delete(log); };
}
export function notePublishedRecords(log: FlowLog, event: Parameters<PublicationVitals["published"]>[0]): void {
  try { collectors.get(log)?.(event.at).published(event); }
  catch {
    const history = issues.get(log) ?? new Map<string, string>();
    history.set(Number.isFinite(Date.parse(event.at)) ? hourOf(event.at) : "UNKNOWN", "Publication observation failed; hourly totals are incomplete");
    for (const key of [...history.keys()].sort().slice(0, Math.max(0, history.size - 48))) history.delete(key);
    issues.set(log, history);
  }
}
