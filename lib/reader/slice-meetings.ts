import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { ARCHIVED_MEETINGS_SQL, MEETING_PARTITIONS_SQL } from "./canonical.ts";
import { groupedBy, intern, unpackSlice, type MeetingCard } from "./slices.ts";

type Row = Record<string, unknown>;
type Meeting = Row & { readonly id: string; readonly bodyId?: string | null; readonly ocdId?: string | null };

/** One calendar partition as a place holds it: its scope and version, its header without the rows, the last unchanged confirmation, and the rows that belong to this place. */
export interface SlicePartition {
  readonly s: string;
  readonly v: string;
  readonly c: string | null;
  readonly h: Row;
  /** The state-wide family's per-board outcomes, for the boards of this place only. */
  readonly m?: readonly Row[];
  readonly r: readonly Meeting[];
}

/** The meetings card: the live calendar by source, and the sittings the Slide filed under each board's meetings. */
export interface MeetingsBody {
  readonly v: 1;
  /** The board, or the place, whose card this is. */
  readonly s: string;
  readonly sources: readonly string[];
  /** [page (an index into `sources`), full time checked]. */
  readonly stamps: readonly (readonly [number | null, string])[];
  readonly parts: readonly SlicePartition[];
  /** [board, meeting entity, field, value, stamp, status, quote when it is not the value itself]. */
  readonly sittings: readonly (readonly [string, string, string, unknown, number, "live" | "pulled"] | readonly [string, string, string, unknown, number, "live" | "pulled", string | null])[];
}
/** The history card: the held history partitions, and sittings only older versions of a calendar still carry. */
export interface HistoryBody { readonly v: 1; readonly s: string; readonly parts: readonly SlicePartition[]; readonly archived: readonly Meeting[] }
/** The agenda card: the agenda papers of this place's meetings, with their text. */
export interface AgendaBody { readonly v: 1; readonly s: string; readonly documents: readonly Row[]; readonly archived: readonly Row[] }

const FAMILY = "source:derived:family:";
const HISTORY = ":history";
/** Percent-encoding as a calendar scope spells a board's id. */
const encoded = encodeURIComponent;
const ownBody = (scope: string): string | null => {
  const match = /^source:[^:]+:body:([^:]+)(?::|$)/.exec(scope);
  try { return match ? decodeURIComponent(match[1]!) : null; } catch { return match![1]!; }
};

const ROWS_OF = `FROM civic_data_rows r WHERE r.promotion_key=ANY($1::text[]) AND r.version_id=ANY($5::text[]) AND r.collection=$2 AND (r.body_id=ANY($3::text[]) OR coalesce(r.body_id,'')='' AND r.value->>'ocdId'=ANY($4::text[]))`;
const ROWS_SQL = `SELECT r.promotion_key AS key,r.body_id AS body,reader_payload_value(r.value) AS value ${ROWS_OF} ORDER BY r.promotion_key,r.ordinal`;
const AGENDA_ROWS_DIGEST_SQL = `SELECT r.promotion_key AS key,r.body_id AS body,md5(string_agg(md5(r.value::text),',' ORDER BY r.ordinal)) AS digest ${ROWS_OF} AND coalesce(r.body_id,'')<>'' GROUP BY 1,2 ORDER BY 1,2`;
const AGENDA_ARCHIVED_DIGEST_SQL = `SELECT body,md5(string_agg(md5(value::text),',' ORDER BY md5(value::text))) AS digest FROM (${ARCHIVED_MEETINGS_SQL("agendaDocuments")}) papers GROUP BY body ORDER BY body`;

const SITTINGS_SQL = `SELECT m.parent_id AS board,m.id AS entity,f.field,f.value,CASE WHEN f.quote IS NOT DISTINCT FROM (f.value#>>'{}') THEN NULL ELSE f.quote END AS quote,
    f.quote IS NOT DISTINCT FROM (f.value#>>'{}') AS same,f.checked_at,f.status,f.source_copy_id AS copy
  FROM entity m JOIN checked_fact f ON f.entity_id=m.id
  WHERE m.kind='meeting' AND m.parent_id=ANY($1::text[]) AND (f.status='live' OR f.field='map_pin' AND f.status='pulled' AND f.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED')
  ORDER BY m.id,f.field`;

