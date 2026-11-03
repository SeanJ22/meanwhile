import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants, deflateRawSync, inflateRawSync } from "node:zlib";
import type { Query } from "../facts/publish.ts";
import { buildMeetingSlices } from "./slice-meetings.ts";
import { registrationOf, type PlaceRegistration } from "./slice-registration.ts";
import { SLICE_DICTIONARY } from "./slice-dictionary.ts";

/** One small slice per card per place. A reader's page for a place is these, and nothing is assembled from the fact store while it is open. */
export const ENTITY_CARDS = ["governs", "bodies", "ballot", "money", "more"] as const;
export type EntityCard = (typeof ENTITY_CARDS)[number];
/** What a place's meetings need: the calendar now, the held history behind it, and the agenda papers, which only an opened meeting reads. */
export const MEETING_CARDS = ["meetings", "history", "agenda"] as const;
export type MeetingCard = (typeof MEETING_CARDS)[number];
export const SLICE_CARDS = [...ENTITY_CARDS, ...MEETING_CARDS] as const;
export type SliceCard = EntityCard | MeetingCard;
/** The card built last: a place with it has all its slices. */
export const LAST_CARD: SliceCard = "agenda";

/** Kinds no entity card holds: a meeting waits for the meetings cards, a campaign committee's lines are never shown line by line, and a place is where things are filed. */
const UNCARDED_KINDS = ["meeting", "place", "committee"] as const;
/** Donor lines and money lines are never part of a slice: small donors are never shown by name and the summary stands in for the lines. */
const NEVER_SHOWN = /^(?:campaign-donor|campaign-money):/;
const PERSON_FIELDS = /^(?:name|office|email|phone|website|term_note|term_start|term_end)(?::|$)/;
const BODY_FIELDS = /^(?:name|homepage|meeting_cadence|agenda_url|office_address|office_phone|office_email|mailing_address|member|comment)(?::|$)/;

/** The cards a change to an entity of this kind can reach. */
export function cardsOfKind(kind: string): readonly SliceCard[] {
  if (kind === "person") return ["governs", "money", "more"];
  if (kind === "body" || kind === "government") return ["bodies", "more"];
  if (kind === "measure" || kind === "measure_provision") return ["ballot"];
  if (kind === "meeting") return ["meetings"];
  return (UNCARDED_KINDS as readonly string[]).includes(kind) ? [] : ["more"];
}

/** The card one fact of an entity of this kind belongs on; a fact "More about this" holds is any a card does not claim. */
export function cardOfFact(kind: string, field: string): EntityCard | null {
  if (NEVER_SHOWN.test(field) || (UNCARDED_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "person") return PERSON_FIELDS.test(field) ? "governs" : field.startsWith("campaign-cycle:") ? "money" : "more";
  if (kind === "body" || kind === "government") return BODY_FIELDS.test(field) ? "bodies" : "more";
  return kind === "measure" || kind === "measure_provision" ? "ballot" : "more";
}

/** A fact: its value, the stamp it was checked under, and its exact quote only when that is not the value itself. */
export type SliceFact = readonly [unknown, number] | readonly [unknown, number, string | null];
/** Where and when a fact was checked: the page (an index into `sources`), the full time, and who vouches for it. */
export type SliceStamp = readonly [number | null, string, string];

/** What one entity card of one place holds: each entity filed there, with its live facts, the stamps they were checked under and the pages they came from. */
export interface SliceBody {
  readonly v: 2;
  readonly sources: readonly string[];
  readonly stamps: readonly SliceStamp[];
  /** The boards a person's office and term are stored against: `office@2` is the office on `boards[2]`. */
  readonly boards: readonly string[];
  readonly entities: readonly {
    readonly id: string;
    readonly k: string;
    readonly n: string;
    readonly p?: string;
    /** The names a folded board was known by. */
    readonly a?: readonly string[];
    /** Every place a board is filed on, and `h` when one of them is its host county's. */
    readonly d?: readonly string[];
    readonly h?: 1;
    /** The id readers already see for a person seated on a roster. */
    readonly x?: string;
    readonly f: Readonly<Record<string, SliceFact>>;
  }[];
  /** Bodies card: the governments the state registered for this place, and its own registration row. */
  readonly reg?: PlaceRegistration;
}

const KINDS_OF_CARD: Readonly<Record<Exclude<EntityCard, "more">, readonly string[]>> = {
  governs: ["person", "body", "government"], money: ["person"], bodies: ["body", "government"], ballot: ["measure", "measure_provision"],
};
/** A person's office and term on a board are stored under the field and the board (`office:<board id>`); a place holds those for the boards filed on it. */
const SCOPED_FIELD = /^(name|office|email|phone|website|term_note|term_start|term_end):(.+)$/;

/** The position of this item in the list, adding it the first time its key is seen. */
export function intern<T>(list: T[], seen: Map<string, number>, key: string, item: T): number {
  let at = seen.get(key);
  if (at === undefined) { at = list.push(item) - 1; seen.set(key, at); }
  return at;
}

export const groupedBy = (rows: readonly Record<string, unknown>[], key: string): Map<string, Record<string, unknown>[]> => {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) { const held = out.get(String(row[key])); if (held) held.push(row); else out.set(String(row[key]), [row]); }
  return out;
};

