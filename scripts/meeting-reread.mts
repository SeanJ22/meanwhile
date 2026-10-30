/**
 * Re-reads, now, the public pages behind the meetings the parity script found missing or changed, and publishes each sitting
 * the way the door does into a scratch fact store in memory. Nothing in production is written: the pages are fetched at their
 * publisher's pace, and the scratch store is thrown away. It reports how many of those meetings the fact store would then hold
 * the same as the live API shows.
 *
 *   pnpm meetings:parity -- --dump=differing.json
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/meeting-reread.mts differing.json [--pace=360] [--out=outcomes.json]
 *
 * --pace is seconds between two reads of one publisher's host (default 360, which is 10 an hour).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { vaultCapture } from "../lib/facts/capture.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { MEETING_FACT_ROWS_SQL, meetingsFromFactRows } from "../lib/facts/meeting-read.ts";
import { publishMeetingFacts } from "../lib/facts/meeting-facts.ts";
import { differences, type Shown } from "../lib/facts/meeting-parity.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factDb } from "../tests/helpers/fact-db.ts";

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith("--"));
if (!file) throw new Error("usage: meeting-reread.mts differing.json");
const PACE_MS = Number(args.find(arg => arg.startsWith("--pace="))?.slice(7) ?? 360) * 1000;
const DAY = 86_400_000, NOW = new Date(), FROM = new Date(NOW.getTime() - 90 * DAY), TO = new Date(NOW.getTime() + 90 * DAY);
const rows = JSON.parse(readFileSync(file, "utf8")) as { zip: string; differences: string[]; meeting: Shown }[];

const lastRead = new Map<string, number>();
const pages = new Map<string, Promise<{ bytes: Uint8Array; status: number; contentType: string; at: string } | null>>();
/** One read of a public page, at most once per run, spaced from the last read of the same host. */
function read(url: string) {
  let held = pages.get(url);
  if (!held) {
    held = (async () => {
      const host = new URL(url).hostname;
      // The Census geocoder is a national service; every publisher's own host is read at the slow pace.
      const wait = (lastRead.get(host) ?? 0) + (host === "geocoding.geo.census.gov" ? 2000 : PACE_MS) - Date.now();
      lastRead.set(host, Date.now() + Math.max(0, wait));
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      try {
        const response = await fetch(url, { headers: { "user-agent": "MeanwhileBot/1.0 (+https://meanwhileusa.com)", accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
        return { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status, contentType: response.headers.get("content-type") ?? "text/html", at: new Date().toISOString() };
      } catch { return null; }
    })();
    pages.set(url, held);
  }
  return held;
}

const odata = (date: Date) => date.toISOString().replace(/\.\d+Z$/, "Z");
const legistarDate = (date: Date) => `datetime'${date.toISOString().slice(0, 10)}'`;
/** The page a sitting of this source was read from. */
function pageFor(meeting: Shown): string | null {
  const [source, , event] = meeting.id.split(":");
  const origin = new URL(meeting.provenance.sourceUrl ?? "https://x.invalid");
  if (source === "legistar-insite") return `${origin.origin}/Calendar.aspx`;
  if (source === "legistar") {
    const client = meeting.id.split(":")[1];
    return `https://webapi.legistar.com/v1/${client}/events?$filter=${encodeURIComponent(`EventId gt 0 and EventDate ge ${legistarDate(FROM)} and EventDate le ${legistarDate(TO)}`)}&$orderby=EventId&$top=1000`;
  }
  if (source === "civicclerk") {
    const tenant = origin.hostname.split(".")[0];
    void event;
    return `https://${tenant}.api.civicclerk.com/v1/Events?$filter=${encodeURIComponent(`eventDate ge ${odata(FROM)} and eventDate le ${odata(TO)}`)}&$orderby=id asc&$top=200`;
  }
  return null;
}

const vault = new MemoryEvidenceStore();
const db = await factDb();
const captured = new Map<string, WorkerPublicationCapture | null>();
async function capture(url: string): Promise<WorkerPublicationCapture | null> {
  if (captured.has(url)) return captured.get(url)!;
  const page = await read(url);
  let result: WorkerPublicationCapture | null = null;
  if (page && page.status < 400) {
    const saved = await vaultCapture({ vault, url, bytes: page.bytes, httpStatus: page.status, contentType: page.contentType, retrievedAt: page.at });
    if (!("error" in saved)) result = saved.capture;
  }
  captured.set(url, result);
  return result;
}

const report = { meetings: rows.length, pageMissing: 0, recovered: 0, stillDifferent: 0, bySource: {} as Record<string, { meetings: number; recovered: number; pageMissing: number }>, remaining: {} as Record<string, number>, blanks: {} as Record<string, number> };
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
const published = new Map<string, Shown>();
const outcomes: { id: string; differences: string[] }[] = [];
for (const { meeting } of rows) {
  const source = meeting.id.split(":")[0]!;
  const bucket = report.bySource[source] ??= { meetings: 0, recovered: 0, pageMissing: 0 };
  bucket.meetings++;
  const url = pageFor(meeting);
  const page = url ? await capture(url) : null;
  if (!page) { report.pageMissing++; bucket.pageMissing++; continue; }
  let pinPage: WorkerPublicationCapture | undefined;
  if (meeting.mapPin?.coordinateSourceUrl) pinPage = await capture(meeting.mapPin.coordinateSourceUrl) ?? undefined;
  // A CivicClerk sitting names its time as the page writes it; the page's own text is what the check reads.
  const event = meeting.id.split(":").at(-1);
  const written = source === "civicclerk" ? new RegExp(`"id":\\s*${event}\\b[\\s\\S]*?"(?:startDateTime|eventDate)":\\s*"([^"]+)"`).exec(new TextDecoder().decode((await read(url!))!.bytes))?.[1] : undefined;
  const sitting = { ...meeting, ...(written ? { startsAtOnPage: written } : {}) } as unknown as Meeting;
  await publishMeetingFacts(db, { meeting: sitting, capture: page, pinCapture: pinPage, producedBy: "reread", canceledHeld: false }, factClocks(null), new Date());
  published.set(meeting.id, meeting);
}
for (const row of await db.query("SELECT field, reason, count(*)::int AS n FROM blank GROUP BY 1,2")) report.blanks[`${row.field}:${row.reason}`] = Number(row.n);

const bodies = new Map<string, Shown>();
for (const { meeting } of rows) if (meeting.bodyId) bodies.set(meeting.bodyId, meeting);
const facts = await db.query(MEETING_FACT_ROWS_SQL, [[...bodies.keys()], FROM.toISOString()]);
const held = meetingsFromFactRows(facts, id => { const seed = bodies.get(id)!; return { name: seed.bodyName, ocdId: seed.ocdId, jurisdiction: seed.jurisdiction }; }, NOW);
const byId = new Map(held.flatMap(meeting => [[meeting.id, meeting] as const, ...(meeting.mergedMeetingIds ?? []).map(id => [id, meeting] as const)]));
for (const { meeting } of rows) {
  if (!published.has(meeting.id)) continue;
  const source = meeting.id.split(":")[0]!;
  const found = byId.get(meeting.id);
  const diff = found ? differences(meeting, found) : ["missing"];
  outcomes.push({ id: meeting.id, differences: diff });
  if (diff.length) { report.stillDifferent++; for (const kind of diff) bump(report.remaining, `${source}|${kind}`); }
  else { report.recovered++; report.bySource[source]!.recovered++; }
}
const out = args.find(arg => arg.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(outcomes));
console.log(JSON.stringify(report, null, 2));
await db.pg.close();
