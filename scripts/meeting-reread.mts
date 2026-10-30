/**
 * Re-reads, now, the public pages behind the meetings the live API shows and publishes each listing the way the door does into a
 * scratch fact store in memory. Nothing in production is written: each publisher's pages are read at its own pace, and the
 * scratch store is thrown away. It reports how many of the meetings the API shows the fact store would then show the same.
 *
 * The input is a file holding `{ shown, listings }`: the meetings the API shows, and the listing rows (one per source) behind them.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/meeting-reread.mts input.json [--pace=360] [--out=outcomes.json]
 *
 * --pace is seconds between two reads of one small publisher's host (default 360, which is 10 an hour).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { vaultCapture } from "../lib/facts/capture.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { MEETING_FACT_ROWS_SQL } from "../lib/facts/meeting-read.ts";
import { composeSittings } from "../lib/reader/sittings.ts";
import { publishCapturedMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { makeLegistarInSiteSource } from "../lib/sources/legistar-insite/index.ts";
import { readCivicClerkPages, type CivicClerkPage } from "../lib/sources/civicclerk/index.ts";
import { publishedBodyLabel } from "../lib/civic-data/published-body-name.ts";
import { differences, type Shown } from "../lib/facts/meeting-parity.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factDb } from "../tests/helpers/fact-db.ts";

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith("--"));
if (!file) throw new Error("usage: meeting-reread.mts input.json");
const PACE_MS = Number(args.find(arg => arg.startsWith("--pace="))?.slice(7) ?? 360) * 1000;
const DAY = 86_400_000, NOW = new Date(), TODAY = Math.floor(NOW.getTime() / DAY) * DAY, FROM = new Date(TODAY - 90 * DAY), TO = new Date(TODAY + 90 * DAY);
const { shown, listings } = JSON.parse(readFileSync(file, "utf8")) as { shown: Shown[]; listings: Meeting[] };

/** A read page is kept in --cache so a second look at the same pages asks the publisher for nothing. */
const CACHE = args.find(arg => arg.startsWith("--cache="))?.slice(8);
if (CACHE) mkdirSync(CACHE, { recursive: true });
const cachePath = (key: string) => `${CACHE}/${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`;
const kept = <T,>(key: string): T | null => CACHE && existsSync(cachePath(key)) ? JSON.parse(readFileSync(cachePath(key), "utf8")) as T : null;
const keep = (key: string, value: unknown) => { if (CACHE) writeFileSync(cachePath(key), JSON.stringify(value)); };
const lastRead = new Map<string, number>();
type Page = { bytes: Uint8Array; status: number; contentType: string; at: string };
const pages = new Map<string, Promise<Page | null>>();
/** One read of a public page, at most once per run, spaced from the last read of the same host. */
function read(url: string) {
  let held = pages.get(url);
  if (!held) {
    held = (async () => {
      const cached = kept<{ b64: string; status: number; contentType: string; at: string }>(url);
      if (cached) return { bytes: new Uint8Array(Buffer.from(cached.b64, "base64")), status: cached.status, contentType: cached.contentType, at: cached.at };
      const host = new URL(url).hostname;
      // The Census geocoder is a national service; every publisher's own host is read at the slow pace.
      const wait = (lastRead.get(host) ?? 0) + (host === "geocoding.geo.census.gov" ? 2000 : PACE_MS) - Date.now();
      lastRead.set(host, Date.now() + Math.max(0, wait));
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      try {
        const response = await fetch(url, { headers: { "user-agent": "MeanwhileBot/1.0 (+https://meanwhileusa.com)", accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
        const page = { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status, contentType: response.headers.get("content-type") ?? "text/html", at: new Date().toISOString() };
        keep(url, { b64: Buffer.from(page.bytes).toString("base64"), status: page.status, contentType: page.contentType, at: page.at });
        return page;
      } catch (error) { console.error(`read ${url}: ${error instanceof Error ? error.message : error}`); return null; }
    })();
    pages.set(url, held);
  }
  return held;
}

const odata = (date: Date) => date.toISOString().replace(/\.\d+Z$/, "Z");
const legistarDate = (date: Date) => `datetime'${date.toISOString().slice(0, 10)}'`;
/** What a sitting's own calendar page cannot give: these ride on other facts, built after the calendar facts are right. */
const EXTRAS = new Set(["acting body lost", "listing alias lost", "field source lost", "carried note lost"]);
const ONLY = args.find(arg => arg.startsWith("--only="))?.slice(7);
const SOURCES = ["legistar-insite", "civicclerk", "legistar"];
const unwrap = (meeting: Meeting) => ({ source: meeting.id.split(":")[0]!, origin: new URL(meeting.provenance.sourceUrl ?? "https://x.invalid"), client: meeting.id.split(":")[1]! });

const vault = new MemoryEvidenceStore();
const db = await factDb();
async function save(url: string, bytes: Uint8Array, status: number, contentType: string, at: string): Promise<WorkerPublicationCapture | null> {
  if (status >= 400) return null;
  const saved = await vaultCapture({ vault, url, bytes, httpStatus: status, contentType, retrievedAt: at });
  return "error" in saved ? null : saved.capture;
}
async function capture(url: string): Promise<WorkerPublicationCapture | null> {
  const page = await read(url);
  return page ? save(url, page.bytes, page.status, page.contentType, page.at) : null;
}

/** The pages one publisher's calendar is read from, the way the door reads them: every window and pager page of a Legistar InSite grid, every page of a CivicClerk list, one Legistar API list. */
async function calendarPages(sample: Meeting): Promise<{ captures: WorkerPublicationCapture[]; text: string } | null> {
  const { source, origin, client } = unwrap(sample);
  const recorded: { url: string; bytes: Uint8Array; status: number; type: string; at: string }[] = [];
  if (source === "legistar-insite") {
    const savedGrid = kept<{ url: string; b64: string; status: number; type: string; at: string }[]>(`insite|${origin.hostname}`);
    if (savedGrid) for (const row of savedGrid) recorded.push({ url: row.url, bytes: new Uint8Array(Buffer.from(row.b64, "base64")), status: row.status, type: row.type, at: row.at });
    else {
    const recording: typeof fetch = async (input, init) => {
      const response = await fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "user-agent": "MeanwhileBot/1.0 (+https://meanwhileusa.com)" } });
      recorded.push({ url: String(input instanceof Request ? input.url : input), bytes: new Uint8Array(await response.clone().arrayBuffer()), status: response.status, type: response.headers.get("content-type") ?? "text/html", at: new Date().toISOString() });
      return response;
    };
    const tenant = { slug: origin.hostname.split(".")[0]!, host: origin.hostname, ocdId: sample.ocdId, bodyId: sample.bodyId ?? "", bodyNames: [], bodyName: sample.bodyName, jurisdiction: sample.jurisdiction, publishingOrg: sample.bodyName, timeZone: sample.timeZone, clerkScheduleUrl: null };
    try { await makeLegistarInSiteSource({ fetchImpl: recording, tenants: [tenant as never] }).fetch({ lat: 0, lng: 0, radiusKm: 1 } as never); } catch { /* the pages read before the failure still count */ }
    keep(`insite|${origin.hostname}`, recorded.map(row => ({ url: row.url, b64: Buffer.from(row.bytes).toString("base64"), status: row.status, type: row.type, at: row.at })));
    }
  } else if (source === "civicclerk") {
    const tenant = origin.hostname.split(".")[0]!;
    const start = `https://${tenant}.api.civicclerk.com/v1/Events?$filter=${encodeURIComponent(`eventDate ge ${odata(FROM)} and eventDate le ${odata(TO)}`)}&$orderby=id asc&$top=200`;
    await readCivicClerkPages(start, async url => {
      const page = await read(url);
      if (!page || page.status >= 400) throw new Error("CIVICCLERK_PAGE_UNREADABLE");
      recorded.push({ url, bytes: page.bytes, status: page.status, type: page.contentType, at: page.at });
      return JSON.parse(new TextDecoder().decode(page.bytes)) as CivicClerkPage<{ id: number }>;
    }).catch(error => { console.error(`${tenant}: ${error instanceof Error ? error.message : error}`); return []; });
  } else if (source === "legistar") {
    const url = `https://webapi.legistar.com/v1/${client}/events?$filter=${encodeURIComponent(`EventId gt 0 and EventDate ge ${legistarDate(FROM)} and EventDate le ${legistarDate(TO)}`)}&$orderby=EventId&$top=1000`;
    const page = await read(url);
    if (page) recorded.push({ url, bytes: page.bytes, status: page.status, type: page.contentType, at: page.at });
  }
  const captures: WorkerPublicationCapture[] = [];
  for (const row of recorded) { const saved = await save(row.url, row.bytes, row.status, row.type, row.at); if (saved) captures.push(saved); }
  return captures.length ? { captures, text: recorded.map(row => new TextDecoder().decode(row.bytes)).join("\n") } : null;
}

