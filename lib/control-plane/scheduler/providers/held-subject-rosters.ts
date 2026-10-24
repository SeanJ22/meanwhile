import type { Query } from "../../../facts/publish.ts";
import type { BodyFacts } from "../../../facts/registry-overlay.ts";
import { nameKey } from "../../../facts/roster-facts.ts";
import { rosterMemberId } from "../../../facts/roster-read.ts";
import type { BodyRoster } from "../../../registry/body-rosters.ts";
import type { RegistryRuntimeReadModel } from "../../../registry/runtime-data-plane.ts";
import { withStateRegistryFacts } from "../../../registry/state-composition.ts";

/** The published membership's minimum identity; person contacts and saved source contents stay on the server. */
export const HELD_MEMBER_FACTS_SQL = `SELECT f.entity_id body_id,substr(f.field,8) person_id,
    f.value->>'name' name,f.value->>'office' office_title,s.final_url source_url,f.checked_at
  FROM fact f JOIN entity b ON b.id=f.entity_id AND b.kind='body'
    JOIN entity p ON p.id=substr(f.field,8) AND p.kind='person'
    JOIN source_copy s ON s.id=f.source_copy_id
  WHERE f.status='live' AND f.field LIKE 'member:%' AND jsonb_typeof(f.value)='object'
    AND jsonb_typeof(f.value->'name')='string' AND length(trim(f.value->>'name'))>0
    AND jsonb_typeof(f.value->'office')='string' AND length(trim(f.value->>'office'))>0`;

export const HELD_ROSTER_SUBJECTS_SQL = `SELECT * FROM (${HELD_MEMBER_FACTS_SQL}) member
  WHERE body_id=ANY($1::text[]) AND checked_at<=$2::timestamptz ORDER BY body_id,person_id`;

const publicUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

/** Live memberships join only bodies already held in this provider's selected state. */
export async function readHeldRosterSubjects(query: Query, registry: RegistryRuntimeReadModel, state: string, now: string):
  Promise<{ readonly registry: RegistryRuntimeReadModel; readonly identityGaps: readonly string[] }> {
  if (!/^[a-z]{2}$/i.test(state)) return { registry, identityGaps: [] };
  const own = new RegExp(`/(?:state|territory|district):${state.toLowerCase()}(?:/|$)`);
  const divisions = new Set(registry.registry.divisions.filter(division => own.test(division.ocdId)).map(division => division.ocdId));
  const bodies = new Map(registry.registry.bodies.filter(body => body.id && body.name && body.bodyClass && publicUrl(body.provenance?.sourceUrl) &&
    [body.ocdId, ...body.alsoServesOcdIds ?? []].some(id => id && divisions.has(id))).map(body => [body.id, body]));
  if (!bodies.size) return { registry, identityGaps: [] };
  const rosters = new Map<string, BodyRoster>(), identityGaps: string[] = [];
  for (const row of await query(HELD_ROSTER_SUBJECTS_SQL, [[...bodies.keys()], now])) {
    const body = bodies.get(String(row.body_id));
    const checked = new Date(row.checked_at as string | Date).getTime();
    if (!body || typeof row.person_id !== "string" || !row.person_id || typeof row.name !== "string" || !row.name.trim() ||
      typeof row.office_title !== "string" || !row.office_title.trim() || !publicUrl(row.source_url) || !Number.isFinite(checked) || checked > Date.parse(now)) continue;
    const native = registry.bodyRosters.find(roster => roster.bodyId === body.id)?.members ?? [];
    const canonical = (member: typeof native[number]) => member.personId ?? member.id;
    const matches = native.filter(member => canonical(member) === row.person_id);
    const id = matches.length === 1 ? matches[0]!.id : rosterMemberId(body.id, row.person_id);
    if (matches.length > 1 || native.some(member => member.id === id && canonical(member) !== row.person_id) ||
      !matches.length && native.some(member => nameKey(member.name) === nameKey(String(row.name)))) {
      identityGaps.push(`${body.id}:${row.person_id}`); continue;
    }
    const at = new Date(checked).toISOString(), source = { sourceUrl: row.source_url, sourceOrg: new URL(row.source_url).hostname, collectedAt: at };
    const roster = rosters.get(body.id) ?? { bodyId: body.id, bodyName: body.name!, ...source, partisanship: "UNDETERMINED" as const, members: [] };
    if (checked > Date.parse(roster.collectedAt)) Object.assign(roster, source);
    roster.members.push({ id, personId: row.person_id, name: row.name, officeTitle: row.office_title, membershipSource: source,
      termNote: null, email: null, phone: null, websiteUrl: null });
    rosters.set(body.id, roster);
  }
  const facts: BodyFacts[] = [...rosters.values()].map(roster => ({ id: roster.bodyId, division: bodies.get(roster.bodyId)!.ocdId ?? "",
    fields: {}, roster, dispositions: [], comment: null, sittings: [] }));
  return { registry: withStateRegistryFacts(registry, facts), identityGaps };
}
