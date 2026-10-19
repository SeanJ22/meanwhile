import type { BodyRoster, RosterReaderDisposition } from "../registry/body-rosters.ts";
import type { Query } from "./publish.ts";

const ROSTER_FACTS_SQL = `WITH members AS (
    SELECT f.entity_id AS body_id, substr(f.field, 8) AS person_id, f.value, f.quote, f.checked_at, f.provenance_kind,
      (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url
    FROM fact f
    WHERE f.status = 'live' AND f.field LIKE 'member:%' AND ($1::text[] IS NULL OR f.entity_id = ANY($1::text[])))
  SELECT m.body_id, b.name AS body_name, m.person_id, m.value, m.quote, m.checked_at, m.provenance_kind, m.url,
    coalesce((SELECT value FROM entity_external_id x WHERE x.entity_id = m.person_id AND x.scheme = 'roster-member' LIMIT 1), '') AS shown_id,
    coalesce((SELECT jsonb_object_agg(p.field, jsonb_build_object('value', p.value, 'quote', p.quote,
        'url', (SELECT ps.url FROM source_copy ps WHERE ps.id = p.source_copy_id), 'checked', p.checked_at))
      FROM fact p
      WHERE p.entity_id = m.person_id AND p.status = 'live'
        AND (p.field IN ('name', 'email', 'phone', 'website') OR p.field LIKE '%:' || m.body_id)), '{}'::jsonb) AS person
  FROM members m JOIN entity b ON b.id = m.body_id
  ORDER BY m.body_id, m.person_id`;

interface PersonField { readonly value: unknown; readonly quote: string; readonly url: string; readonly checked: string }
const day = (at: unknown) => new Date(at as string).toISOString().slice(0, 10);

/** Every body's members as readers see them, composed only from live facts and their receipts. */
export async function readFactRosters(query: Query, bodyIds: readonly string[] | null = null): Promise<{
  readonly rosters: readonly BodyRoster[]; readonly dispositions: readonly RosterReaderDisposition[];
}> {
  return factRostersFromRows(await query(ROSTER_FACTS_SQL, [bodyIds]));
}

/** The public roster composed from already selected membership and person facts. */
export function factRostersFromRows(rows: readonly Record<string, unknown>[]): { readonly rosters: readonly BodyRoster[]; readonly dispositions: readonly RosterReaderDisposition[] } {
  const byBody = new Map<string, BodyRoster>();
  const dispositions: RosterReaderDisposition[] = [];
  for (const row of rows) {
    const bodyId = String(row.body_id);
    const person = row.person as Record<string, PersonField>;
    const at = (field: string) => person[field] ?? person[`${field}:${bodyId}`];
    const membership = row.value as { name: string; office: string | null };
    const office = at("office");
    const value = (field: string) => (typeof at(field)?.value === "string" ? at(field)!.value as string : null);
    const source = (field: string, fallback: { quote: string; url: string; checked: string }) => {
      const held = at(field) ?? fallback;
      return { sourceUrl: held.url, sourceOrg: new URL(held.url).hostname, collectedAt: day(held.checked), verifiedAt: day(held.checked), quote: held.quote,
        ...(row.provenance_kind === "OFFICIAL" ? { kind: "OFFICIAL" as const } : {}) };
    };
    const own = { quote: String(row.quote), url: String(row.url), checked: String(row.checked_at) };
    const id = rosterMemberId(bodyId, String(row.person_id), String(row.shown_id));
    const fields = ["name", "office", "email", "phone", "website", "term_note", "term_start", "term_end"].filter(field => at(field));
    const roster = byBody.get(bodyId) ?? { bodyId, bodyName: String(row.body_name), members: [], sourceUrl: own.url,
      sourceOrg: new URL(own.url).hostname, collectedAt: day(own.checked), partisanship: "UNDETERMINED" as const };
    if (day(own.checked) > roster.collectedAt) Object.assign(roster, { sourceUrl: own.url, sourceOrg: new URL(own.url).hostname, collectedAt: day(own.checked) });
    roster.members.push({ id, personId: String(row.person_id), name: value("name") ?? membership.name,
      officeTitle: (typeof office?.value === "string" ? office.value : membership.office) ?? "Member",
      termNote: value("term_note"), termStart: value("term_start"), termEnd: value("term_end"),
      email: value("email"), phone: value("phone"), websiteUrl: value("website"), contactKind: "PUBLIC_OFFICE",
      membershipSource: { sourceUrl: own.url, sourceOrg: new URL(own.url).hostname, collectedAt: day(own.checked) },
      fieldSources: Object.fromEntries(fields.map(field => [{ website: "websiteUrl", term_note: "termNote", term_start: "termStart", term_end: "termEnd" }[field] ?? field,
        source(field, own)])) });
    byBody.set(bodyId, roster);
    dispositions.push({ sourceId: id, canonicalId: id, state: "READER_ELIGIBLE", reason: "Each fact checked against its saved source page." });
  }
  for (const roster of byBody.values()) {
    const phones = new Map<string, number>();
    for (const member of roster.members) if (member.phone) phones.set(member.phone, (phones.get(member.phone) ?? 0) + 1);
    for (const member of roster.members) if (member.phone) member.contactScope = (phones.get(member.phone) ?? 0) > 1 ? "SHARED_OFFICE" : "INDIVIDUAL_OFFICE";
  }
  return { rosters: [...byBody.values()], dispositions };
}

/** The id readers see for a seated person: the id already shown to readers, or one minted from the body and person. */
export const rosterMemberId = (bodyId: string, personId: string, shownId?: string | null) => shownId || `roster:${bodyId}#${personId}`;