const report = { shown: shown.length, listings: listings.length, unreadSource: 0, bodyNotFiled: 0, pageMissing: 0, recovered: 0, stillDifferent: 0,
  bySource: {} as Record<string, { listings: number; pageMissing: number }>, remaining: {} as Record<string, number>, blanks: {} as Record<string, number> };
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
const families = new Map<string, Meeting[]>();
const missing = new Set<string>();
for (const listing of listings) {
  const { source, origin, client } = unwrap(listing);
  const bucket = report.bySource[source] ??= { listings: 0, pageMissing: 0 };
  bucket.listings++;
  if (!SOURCES.includes(source) || (ONLY && !ONLY.split(",").includes(source))) continue;
  const key = source === "legistar" ? `${source}|${client}` : `${source}|${origin.hostname.split(".")[0]}`;
  families.set(key, [...families.get(key) ?? [], listing]);
}
// Each publisher is read once, at its own pace; different publishers are read side by side.
await Promise.all([...families].map(async ([family, meetings]) => {
  const pagesRead = await calendarPages(meetings[0]!);
  console.error(`${family}: ${meetings.length} listings, ${pagesRead?.captures.length ?? 0} pages read`);
  if (!pagesRead) { for (const meeting of meetings) { missing.add(meeting.id); report.bySource[unwrap(meeting).source]!.pageMissing++; } return; }
  const captures = [...pagesRead.captures];
  for (const meeting of meetings) if (meeting.mapPin?.coordinateSourceUrl && !captures.some(c => c.evidence.canonicalUrl === meeting.mapPin!.coordinateSourceUrl)) {
    const pin = await capture(meeting.mapPin.coordinateSourceUrl);
    if (pin) captures.push(pin);
  }
  const sittings = meetings.map(meeting => {
    // A CivicClerk sitting names its time as the page writes it.
    const event = meeting.id.split(":").at(-1);
    const written = meeting.id.startsWith("civicclerk:") ? new RegExp(`"id":\\s*${event}\\b[\\s\\S]*?"(?:startDateTime|eventDate)":\\s*"([^"]+)"`).exec(pagesRead.text)?.[1] : undefined;
    // The scratch store holds no registry: a board the calendar labels like a sitting is filed under the board name inside the label.
    const label = publishedBodyLabel(meeting.bodyName);
    return { ...meeting, ...(label.kind !== "body" && label.name ? { bodyName: label.name } : {}), ...(written ? { startsAtOnPage: written } : {}) } as Meeting;
  });
  for (const sitting of sittings) {
    try { await publishCapturedMeetingFacts({ facts: db, meetings: [sitting], captures, producedBy: "reread", clocks: factClocks(null), now: new Date() }); }
    catch (error) { report.bodyNotFiled++; console.error(`${sitting.id}: ${error instanceof Error ? error.message : error}`); }
  }
}));
for (const row of await db.query("SELECT split_part(entity_id, ':', 2) || '|' || field AS field, reason, count(*)::int AS n FROM blank GROUP BY 1,2")) report.blanks[`${row.field}:${row.reason}`] = Number(row.n);
const blankField = args.find(arg => arg.startsWith("--show-blanks="))?.slice(14);
if (blankField) for (const row of await db.query("SELECT entity_id, reason, detail FROM blank WHERE field = $1 AND detail LIKE '{%' LIMIT 3", [blankField])) console.error(`BLANK ${row.entity_id} ${row.reason} ${String(row.detail).slice(0, 700)}`);