/** The boards filed on these places that lack their meetings cards, each with all three: a board's meetings are held once, whatever number of places it serves. */
export async function boardsToBuild(query: Query, places: readonly string[]): Promise<string[]> {
  return (await query(`SELECT DISTINCT coalesce(x.entity_id,e.id) AS id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id AND e.kind='body'
    LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.id
    WHERE ep.place_id=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM place_slice s WHERE s.place_id=coalesce(x.entity_id,e.id) AND s.card=$2)`, [places, LAST_CARD])).map(row => String(row.id));
}

/** The places that asked for any of these cards, with only those cards. */
const askedFor = <C extends SliceCard>(wanted: ReadonlyMap<string, ReadonlySet<SliceCard>>, cards: readonly C[]): Map<string, Set<C>> =>
  new Map([...wanted].flatMap(([place, set]) => { const mine = new Set(cards.filter(card => set.has(card))); return mine.size ? [[place, mine] as const] : []; }));

/**
 * The slices of these places, built from the fact store by reading only these places' entities and their facts: a few statements for
 * the whole batch, whatever its size. A card with nothing on it is null.
 */
export async function buildSlices(query: Query, wanted: ReadonlyMap<string, ReadonlySet<SliceCard>>): Promise<Map<string, Map<SliceCard, unknown>>> {
  const built = new Map<string, Map<SliceCard, unknown>>();
  const [entities, meetings] = await Promise.all([buildEntitySlices(query, askedFor(wanted, ENTITY_CARDS)), buildMeetingSlices(query, askedFor(wanted, MEETING_CARDS))]);
  for (const part of [entities, meetings]) for (const [place, cards] of part) built.set(place, new Map([...built.get(place) ?? [], ...cards]));
  return built;
}