/** The calendar partitions of these boards and places, and the names the boards are known by. `headers` asks for each partition's header and members too. */
async function calendarsOf(query: Query, subjects: readonly string[], headers: boolean) {
  const boardRows = await query("SELECT id,kind,state FROM entity WHERE id=ANY($1::text[])", [subjects]);
  const canonical = boardRows.filter(row => row.kind === "body").map(row => String(row.id)), places = boardRows.filter(row => row.kind === "place").map(row => String(row.id));
  const aliasRows = canonical.length ? await query("SELECT entity_id,value FROM entity_external_id WHERE scheme='body-alias' AND entity_id=ANY($1::text[])", [canonical]) : [];
  const canonicalOf = new Map(aliasRows.map(row => [String(row.value), String(row.entity_id)]));
  const names = [...new Set([...canonical, ...canonicalOf.keys()])];
  const states = [...new Set(boardRows.map(row => String(row.state).toUpperCase()))];
  const familyKeys = states.flatMap(state => [`MEETING:${FAMILY}US-${state}`, `MEETING:${FAMILY}US-${state}${HISTORY}`]);
  const partitions = names.length || places.length ? await query(MEETING_PARTITIONS_SQL, [familyKeys, names.map(encoded), headers]) : [];
  return { boardRows, canonical, places, canonicalOf, names, partitions };
}

/**
 * The meetings cards of these boards and places. A board's card holds its own calendar partitions with only its meetings (and, from a
 * state's family of calendars, its rows), its sittings, agenda papers and held history, so a change to one board rebuilds that board alone and
 * a board filed on several places is held once. A place's card holds only what the family names it for, the meetings with no board. A board
 * folded into another is read under both its names. A card with nothing on it is null.
 */
export async function buildMeetingSlices(query: Query, wanted: ReadonlyMap<string, ReadonlySet<MeetingCard>>): Promise<Map<string, Map<MeetingCard, unknown>>> {
  const built = new Map<string, Map<MeetingCard, unknown>>();
  if (!wanted.size) return built;
  const cards = new Set([...wanted.values()].flatMap(set => [...set]));
  const { boardRows, canonical, places, canonicalOf, names, partitions } = await calendarsOf(query, [...wanted.keys()], cards.has("meetings") || cards.has("history"));
  const rowsOf = async (from: readonly Row[], collection: string, ocdIds: readonly string[]) =>
    from.length ? groupedBy(await query(ROWS_SQL, [from.map(row => String(row.key)), collection, names, ocdIds, from.map(row => String(row.version))]), "key") : new Map<string, Row[]>();
  const current = partitions.filter(row => !String(row.scope).endsWith(HISTORY)), past = partitions.filter(row => String(row.scope).endsWith(HISTORY));
  const wantsOf = (card: MeetingCard) => cards.has(card);
  const [calendar, held, papers, sittings, oldMeetings, oldPapers] = await Promise.all([
    wantsOf("meetings") ? rowsOf(current, "meetings", places) : new Map<string, Row[]>(),
    wantsOf("history") ? rowsOf(past, "meetings", places) : new Map<string, Row[]>(),
    wantsOf("agenda") && canonical.length ? rowsOf(current, "agendaDocuments", places) : new Map<string, Row[]>(),
    wantsOf("meetings") && canonical.length ? query(SITTINGS_SQL, [names]) : [],
    wantsOf("history") && current.length ? query(ARCHIVED_MEETINGS_SQL("meetings"), [current.map(row => String(row.key)), names]) : [],
    wantsOf("agenda") && canonical.length && current.length ? query(ARCHIVED_MEETINGS_SQL("agendaDocuments"), [current.map(row => String(row.key)), names]) : [],
  ]);
  const copyIds = [...new Set(sittings.flatMap(row => row.copy === null ? [] : [String(row.copy)]))];
  const urls = new Map((copyIds.length ? await query("SELECT id,url FROM source_copy WHERE id=ANY($1::bigint[])", [copyIds]) : []).map(row => [String(row.id), String(row.url)]));
  // A board's own calendar supersedes the state family's rows for that board.
  const ownDerived = new Set(current.flatMap(row => /^source:derived~US-/.test(String(row.scope)) ? ownBody(String(row.scope)) ?? [] : []));
  const canon = (board: unknown): string | null => typeof board === "string" && board ? canonicalOf.get(board) ?? board : null;

  const partsFor = (place: string, from: readonly Row[], rows: ReadonlyMap<string, Row[]>, home: ReadonlySet<string>): SlicePartition[] => from.flatMap(partition => {
    const scope = String(partition.scope), family = scope.startsWith(FAMILY), own = ownBody(scope), owned = own !== null && home.has(canon(own) ?? "");
    if (!family && !owned) return [];
    const mine = (rows.get(String(partition.key)) ?? []).filter(row => {
      const board = canon(row.body);
      return board ? home.has(board) && !(family && !scope.endsWith(HISTORY) && ownDerived.has(board)) : (row.value as Meeting).ocdId === place;
    }).map(row => row.value as Meeting);
    const members = ((partition.members ?? []) as Row[]).filter(member => home.has(canon(member.bodyId) ?? ""));
    if (!mine.length && !members.length && !owned) return [];
    return [{ s: scope, v: String(partition.version), c: (partition.confirmation as string | null) ?? null, h: partition.header as Row,
      ...(partition.members ? { m: members } : {}), r: mine }];
  });

  const kinds = new Map(boardRows.map(row => [String(row.id), String(row.kind)]));
  for (const [place, asked] of wanted) {
    const home = new Set(kinds.get(place) === "body" ? [place] : []), out = new Map<MeetingCard, unknown>();
    const mineOf = (rows: readonly Row[]) => rows.filter(row => home.has(canon(row.body) ?? ""));
    if (asked.has("meetings")) {
      const sources: string[] = [], stamps: (readonly [number | null, string])[] = [], sourceAt = new Map<string, number>(), stampAt = new Map<string, number>();
      const filed = sittings.filter(row => home.has(canon(row.board) ?? "")).map(row => {
        const url = row.copy === null ? undefined : urls.get(String(row.copy)), source = url === undefined ? null : intern(sources, sourceAt, url, url);
        const time = new Date(row.checked_at as string).toISOString();
        const stamp = intern(stamps, stampAt, `${source}|${time}`, [source, time] as const);
        return [canon(row.board)!, String(row.entity), String(row.field), row.value, stamp, row.status as "live" | "pulled", ...(row.same === true ? [] : [row.quote as string | null])] as unknown as MeetingsBody["sittings"][number];
      });
      const parts = partsFor(place, current, calendar, home);
      out.set("meetings", parts.length || filed.length ? { v: 1, s: place, sources, stamps, parts, sittings: filed } satisfies MeetingsBody : null);
    }
    if (asked.has("history")) {
      const parts = partsFor(place, past, held, home), archived = mineOf(oldMeetings).map(row => row.value as Meeting);
      out.set("history", parts.length || archived.length ? { v: 1, s: place, parts, archived } satisfies HistoryBody : null);
    }
    if (asked.has("agenda")) {
      const documents = current.flatMap(partition => (papers.get(String(partition.key)) ?? []).filter(row => home.has(canon(row.body) ?? "")).map(row => row.value as Row));
      const archived = mineOf(oldPapers).map(row => row.value as Row);
      out.set("agenda", documents.length || archived.length ? { v: 1, s: place, documents, archived } satisfies AgendaBody : null);
    }
    built.set(place, out);
  }
  return built;
}

