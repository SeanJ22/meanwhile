/**
 * Compares the meetings the live meeting API returns for 50 random ZIPs, one in each of 50 states, with the meetings the fact store holds
 * for the same bodies. Reads only: the API over HTTP and the fact store through the read-only connection.
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/meeting-parity.mts [--site=https://meanwhileusa.com] [--zips=50] [--seed=1]
 *
 * The window is 90 days back and 90 days ahead. A meeting the API shows that the fact store lacks, or holds with another date, time,
 * place, point or agenda link, is a difference; one only the fact store holds is an addition.
 */
import { MEETING_FACT_ROWS_SQL, meetingsFromFactRows } from "../lib/facts/meeting-read.ts";
import type { Query } from "../lib/facts/publish.ts";
import type { Meeting } from "../lib/sources/types.ts";

const args = new Map(process.argv.slice(2).map(arg => { const [key, value] = arg.replace(/^--/, "").split("="); return [key!, value ?? "true"] as const; }));
const SITE = args.get("site") ?? "https://meanwhileusa.com", COUNT = Number(args.get("zips") ?? 50), SEED = args.get("seed") ?? "1";
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

/** One ZIP in each state, the same ones for the same seed. */
async function pickZips(): Promise<{ zip: string; state: string }[]> {
  const rows = await query(`SELECT l.zip, l.postal::jsonb->>'state' AS state FROM zip_location l
    WHERE EXISTS (SELECT 1 FROM place_page p WHERE p.place_id = 'zip:' || l.zip) ORDER BY md5(l.zip || $1)`, [SEED]);
  const seen = new Map<string, string>();
  for (const row of rows) if (typeof row.state === "string" && /^[A-Z]{2}$/.test(row.state) && !["DC", "PR", "GU", "VI", "AS", "MP"].includes(row.state) && !seen.has(row.state)) seen.set(row.state, String(row.zip));
  return [...seen].slice(0, COUNT).map(([state, zip]) => ({ zip, state }));
}

type Shown = Pick<Meeting, "id" | "startsAt" | "bodyId" | "bodyName" | "ocdId" | "jurisdiction" | "location" | "mapPin" | "agendaUrl" | "mergedMeetingIds" | "status" | "videoUrl">;

async function apiMeetings(zip: string): Promise<Shown[]> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${SITE}/api/meetings?zip=${zip}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return ((await response.json()) as { meetings: Shown[] }).meetings;
    if (attempt >= 2) throw new Error(`${zip}: HTTP ${response.status}`);
  }
}

const inWindow = (m: { startsAt: string }) => { const at = Date.parse(m.startsAt); return at >= FROM && at <= TO; };
const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 1e-5;
const words = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const where = (m: Shown) => m.location ?? m.mapPin ?? null;

function differences(before: Shown, after: Meeting): string[] {
  const out: string[] = [];
  if (Date.parse(before.startsAt) !== Date.parse(after.startsAt)) out.push("start");
  const b = where(before), a = where(after);
  if (b && !a) out.push("place lost");
  else if (b && a && (!same(b.lat, a.lat) || !same(b.lng, a.lng))) out.push("place moved");
  if (before.mapPin && !after.mapPin) out.push("pin lost");
  else if (before.mapPin && after.mapPin && (!same(before.mapPin.lat, after.mapPin.lat) || !same(before.mapPin.lng, after.mapPin.lng))) out.push("pin moved");
  if (before.agendaUrl && !after.agendaUrl) out.push("agenda link lost");
  else if (before.agendaUrl && after.agendaUrl && words(before.agendaUrl) !== words(after.agendaUrl)) out.push("agenda link changed");
  if (before.status === "CANCELED" && after.status !== "CANCELED") out.push("cancellation lost");
  return out;
}

const zips = await pickZips();
const report = { site: SITE, at: NOW.toISOString(), zips: zips.length, before: 0, matched: 0, missing: 0, changed: 0, added: 0, byKind: {} as Record<string, number>, missingBySource: {} as Record<string, number>, perZip: [] as unknown[] };
const bump = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
for (const { zip, state } of zips) {
  const shown = (await apiMeetings(zip)).filter(inWindow);
  const bodies = new Map<string, Shown>();
  for (const meeting of shown) if (meeting.bodyId && !bodies.has(meeting.bodyId)) bodies.set(meeting.bodyId, meeting);
  const rows = bodies.size ? await query(MEETING_FACT_ROWS_SQL, [[...bodies.keys()], new Date(FROM).toISOString()]) : [];
  const held = meetingsFromFactRows(rows, id => { const seed = bodies.get(id)!; return { name: seed.bodyName, ocdId: seed.ocdId, jurisdiction: seed.jurisdiction }; }, NOW).filter(inWindow);
  const byId = new Map(held.flatMap(meeting => [[meeting.id, meeting] as const, ...(meeting.mergedMeetingIds ?? []).map(id => [id, meeting] as const)]));
  const ids = new Set<string>();
  let missing = 0, changed = 0, matched = 0;
  for (const meeting of shown) {
    const found = [meeting.id, ...meeting.mergedMeetingIds ?? []].map(id => byId.get(id)).find(Boolean);
    if (!found) { missing++; bump(report.missingBySource, meeting.id.split(":")[0]!); continue; }
    ids.add(found.id);
    const diff = differences(meeting, found);
    if (diff.length) { changed++; for (const kind of diff) bump(report.byKind, kind); } else matched++;
  }
  const added = held.filter(meeting => !ids.has(meeting.id) && ![meeting.id, ...meeting.mergedMeetingIds ?? []].some(id => shown.some(s => s.id === id || s.mergedMeetingIds?.includes(id)))).length;
  report.before += shown.length; report.matched += matched; report.missing += missing; report.changed += changed; report.added += added;
  report.perZip.push({ zip, state, before: shown.length, matched, missing, changed, added });
  console.error(`${state} ${zip}: ${shown.length} shown, ${matched} identical, ${changed} changed, ${missing} missing, ${added} added`);
}
console.log(JSON.stringify(report, null, 2));
