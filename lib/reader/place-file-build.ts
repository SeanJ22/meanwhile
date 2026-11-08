import type { Query } from "../facts/publish.ts";
import { identityCtes, identityHeaders } from "./place.ts";
import { PLACE_CHECKS_SQL } from "./place-builder.ts";
import { currentPlaceRow, type BodyHeaders } from "./place-identity.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import type { Meeting } from "../sources/types.ts";
import { PLACE_FILE_VARIANTS, splitAgenda, type PlaceFile, type PlacePin } from "./place-file.ts";
import { placeCheckRequest, type PlaceChecks } from "./place-checks.ts";
import { unpackPlaceContextRow } from "./place-ready.ts";

/** A saved page with the kind and state of its place. */
export const PLACE_FILE_PAGE_SQL = `SELECT p.place_id AS id,e.kind,e.state,p.version,extract(epoch FROM p.built_at)::text AS built,p.built_at::text AS built_text,
  (SELECT jsonb_object_agg(v.key,jsonb_build_object('full',v.value->'full')) FROM jsonb_each(p.context) v WHERE v.key IN ('current','history','emptyCurrent','emptyHistory')) AS context
  FROM place_page p JOIN entity e ON e.id=p.place_id WHERE e.kind IN ('place','body') AND p.context ? 'current'`;

/** The identity headers of one page, as a read of it takes them. */
const HEADERS_SQL = `WITH selected AS (SELECT $1::text AS id), ${identityCtes} SELECT ${identityHeaders()} AS headers`;

/** The dates the facts and calendars of a row were last checked, read as a read of it would (boards folded into others named as the boards they became). */
export async function readChecks(query: Query, brief: Record<string, unknown>): Promise<PlaceChecks | undefined> {
  const aliases = (brief.body_aliases ?? {}) as Record<string, string>;
  const canonical = (body: string): string => { let at = body; for (const seen = new Set<string>(); aliases[at] && !seen.has(at); at = aliases[at]!) seen.add(at); return at; };
  const { request } = placeCheckRequest(brief, canonical);
  const [checks] = request ? await query(PLACE_CHECKS_SQL, [...request]) : [];
  return checks && (checks.facts || checks.calendars) ? { facts: checks.facts ?? undefined, calendars: checks.calendars ?? undefined } as PlaceChecks : undefined;
}

/** The pins of the held meetings of a row: those with a point on the map, earliest first. */
async function pinsOf(row: Record<string, unknown>): Promise<PlacePin[]> {
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async () => { throw new Error("PLACE_PIN_PART_MISSING"); } });
  const { rows } = await parts.loadOwned({ rows: row.meeting_rows, archived: [], documents: [] }, row.parts as Record<string, unknown>) as { rows: { payload: { meetings: Meeting[] } }[] };
  const pins = new Map<string, PlacePin>();
  for (const meeting of rows.flatMap(part => part.payload.meetings)) if (meeting.location && Number.isFinite(meeting.location.lat) && Number.isFinite(meeting.location.lng))
    pins.set(meeting.id, { id: meeting.id, title: meeting.title, startsAt: meeting.startsAt, lat: meeting.location.lat, lng: meeting.location.lng, bodyId: meeting.bodyId ?? null });
  return [...pins.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}

/** One saved page as its file: each saved row with the identities applied, the agenda kept apart from the brief page, and the dates its facts were checked. */
export async function buildPlaceFile(query: Query, page: Record<string, unknown>): Promise<PlaceFile> {
  const id = String(page.id), context = page.context as Record<string, Record<string, unknown>>;
  const [{ headers }] = await query(HEADERS_SQL, [id]) as { headers: BodyHeaders }[];
  let pins: PlacePin[] = [];
  const variants: Record<string, { row: Record<string, unknown>; agenda?: ReturnType<typeof splitAgenda>["agenda"]; checks?: PlaceChecks }> = {};
  for (const name of PLACE_FILE_VARIANTS) {
    if (!context[name]) continue;
    const { brief, agenda } = splitAgenda(currentPlaceRow(unpackPlaceContextRow(context[name].full), headers, true));
    const found = await readChecks(query, brief);
    variants[name] = { row: brief, ...(agenda ? { agenda } : {}), ...(found ? { checks: found } : {}) };
    if (name === "current") pins = await pinsOf(brief);
  }
  return { v: 1, id, kind: page.kind as "place" | "body", state: (page.state as string | null)?.trim() || null, version: Number(page.version), builtAt: Number(page.built) * 1000, readAt: Date.now(), variants, ...(pins.length ? { pins } : {}) };
}