async function buildEntitySlices(query: Query, wanted: ReadonlyMap<string, ReadonlySet<EntityCard>>): Promise<Map<string, Map<EntityCard, SliceBody | null>>> {
  const built = new Map<string, Map<EntityCard, SliceBody | null>>();
  if (!wanted.size) return built;
  const cards = new Set([...wanted.values()].flatMap(set => [...set]));
  const kinds = cards.has("more") ? null : [...new Set([...cards].flatMap(card => KINDS_OF_CARD[card as Exclude<EntityCard, "more">]))];
  const filed = await query(`SELECT DISTINCT ep.place_id,e.id,e.kind,e.name,e.parent_id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id
    WHERE ep.place_id=ANY($1::text[]) AND e.kind<>ALL($2::text[]) AND ($3::text[] IS NULL OR e.kind=ANY($3::text[])) ORDER BY ep.place_id,e.id`,
  [[...wanted.keys()], UNCARDED_KINDS, kinds]);
  const factIds = [...new Set(filed.filter(row => cardsOfKind(String(row.kind)).some(card => cards.has(card as EntityCard))).map(row => String(row.id)))];
  const boardIds = cards.has("bodies") ? [...new Set(filed.filter(row => row.kind === "body" || row.kind === "government").map(row => String(row.id)))] : [];
  const personIds = cards.has("governs") ? [...new Set(filed.filter(row => row.kind === "person").map(row => String(row.id)))] : [];
  const bodiesAsked = [...wanted].filter(([, asked]) => asked.has("bodies")).map(([place]) => place);
  const [facts, copyRows, placesOf, aliasesOf, registration, shownRows] = await Promise.all([
    factIds.length ? query(`SELECT f.entity_id,f.field,f.value,CASE WHEN f.quote IS NOT DISTINCT FROM (f.value#>>'{}') THEN NULL ELSE f.quote END AS quote,f.quote IS NOT DISTINCT FROM (f.value#>>'{}') AS same,f.checked_at,f.provenance_kind,f.source_copy_id FROM checked_fact f
      WHERE f.entity_id=ANY($1::text[]) AND f.status='live' AND f.field !~ '^(?:campaign-donor|campaign-money):' ORDER BY f.entity_id,f.field`, [factIds]) : [],
    factIds.length ? query(`SELECT c.id,c.url FROM source_copy c WHERE c.id IN (SELECT f.source_copy_id FROM checked_fact f WHERE f.entity_id=ANY($1::text[]) AND f.status='live')`, [factIds]) : [],
    boardIds.length ? query("SELECT entity_id,place_id,placement_basis FROM entity_place WHERE entity_id=ANY($1::text[]) ORDER BY entity_id,place_id", [boardIds]) : [],
    boardIds.length ? query("SELECT entity_id,value FROM entity_external_id WHERE scheme='body-alias' AND entity_id=ANY($1::text[]) ORDER BY entity_id,value", [boardIds]) : [],
    bodiesAsked.length ? registrationOf(query, bodiesAsked) : new Map<string, PlaceRegistration>(),
    personIds.length ? query("SELECT entity_id,min(value) AS value FROM entity_external_id WHERE scheme='roster-member' AND entity_id=ANY($1::text[]) GROUP BY entity_id", [personIds]) : [],
  ]);
  const copies = new Map(copyRows.map(row => [String(row.id), String(row.url)])), shown = new Map(shownRows.map(row => [String(row.entity_id), String(row.value)]));
  const factsOf = groupedBy(facts, "entity_id"), at = groupedBy(filed, "place_id"), served = groupedBy(placesOf, "entity_id"), known = groupedBy(aliasesOf, "entity_id");
  for (const [place, wantedCards] of wanted) {
    const entities = at.get(place) ?? [], boards = new Set(entities.filter(row => row.kind === "body" || row.kind === "government").map(row => String(row.id)));
    const out = new Map<EntityCard, SliceBody | null>();
    for (const card of wantedCards) {
      const sources: string[] = [], stamps: SliceStamp[] = [], boardsHere: string[] = [], held: SliceBody["entities"][number][] = [];
      const sourceAt = new Map<string, number>(), stampAt = new Map<string, number>(), boardAt = new Map<string, number>();
      for (const entity of entities) {
        const kind = String(entity.kind), id = String(entity.id), mine: Record<string, SliceFact> = {};
        for (const fact of factsOf.get(id) ?? []) {
          const field = String(fact.field);
          if (cardOfFact(kind, field) !== card) continue;
          const scoped = kind === "person" ? SCOPED_FIELD.exec(field) : null;
          if (scoped && !boards.has(scoped[2]!)) continue;
          const key = scoped ? `${scoped[1]}@${intern(boardsHere, boardAt, scoped[2]!, scoped[2]!)}` : field;
          const url = fact.source_copy_id === null ? undefined : copies.get(String(fact.source_copy_id));
          const source = url === undefined ? null : intern(sources, sourceAt, url, url);
          const time = fact.checked_at ? new Date(fact.checked_at as string).toISOString() : "", prov = String(fact.provenance_kind);
          const stamp = intern(stamps, stampAt, `${source}|${time}|${prov}`, [source, time, prov] as const);
          mine[key] = fact.same === true ? [fact.value, stamp] : [fact.value, stamp, fact.quote === undefined ? null : fact.quote as string | null];
        }
        const board = card === "bodies" && (kind === "body" || kind === "government");
        const aliases = board ? (known.get(id) ?? []).map(row => String(row.value)) : [], filedOn = board ? served.get(id) ?? [] : [];
        if (Object.keys(mine).length || kind !== "person" && cardsOfKind(kind)[0] === card) held.push({ id, k: kind, n: String(entity.name), ...(entity.parent_id === null ? {} : { p: String(entity.parent_id) }),
          ...(aliases.length ? { a: aliases } : {}), ...(filedOn.length ? { d: filedOn.map(row => String(row.place_id)) } : {}),
          ...(filedOn.some(row => row.placement_basis === "HOST_COUNTY") ? { h: 1 as const } : {}), ...(card === "governs" && shown.has(id) ? { x: shown.get(id)! } : {}), f: mine });
      }
      const reg = card === "bodies" ? registration.get(place) : undefined;
      out.set(card, held.length || reg ? { v: 2, sources, stamps, boards: boardsHere, entities: held, ...(reg ? { reg } : {}) } : null);
    }
    built.set(place, out);
  }
  return built;
}

/** A slice that reads the same is not written again: its fingerprint is that of what it holds. */
const fingerprint = (body: unknown): string => createHash("sha256").update(body === null ? "" : JSON.stringify(body)).digest("hex");