const bodies = new Map<string, Meeting>();
for (const meeting of listings) if (meeting.bodyId) bodies.set(meeting.bodyId, meeting);
const facts = await db.query(MEETING_FACT_ROWS_SQL, [[...bodies.keys()], FROM.toISOString()]);
const held = composeSittings(facts, id => { const seed = bodies.get(id)!; return { name: seed.bodyName, ocdId: seed.ocdId, jurisdiction: seed.jurisdiction }; }, NOW).meetings;
const debugBody = args.find(arg => arg.startsWith("--debug-body="))?.slice(13);
if (debugBody) {
  for (const row of facts.filter(fact => String(fact.body_id).includes(debugBody))) console.error(`FACT ${row.entity_id} ${row.field} ${JSON.stringify(row.value).slice(0, 100)}`);
  for (const meeting of held.filter(m => m.bodyId?.includes(debugBody))) console.error(`HELD ${meeting.id} merged=${JSON.stringify(meeting.mergedMeetingIds)} ${meeting.startsAt} ${meeting.title}`);
}
const byId = new Map(held.flatMap(meeting => [[meeting.id, meeting] as const, ...(meeting.mergedMeetingIds ?? []).map(id => [id, meeting] as const)]));
const listed = new Map(listings.map(listing => [listing.id, listing]));
const outcomes: { id: string; differences: string[]; before: Shown; after: Meeting | null }[] = [];
for (const meeting of shown) {
  const ids = [meeting.id, ...meeting.mergedMeetingIds ?? []];
  // A sitting whose listings come from a source this run cannot read is not judged.
  if (!ids.every(id => !listed.has(id) || SOURCES.includes(listed.get(id)!.id.split(":")[0]!)) || missing.has(meeting.id)) { report.unreadSource++; continue; }
  const found = ids.map(id => byId.get(id)).find(Boolean);
  const diff = found ? differences(meeting, found).filter(kind => !EXTRAS.has(kind)) : ["missing"];
  outcomes.push({ id: meeting.id, differences: diff, before: meeting, after: found ?? null });
  if (diff.length) { report.stillDifferent++; for (const kind of diff) bump(report.remaining, `${meeting.id.split(":")[0]}|${kind}`); }
  else report.recovered++;
}
const out = args.find(arg => arg.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(outcomes));
console.log(JSON.stringify(report, null, 2));
await db.pg.close();
