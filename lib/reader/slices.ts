import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";

/** One small slice per card per place. A reader's page for a place is these, and nothing is assembled from the fact store while it is open. */
export const SLICE_CARDS = ["governs", "bodies", "ballot", "money", "more"] as const;
export type SliceCard = (typeof SLICE_CARDS)[number];

/** Kinds no card holds: a meeting waits for the meetings slice, a campaign committee's lines are never shown line by line, and a place is where things are filed. */
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
  return (UNCARDED_KINDS as readonly string[]).includes(kind) ? [] : ["more"];
}

/** The card one fact of an entity of this kind belongs on; a fact "More about this" holds is any a card does not claim. */
export function cardOfFact(kind: string, field: string): SliceCard | null {
  if (NEVER_SHOWN.test(field) || (UNCARDED_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "person") return PERSON_FIELDS.test(field) ? "governs" : field.startsWith("campaign-cycle:") ? "money" : "more";
  if (kind === "body" || kind === "government") return BODY_FIELDS.test(field) ? "bodies" : "more";
  return kind === "measure" || kind === "measure_provision" ? "ballot" : "more";
}

/** What one card of one place holds: each entity filed there, with its live facts, their dates and the pages they came from. */
export interface SliceBody {
  readonly v: 1;
  readonly sources: readonly string[];
  /** The boards a person's office and term are stored against: `office@2` is the office on `boards[2]`. */
  readonly boards: readonly string[];
  readonly entities: readonly {
    readonly id: string;
    readonly k: string;
    readonly n: string;
    readonly p: string | null;
    /** Field → [value, index into sources, day last checked, provenance]. */
    readonly f: Readonly<Record<string, readonly [unknown, number | null, string | null, string]>>;
  }[];
}

const KINDS_OF_CARD: Readonly<Record<Exclude<SliceCard, "more">, readonly string[]>> = {
  governs: ["person", "body", "government"], money: ["person"], bodies: ["body", "government"], ballot: ["measure", "measure_provision"],
};
/** A person's office and term on a board are stored under the field and the board (`office:<board id>`); a place holds those for the boards filed on it. */
const SCOPED_FIELD = /^(name|office|email|phone|website|term_note|term_start|term_end):(.+)$/;

/**
 * The slices of these places, built from the fact store by reading only these places' entities and their facts:
 * three statements for the whole batch, whatever its size. A card with nothing on it is null.
 */
export async function buildSlices(query: Query, wanted: ReadonlyMap<string, ReadonlySet<SliceCard>>): Promise<Map<string, Map<SliceCard, SliceBody | null>>> {
  const cards = new Set([...wanted.values()].flatMap(set => [...set]));
  const kinds = cards.has("more") ? null : [...new Set([...cards].flatMap(card => KINDS_OF_CARD[card as Exclude<SliceCard, "more">]))];
  const filed = await query(`SELECT DISTINCT ep.place_id,e.id,e.kind,e.name,e.parent_id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id
    WHERE ep.place_id=ANY($1::text[]) AND e.kind<>ALL($2::text[]) AND ($3::text[] IS NULL OR e.kind=ANY($3::text[])) ORDER BY ep.place_id,e.id`,
  [[...wanted.keys()], UNCARDED_KINDS, kinds]);
  const factIds = [...new Set(filed.filter(row => cardsOfKind(String(row.kind)).some(card => cards.has(card))).map(row => String(row.id)))];
  const facts = factIds.length ? await query(`SELECT f.entity_id,f.field,f.value,f.checked_at,f.provenance_kind,f.source_copy_id FROM checked_fact f
    WHERE f.entity_id=ANY($1::text[]) AND f.status='live' AND f.field !~ '^(?:campaign-donor|campaign-money):' ORDER BY f.entity_id,f.field`, [factIds]) : [];
  const copies = new Map<string, string>();
  const copyIds = [...new Set(facts.flatMap(row => row.source_copy_id === null ? [] : [String(row.source_copy_id)]))];
  if (copyIds.length) for (const row of await query("SELECT id,url FROM source_copy WHERE id=ANY($1::bigint[])", [copyIds])) copies.set(String(row.id), String(row.url));
  const factsOf = new Map<string, Record<string, unknown>[]>();
  for (const row of facts) { const held = factsOf.get(String(row.entity_id)); if (held) held.push(row); else factsOf.set(String(row.entity_id), [row]); }
  const at = new Map<string, Record<string, unknown>[]>();
  for (const row of filed) { const held = at.get(String(row.place_id)); if (held) held.push(row); else at.set(String(row.place_id), [row]); }
  const built = new Map<string, Map<SliceCard, SliceBody | null>>();
  for (const [place, wantedCards] of wanted) {
    const entities = at.get(place) ?? [], boards = new Set(entities.filter(row => row.kind === "body" || row.kind === "government").map(row => String(row.id)));
    const out = new Map<SliceCard, SliceBody | null>();
    for (const card of wantedCards) {
      const sources: string[] = [], boardsHere: string[] = [], held: SliceBody["entities"][number][] = [];
      for (const entity of entities) {
        const kind = String(entity.kind), mine: Record<string, readonly [unknown, number | null, string | null, string]> = {};
        for (const fact of factsOf.get(String(entity.id)) ?? []) {
          const field = String(fact.field);
          if (cardOfFact(kind, field) !== card) continue;
          const scoped = kind === "person" ? SCOPED_FIELD.exec(field) : null;
          if (scoped && !boards.has(scoped[2]!)) continue;
          let key = field;
          if (scoped) { let board = boardsHere.indexOf(scoped[2]!); if (board < 0) board = boardsHere.push(scoped[2]!) - 1; key = `${scoped[1]}@${board}`; }
          const url = fact.source_copy_id === null ? undefined : copies.get(String(fact.source_copy_id));
          let source: number | null = null;
          if (url !== undefined) { source = sources.indexOf(url); if (source < 0) source = sources.push(url) - 1; }
          mine[key] = [fact.value, source, fact.checked_at ? new Date(fact.checked_at as string).toISOString().slice(0, 10) : null, String(fact.provenance_kind)];
        }
        if (Object.keys(mine).length || cardsOfKind(kind)[0] === card) held.push({ id: String(entity.id), k: kind, n: String(entity.name), p: entity.parent_id === null ? null : String(entity.parent_id), f: mine });
      }
      out.set(card, held.length ? { v: 1, sources, boards: boardsHere, entities: held } : null);
    }
    built.set(place, out);
  }
  return built;
}

/** A slice that reads the same is not written again: its fingerprint is that of what it holds. */
const fingerprint = (body: SliceBody | null): string => createHash("sha256").update(body === null ? "" : JSON.stringify(body)).digest("hex");

/** The only writer of place_slice. Returns how many slices differed from what was held and were written. */
export async function writeSlices(query: Query, built: ReadonlyMap<string, ReadonlyMap<SliceCard, SliceBody | null>>): Promise<number> {
  const places: string[] = [], cards: string[] = [], bodies: (string | null)[] = [], prints: string[] = [];
  for (const [place, slices] of built) for (const [card, body] of slices) {
    places.push(place); cards.push(card); bodies.push(body === null ? null : JSON.stringify(body)); prints.push(fingerprint(body));
  }
  if (!places.length) return 0;
  return (await query(`INSERT INTO place_slice(place_id,card,body,fingerprint) SELECT place_id,card,body::jsonb,fingerprint FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) AS s(place_id,card,body,fingerprint)
    ON CONFLICT(place_id,card) DO UPDATE SET body=EXCLUDED.body,fingerprint=EXCLUDED.fingerprint,built_at=now()
    WHERE place_slice.fingerprint IS DISTINCT FROM EXCLUDED.fingerprint RETURNING place_id`, [places, cards, bodies, prints])).length;
}
