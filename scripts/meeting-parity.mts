/**
 * Compares the meetings the live meeting API returns for 50 random ZIPs, one in each of 50 states, with the meetings the fact store holds
 * for the same bodies. Reads only: the API over HTTP and the fact store through the read-only connection.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/meeting-parity.mts [--zips=50] [--seed=1] [--dump=file]
 *
 * The window is 90 days back and 90 days ahead. A meeting the API shows that the fact store lacks, or holds with another date, time,
 * place, point or agenda link, is a difference; one only the fact store holds is an addition.
 */
import { writeFileSync } from "node:fs";
import { MEETING_FACT_ROWS_SQL } from "../lib/facts/meeting-read.ts";
import { composeSittings } from "../lib/reader/sittings.ts";
import { differences, type Shown } from "../lib/facts/meeting-parity.ts";
import { calendarStatus, type CalendarDoor } from "../lib/meetings/calendar-status.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import type { Query } from "../lib/facts/publish.ts";

const args = new Map(process.argv.slice(2).map(arg => { const [key, value] = arg.replace(/^--/, "").split("="); return [key!, value ?? "true"] as const; }));
const SITE = args.get("site") ?? PUBLIC_SITE_ORIGIN, COUNT = Number(args.get("zips") ?? 50), SEED = args.get("seed") ?? "1";
const DAY = 86_400_000, NOW = new Date(), FROM = NOW.getTime() - 90 * DAY, TO = NOW.getTime() + 90 * DAY;
const URL_READ = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!URL_READ) throw new Error("WTP_PRODUCTION_DATABASE_URL_READONLY is not set");

const host = new URL(URL_READ).hostname;
const query: Query = async (text, params = []) => {
  const response = await fetch(`https://${host}/sql`, { method: "POST", headers: { "Neon-Connection-String": URL_READ, "Neon-Batch-Read-Only": "true", "Content-Type": "application/json" },
    body: JSON.stringify({ query: text, params }), signal: AbortSignal.timeout(110_000) });
  const body = await response.json() as { rows?: unknown[]; fields?: { name: string }[]; message?: string };
  if (!body.rows) throw new Error(body.message ?? "read failed");
  return body.rows.map(row => Array.isArray(row) ? Object.fromEntries(body.fields!.map((field, index) => [field.name, row[index]])) : row as Record<string, unknown>);
};

/** The control plane's door records, read only: a place's last-checked time and dark sources come from the doors that read its calendars. */
const CP_URL = process.env.WTP_CONTROL_PLANE_DATABASE_URL_READONLY;
async function doorsFor(bodyIds: readonly string[], ocdIds: readonly string[]): Promise<CalendarDoor[]> {
  if (!CP_URL || (!bodyIds.length && !ocdIds.length)) return [];
  const response = await fetch(`https://${new URL(CP_URL).hostname}/sql`, { method: "POST", headers: { "Neon-Connection-String": CP_URL, "Neon-Batch-Read-Only": "true", "Content-Type": "application/json" },
    body: JSON.stringify({ query: `SELECT value->>'doorId' AS "doorId", value->>'kind' AS kind, value->>'ocdId' AS "ocdId", value->'bodyIds' AS "bodyIds", value->>'status' AS status,
      value->>'lastSuccessAt' AS "lastSuccessAt", value->>'lastFailureAt' AS "lastFailureAt" FROM cp_doors WHERE value->>'doorId' LIKE 'meetings:%'
      AND (EXISTS (SELECT 1 FROM jsonb_array_elements_text(value->'bodyIds') b WHERE b = ANY($1::text[])) OR value->>'ocdId' = ANY($2::text[]))`, params: [bodyIds, ocdIds] }), signal: AbortSignal.timeout(110_000) });
  const body = await response.json() as { rows?: unknown[]; fields?: { name: string }[]; message?: string };
  if (!body.rows) throw new Error(body.message ?? "door read failed");
  return body.rows.map(row => (Array.isArray(row) ? Object.fromEntries((body.fields ?? []).map((field, index) => [field.name, row[index]])) : row) as unknown as CalendarDoor);
}

/** One ZIP in each state, the same ones for the same seed. */
async function pickZips(): Promise<{ zip: string; state: string }[]> {
  const rows = await query(`SELECT l.zip, l.postal::jsonb->>'state' AS state FROM zip_location l
    WHERE EXISTS (SELECT 1 FROM place_page p WHERE p.place_id = 'zip:' || l.zip) ORDER BY md5(l.zip || $1)`, [SEED]);
  const seen = new Map<string, string>();
  for (const row of rows) if (typeof row.state === "string" && /^[A-Z]{2}$/.test(row.state) && !["DC", "PR", "GU", "VI", "AS", "MP"].includes(row.state) && !seen.has(row.state)) seen.set(row.state, String(row.zip));
  return [...seen].slice(0, COUNT).map(([state, zip]) => ({ zip, state }));
}


