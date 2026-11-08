import type { Query } from "../facts/publish.ts";
import { identityCtes, identityHeaders } from "./place.ts";
import { PLACE_CHECKS_SQL } from "./place-builder.ts";
import { currentPlaceRow, type BodyHeaders } from "./place-identity.ts";
import { PLACE_FILE_VARIANTS, splitAgenda, type PlaceFile } from "./place-file.ts";
import { placeCheckRequest, type PlaceChecks } from "./place-checks.ts";
import { unpackPlaceContextRow } from "./place-ready.ts";

/** A saved page with the kind and state of its place. */
export const PLACE_FILE_PAGE_SQL = `SELECT p.place_id AS id,e.kind,e.state,p.version,extract(epoch FROM p.built_at)::text AS built,p.built_at::text AS built_text,
  (SELECT jsonb_object_agg(v.key,jsonb_build_object('full',v.value->'full')) FROM jsonb_each(p.context) v WHERE v.key IN ('current','history','emptyCurrent','emptyHistory')) AS context
  FROM place_page p JOIN entity e ON e.id=p.place_id WHERE e.kind IN ('place','body') AND p.context ? 'current'`;

/** The identity headers of one page, as a read of it takes them. */
const HEADERS_SQL = `WITH selected AS (SELECT $1::text AS id), ${identityCtes} SELECT ${identityHeaders()} AS headers`;

/** One saved page as its file: each saved row with the identities applied, the agenda kept apart from the brief page, and the dates its facts were checked. */
export async function buildPlaceFile(query: Query, page: Record<string, unknown>): Promise<PlaceFile> {
  const id = String(page.id), context = page.context as Record<string, Record<string, unknown>>;
  const [{ headers }] = await query(HEADERS_SQL, [id]) as { headers: BodyHeaders }[];
  const aliases = currentPlaceRow({}, headers).body_aliases as Record<string, string>;
  const canonical = (body: string): string => { let at = body; for (const seen = new Set<string>(); aliases[at] && !seen.has(at); at = aliases[at]!) seen.add(at); return at; };
  const variants: Record<string, { row: Record<string, unknown>; agenda?: ReturnType<typeof splitAgenda>["agenda"]; checks?: PlaceChecks }> = {};
  for (const name of PLACE_FILE_VARIANTS) {
    if (!context[name]) continue;
    const { brief, agenda } = splitAgenda(currentPlaceRow(unpackPlaceContextRow(context[name].full), headers, true));
    const { request } = placeCheckRequest(brief, canonical);
    const [checks] = request ? await query(PLACE_CHECKS_SQL, [...request]) : [];
    const found = checks && (checks.facts || checks.calendars) ? { facts: checks.facts ?? undefined, calendars: checks.calendars ?? undefined } as PlaceChecks : undefined;
    variants[name] = { row: brief, ...(agenda ? { agenda } : {}), ...(found ? { checks: found } : {}) };
  }
  return { v: 1, id, kind: page.kind as "place" | "body", state: (page.state as string | null)?.trim() || null, version: Number(page.version), builtAt: Number(page.built) * 1000, readAt: Date.now(), variants };
}