/** The meetings cards of these boards as held, with only each calendar's last confirmation brought up to date. A card not held, or one of whose calendars has moved to another version, is left to the rebuild that change marked. */
export async function confirmedMeetings(query: Query, boards: readonly string[]): Promise<Map<string, Map<MeetingCard, unknown>>> {
  const out = new Map<string, Map<MeetingCard, unknown>>();
  if (!boards.length) return out;
  const [held, { partitions }] = await Promise.all([query("SELECT place_id,body FROM place_slice WHERE card='meetings' AND body IS NOT NULL AND place_id=ANY($1::text[])", [boards]), calendarsOf(query, boards, false)]);
  const current = new Map(partitions.map(row => [String(row.scope), row]));
  for (const row of held) {
    const body = unpackSlice<MeetingsBody>(row.body), now = body.parts.map(part => current.get(part.s));
    if (now.every((partition, at) => partition && String(partition.version) === body.parts[at]!.v))
      out.set(String(row.place_id), new Map<MeetingCard, unknown>([["meetings", { ...body, parts: body.parts.map((part, at) => ({ ...part, c: (now[at]!.confirmation as string | null) ?? null })) }]]));
  }
  return out;
}

/** What the agenda card of each of these boards is built from, as one fingerprint each, taken by the database so no paper's text comes back. A new calendar version that leaves a board's papers as they were leaves it as it was. */
export async function agendaInputs(query: Query, boards: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { canonical, canonicalOf, names, partitions } = await calendarsOf(query, boards, false);
  const current = partitions.filter(row => !String(row.scope).endsWith(HISTORY));
  const keys = current.map(row => String(row.key));
  const [rows, archived] = keys.length ? await Promise.all([query(AGENDA_ROWS_DIGEST_SQL, [keys, "agendaDocuments", names, [], current.map(row => String(row.version))]),
    query(AGENDA_ARCHIVED_DIGEST_SQL, [keys, names])]) : [[], []];
  const of = (board: string) => (row: Row) => (canonicalOf.get(String(row.body)) ?? String(row.body)) === board;
  for (const board of canonical) out.set(board, createHash("sha256").update(JSON.stringify([rows.filter(of(board)).map(row => [row.key, row.digest]), archived.filter(of(board)).map(row => row.digest)])).digest("hex"));
  return out;
}