interface ApiPlace { meetings: Shown[]; snapshot: { generatedAt: string; failed: { source: string }[] } | null; coverage: { bodies: { bodyId?: string }[] }; governingOcdIds?: string[] }
async function apiPlace(zip: string): Promise<ApiPlace> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${SITE}/api/meetings?zip=${zip}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return (await response.json()) as ApiPlace;
    if (attempt >= 2) throw new Error(`${zip}: HTTP ${response.status}`);
  }
}

const inWindow = (m: { startsAt: string }) => { const at = Date.parse(m.startsAt); return at >= FROM && at <= TO; };

const zips = await pickZips();
const placeLosses = { lastCheckedLost: 0, lastCheckedOlder: 0, failedNoteLost: 0, carriedNoteLost: 0 };
const report = { site: SITE, at: NOW.toISOString(), zips: zips.length, before: 0, matched: 0, missing: 0, changed: 0, added: 0, byKind: {} as Record<string, number>, missingBySource: {} as Record<string, number>, perZip: [] as unknown[] };
const differing: { zip: string; state: string; differences: string[]; meeting: Shown }[] = [];
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
for (const { zip, state } of zips) {
  const place = await apiPlace(zip);
  const shown = place.meetings.filter(inWindow);
  const bodies = new Map<string, Shown>();
  for (const meeting of shown) if (meeting.bodyId && !bodies.has(meeting.bodyId)) bodies.set(meeting.bodyId, meeting);
  const rows = bodies.size ? await query(MEETING_FACT_ROWS_SQL, [[...bodies.keys()], new Date(FROM).toISOString()]) : [];
  const held = composeSittings(rows, id => { const seed = bodies.get(id)!; return { name: seed.bodyName, ocdId: seed.ocdId, jurisdiction: seed.jurisdiction }; }, NOW).meetings.filter(inWindow);
  const byId = new Map(held.flatMap(meeting => [[meeting.id, meeting] as const, ...(meeting.mergedMeetingIds ?? []).map(id => [id, meeting] as const)]));
  const ids = new Set<string>();
  let missing = 0, changed = 0, matched = 0;
  for (const meeting of shown) {
    const found = [meeting.id, ...meeting.mergedMeetingIds ?? []].map(id => byId.get(id)).find(Boolean);
    if (!found) { missing++; differing.push({ zip, state, differences: ["missing"], meeting }); bump(report.missingBySource, meeting.id.split(":")[0]!); continue; }
    ids.add(found.id);
    const diff = differences(meeting, found);
    if (diff.length) { changed++; differing.push({ zip, state, differences: diff, meeting }); for (const kind of diff) bump(report.byKind, kind); } else matched++;
  }
  // A place shows when its sources were last checked, which of them are dark, and which sittings are carried: from the doors that read its calendars.
  const placeBodies = [...new Set([...bodies.keys(), ...place.coverage.bodies.flatMap(body => body.bodyId ? [body.bodyId] : [])])];
  const status = calendarStatus(await doorsFor(placeBodies, place.governingOcdIds ?? []), { bodyIds: placeBodies, divisionIds: place.governingOcdIds ?? [] }, held);
  if (place.snapshot) {
    if (status.lastCheckedAt === null) placeLosses.lastCheckedLost++;
    else if (Date.parse(status.lastCheckedAt) < Date.parse(place.snapshot.generatedAt) - DAY) placeLosses.lastCheckedOlder++;
    if (place.snapshot.failed.length && !status.failed.length) placeLosses.failedNoteLost++;
  }
  placeLosses.carriedNoteLost += shown.filter(meeting => meeting.carried && ![meeting.id, ...meeting.mergedMeetingIds ?? []].some(id => status.carried.has(id) || held.some(sitting => status.carried.has(sitting.id) && (sitting.id === id || sitting.mergedMeetingIds?.includes(id))))).length;
  const added = held.filter(meeting => !ids.has(meeting.id) && ![meeting.id, ...meeting.mergedMeetingIds ?? []].some(id => shown.some(s => s.id === id || s.mergedMeetingIds?.includes(id)))).length;
  report.before += shown.length; report.matched += matched; report.missing += missing; report.changed += changed; report.added += added;
  report.perZip.push({ zip, state, before: shown.length, matched, missing, changed, added });
  console.error(`${state} ${zip}: ${shown.length} shown, ${matched} identical, ${changed} changed, ${missing} missing, ${added} added`);
}
(report as Record<string, unknown>).placeLosses = placeLosses;
if (args.get("dump")) writeFileSync(args.get("dump")!, JSON.stringify(differing));
console.log(JSON.stringify(report, null, 2));
