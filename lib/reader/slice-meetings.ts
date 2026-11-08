import type { Query } from "../facts/publish.ts";
import { ARCHIVED_MEETINGS_SQL, CHECKED_EVERY_MS, MEETING_PARTITIONS_SQL, UNSTAMPED_SQL } from "./canonical.ts";
import { fingerprint as hash, groupedBy, intern, MEETING_CARDS, type MeetingCard } from "./slices.ts";

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

const ROWS_SQL = `SELECT r.promotion_key AS key,r.body_id AS body,reader_payload_value(r.value) AS value FROM civic_data_rows r WHERE r.promotion_key=ANY($1::text[]) AND r.version_id=ANY($5::text[]) AND r.collection=$2 AND (r.body_id=ANY($3::text[]) OR coalesce(r.body_id,'')='' AND r.value->>'ocdId'=ANY($4::text[])) ORDER BY r.promotion_key,r.ordinal`;
const SITTINGS_DIGEST_SQL = `SELECT m.parent_id AS body,md5(string_agg(concat_ws('|',m.id,f.field,f.value::text,f.quote,floor(extract(epoch FROM f.checked_at)/$2),f.status,f.source_copy_id),',' ORDER BY m.id,f.field)) AS digest
  FROM entity m JOIN checked_fact f ON f.entity_id=m.id WHERE m.kind='meeting' AND m.parent_id=ANY($1::text[]) AND f.status IN ('live','pulled') GROUP BY 1`;

const SITTINGS_SQL = `SELECT m.parent_id AS board,m.id AS entity,f.field,f.value,CASE WHEN f.quote IS NOT DISTINCT FROM (f.value#>>'{}') THEN NULL ELSE f.quote END AS quote,
    f.quote IS NOT DISTINCT FROM (f.value#>>'{}') AS same,f.checked_at,f.status,f.source_copy_id AS copy
  FROM entity m JOIN checked_fact f ON f.entity_id=m.id
  WHERE m.kind='meeting' AND m.parent_id=ANY($1::text[]) AND (f.status='live' OR f.field='map_pin' AND f.status='pulled' AND f.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED')
  ORDER BY m.id,f.field`;

/** The calendar partitions of these boards and places, and the names the boards are known by. `headers` asks for each partition's header and members too. */
async function calendarsOf(query: Query, subjects: readonly string[], headers: boolean) {
  const boardRows = await query("SELECT id,kind,state FROM entity WHERE id=ANY($1::text[])", [subjects]);
  const canonical = boardRows.filter(row => row.kind === "body").map(row => String(row.id)), places = boardRows.filter(row => row.kind === "place").map(row => String(row.id));
  const canonicalOf = new Map((canonical.length ? await query("SELECT entity_id,value FROM entity_external_id WHERE scheme='body-alias' AND entity_id=ANY($1::text[])", [canonical]) : []).map(row => [String(row.value), String(row.entity_id)]));
  const names = [...new Set([...canonical, ...canonicalOf.keys()])];
  const familyKeys = [...new Set(boardRows.map(row => String(row.state).toUpperCase()))].flatMap(state => [`MEETING:${FAMILY}US-${state}`, `MEETING:${FAMILY}US-${state}${HISTORY}`]);
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
  const [calendar, held, papers, sittings, oldMeetings, oldPapers] = await Promise.all([
    cards.has("meetings") ? rowsOf(current, "meetings", places) : new Map<string, Row[]>(),
    cards.has("history") ? rowsOf(past, "meetings", places) : new Map<string, Row[]>(),
    cards.has("agenda") && canonical.length ? rowsOf(current, "agendaDocuments", places) : new Map<string, Row[]>(),
    cards.has("meetings") && canonical.length ? query(SITTINGS_SQL, [names]) : [],
    cards.has("history") && current.length ? query(ARCHIVED_MEETINGS_SQL("meetings"), [current.map(row => String(row.key)), names]) : [],
    cards.has("agenda") && canonical.length && current.length ? query(ARCHIVED_MEETINGS_SQL("agendaDocuments"), [current.map(row => String(row.key)), names]) : [],
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

const checkedIn = (detail: unknown) => Math.floor(Date.parse(/"checkedAt":"([^"]+)"/.exec(String(detail))?.[1] ?? "") / CHECKED_EVERY_MS);

const ROWS_DIGEST_SQL = `SELECT r.promotion_key AS key,coalesce(nullif(r.body_id,''),r.value->>'ocdId') AS body,md5(string_agg(md5(${UNSTAMPED_SQL("r.value::text")}),',' ORDER BY r.ordinal)) AS digest FROM civic_data_rows r WHERE r.promotion_key=ANY($1::text[]) AND r.version_id=ANY($4::text[]) AND r.collection=$5 AND (r.body_id=ANY($2::text[]) OR coalesce(r.body_id,'')='' AND r.value->>'ocdId'=ANY($3::text[])) GROUP BY 1,2`;
/** What each card of these boards and places shows, as one fingerprint each (by `subject\tcard`) taken by the database, so no row comes back: calendars without the moments they were read at, the day they were last read or confirmed in, and the sittings. */
export async function cardInputs(query: Query, subjects: readonly string[]): Promise<Map<string, string>> {
  const { boardRows, canonicalOf, names, partitions, places } = await calendarsOf(query, subjects, false);
  const current = partitions.filter(row => !String(row.scope).endsWith(HISTORY)), none: Row[] = [];
  const digest = (rows: readonly Row[], collection: string) => rows.length ? query(ROWS_DIGEST_SQL, [rows.map(row => String(row.key)), names, places, rows.map(row => String(row.version)), collection]) : none;
  const [calendars, papers, sittings] = await Promise.all([digest(partitions, "meetings"), digest(current, "agendaDocuments"), names.length ? query(SITTINGS_DIGEST_SQL, [names, CHECKED_EVERY_MS / 1000]) : none]);
  const canon = (board: unknown) => canonicalOf.get(String(board)) ?? String(board), state = new Map(boardRows.map(row => [String(row.id), String(row.state).toUpperCase()])), out = new Map<string, string>();
  for (const subject of subjects) {
    const mine = (from: readonly Row[]) => from.filter(row => canon(row.body) === subject).map(row => [row.key, row.digest]);
    const held = (old: boolean) => partitions.filter(row => String(row.scope).endsWith(HISTORY) === old && ((own: string | null) => own === null ? String(row.scope).startsWith(`${FAMILY}US-${state.get(subject)}`) : canon(own) === subject)(ownBody(String(row.scope)))).map(row => [row.scope, row.shown, checkedIn(row.confirmation)]);
    for (const [card, parts] of [["meetings", [held(false), mine(calendars), mine(sittings)]], ["history", [held(true), mine(calendars)]], ["agenda", mine(papers)]] as const) out.set(`${subject}\t${card}`, hash(parts));
  }
  return out;
}
export async function cardsAsBuilt(query: Query, subjects: readonly string[]): Promise<{ readonly now: Map<string, string>; readonly asBuilt: Set<string> }> {
  const [now, held] = subjects.length ? await Promise.all([cardInputs(query, subjects), query("SELECT place_id||E'\\t'||card AS k,fingerprint FROM place_slice WHERE place_id=ANY($1::text[]) AND card=ANY($2::text[])", [subjects, MEETING_CARDS])]) : [new Map<string, string>(), []];
  return { now, asBuilt: new Set(held.filter(row => row.fingerprint === now.get(String(row.k))).map(row => String(row.k))) };
}
