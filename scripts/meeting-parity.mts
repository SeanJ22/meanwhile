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
import { MEETING_FACT_ROWS_SQL, meetingsFromFactRows } from "../lib/facts/meeting-read.ts";
import { differences, type Shown } from "../lib/facts/meeting-parity.ts";
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

/** One ZIP in each state, the same ones for the same seed. */
async function pickZips(): Promise<{ zip: string; state: string }[]> {
  const rows = await query(`SELECT l.zip, l.postal::jsonb->>'state' AS state FROM zip_location l
    WHERE EXISTS (SELECT 1 FROM place_page p WHERE p.place_id = 'zip:' || l.zip) ORDER BY md5(l.zip || $1)`, [SEED]);
  const seen = new Map<string, string>();
  for (const row of rows) if (typeof row.state === "string" && /^[A-Z]{2}$/.test(row.state) && !["DC", "PR", "GU", "VI", "AS", "MP"].includes(row.state) && !seen.has(row.state)) seen.set(row.state, String(row.zip));
  return [...seen].slice(0, COUNT).map(([state, zip]) => ({ zip, state }));
}


async function apiMeetings(zip: string): Promise<Shown[]> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${SITE}/api/meetings?zip=${zip}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (response.ok) return ((await response.json()) as { meetings: Shown[] }).meetings;
    if (attempt >= 2) throw new Error(`${zip}: HTTP ${response.status}`);
  }
}

const inWindow = (m: { startsAt: string }) => { const at = Date.parse(m.startsAt); return at >= FROM && at <= TO; };

const zips = await pickZips();
const report = { site: SITE, at: NOW.toISOString(), zips: zips.length, before: 0, matched: 0, missing: 0, changed: 0, added: 0, byKind: {} as Record<string, number>, missingBySource: {} as Record<string, number>, perZip: [] as unknown[] };
const differing: { zip: string; state: string; differences: string[]; meeting: Shown }[] = [];
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
    if (!found) { missing++; differing.push({ zip, state, differences: ["missing"], meeting }); bump(report.missingBySource, meeting.id.split(":")[0]!); continue; }
    ids.add(found.id);
    const diff = differences(meeting, found);
    if (diff.length) { changed++; differing.push({ zip, state, differences: diff, meeting }); for (const kind of diff) bump(report.byKind, kind); } else matched++;
  }
  const added = held.filter(meeting => !ids.has(meeting.id) && ![meeting.id, ...meeting.mergedMeetingIds ?? []].some(id => shown.some(s => s.id === id || s.mergedMeetingIds?.includes(id)))).length;
  report.before += shown.length; report.matched += matched; report.missing += missing; report.changed += changed; report.added += added;
  report.perZip.push({ zip, state, before: shown.length, matched, missing, changed, added });
  console.error(`${state} ${zip}: ${shown.length} shown, ${matched} identical, ${changed} changed, ${missing} missing, ${added} added`);
}
// The gate also waits on every sitting the acquisition copy holds in the window and the fact store does not yet: they re-read at the sources' own pace.
const [owed] = await query(`WITH cm AS (SELECT r.value->>'startsAt' AS starts_at, r.row_id, r.body_id FROM civic_data_rows r
  JOIN civic_data_promotions p ON p.key = r.promotion_key AND p.current_version_id = r.version_id
  WHERE r.record_class = 'MEETING' AND r.collection = 'meetings' AND r.body_id IS NOT NULL)
  SELECT count(*)::int AS meetings, count(DISTINCT body_id)::int AS bodies FROM cm WHERE starts_at ~ '^[0-9]{4}-' AND starts_at::timestamptz BETWEEN $1 AND $2
  AND NOT EXISTS (SELECT 1 FROM fact f WHERE f.entity_id = 'meeting:' || cm.row_id AND f.field = 'starts_at' AND f.status = 'live')`, [new Date(FROM).toISOString(), new Date(TO).toISOString()]);
(report as Record<string, unknown>).owedByAcquisition = owed;
if (args.get("dump")) writeFileSync(args.get("dump")!, JSON.stringify(differing));
console.log(JSON.stringify(report, null, 2));