/**
 * What is stored for a slice: itself, or its JSON packed, whichever is shortest. `{ z }` is brotli, which wins on a large slice; `{ d }` is
 * deflate against the shared dictionary, which wins on a small one. The bytes a reader fetches are the stored ones.
 */
export function packSlice(body: unknown): unknown {
  const json = JSON.stringify(body);
  const z = brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24 } }).toString("base64");
  const d = deflateRawSync(json, { level: 9, dictionary: SLICE_DICTIONARY }).toString("base64");
  return Math.min(z.length, d.length) + 8 >= json.length ? body : d.length < z.length ? { d } : { z };
}
/** The slice a stored value holds, however it was packed. */
export function unpackSlice<T>(stored: unknown): T {
  const { z, d } = (stored && typeof stored === "object" ? stored : {}) as { z?: unknown; d?: unknown };
  if (typeof z === "string") return JSON.parse(brotliDecompressSync(Buffer.from(z, "base64")).toString("utf8")) as T;
  return (typeof d === "string" ? JSON.parse(inflateRawSync(Buffer.from(d, "base64"), { dictionary: SLICE_DICTIONARY }).toString("utf8")) : stored) as T;
}

/** The only writer of place_slice. Returns how many slices differed from what was held and were written. `inputs` are fingerprints of what cards were built from (by `place\tcard`), kept so a rebuild can tell nothing changed; `changed` collects the places written. */
export async function writeSlices(query: Query, built: ReadonlyMap<string, ReadonlyMap<SliceCard, unknown>>, inputs: ReadonlyMap<string, string> = new Map(), changed?: Set<string>): Promise<number> {
  const places: string[] = [], cards: string[] = [], bodies: (string | null)[] = [], prints: string[] = [], held: string[] = [];
  for (const [place, slices] of built) for (const [card, body] of slices) {
    places.push(place); cards.push(card); bodies.push(body === null ? null : JSON.stringify(packSlice(body))); prints.push(fingerprint(body)); held.push(inputs.get(`${place}\t${card}`) ?? "");
  }
  if (!places.length) return 0;
  const written = await query(`INSERT INTO place_slice(place_id,card,body,fingerprint,inputs) SELECT place_id,card,body::jsonb,fingerprint,nullif(inputs,'') FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[]) AS s(place_id,card,body,fingerprint,inputs)
    ON CONFLICT(place_id,card) DO UPDATE SET body=EXCLUDED.body,fingerprint=EXCLUDED.fingerprint,inputs=EXCLUDED.inputs,built_at=now()
    WHERE place_slice.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint OR place_slice.inputs IS DISTINCT FROM EXCLUDED.inputs RETURNING place_id`, [places, cards, bodies, prints, held]);
  for (const row of written) changed?.add(String(row.place_id));
  return written.length;
}

/**
 * The slices of a page, unpacked: the cards asked for of these places, and the meetings cards of the boards filed on them. Only cards that hold
 * something come back. A place's cards are named by its position in the request, and a board's carry their own, so no id or row frame crosses the connection.
 */
export async function readSlices(query: Query, places: readonly string[], cards: readonly SliceCard[] = SLICE_CARDS): Promise<Map<string, Map<SliceCard, unknown>>> {
  const out = new Map<string, Map<SliceCard, unknown>>();
  const [read] = await query(`SELECT (SELECT jsonb_agg(jsonb_build_array(u.n,s.card,s.body)) FROM unnest($1::text[]) WITH ORDINALITY u(id,n) JOIN place_slice s ON s.place_id=u.id
      WHERE s.card=ANY($2::text[]) AND s.body IS NOT NULL) AS places,
    (SELECT jsonb_agg(jsonb_build_array(s.card,s.body)) FROM place_slice s WHERE s.card=ANY($3::text[]) AND s.body IS NOT NULL AND s.place_id IN (
      SELECT coalesce(x.entity_id,e.id) FROM entity_place ep JOIN entity e ON e.id=ep.entity_id AND e.kind='body'
      LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.id WHERE ep.place_id=ANY($1::text[]))) AS boards`,
  [places, cards, cards.filter(card => (MEETING_CARDS as readonly string[]).includes(card))]);
  const keep = (subject: string, card: SliceCard, body: unknown) => { const held = out.get(subject) ?? new Map<SliceCard, unknown>(); held.set(card, unpackSlice(body)); out.set(subject, held); };
  for (const [n, card, body] of (read?.places ?? []) as [number, SliceCard, unknown][]) keep(places[n - 1]!, card, body);
  for (const [card, body] of (read?.boards ?? []) as [SliceCard, unknown][]) { const slice = unpackSlice<{ s: string }>(body); keep(slice.s, card, slice); }
  return out;
}
