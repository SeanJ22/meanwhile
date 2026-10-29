import type { Query } from "../facts/publish.ts";

/**
 * The only place an entity id is made. Places keep their Open Civic Data division ids. Everything else is
 * `<kind>:<state>:<stable key>`, where the key is the strongest identity the source itself publishes. Every other
 * id a thing has been known by is saved as an alias that points to it, so no stored reference or reader link breaks.
 */

/** The `entity_external_id` scheme under which an older or other id is saved as an alias of the entity that survived. */
export const ID_ALIAS = "body-alias";

export type MintedKind = "government" | "body" | "seat" | "person" | "meeting" | "agenda_item" | "bill" | "vote_event" | "election"
  | "contest" | "candidacy" | "measure" | "measure_provision" | "committee" | "statement" | "law_question" | "news_item";

/** What a source calls a thing: the scheme it names, such as `openstates`, `bioguide`, `fec`, or `legistar:<client>`, and its value. */
export type IdentityKey = readonly [scheme: string, value: string];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OPEN_STATES = new RegExp(`^(?:ocd-person/|plural:(?:[a-z]{2}:)?)?(${UUID})$`, "i");

/**
 * Schemes in the order they are trusted to name a person. A person gets the first one the source supplied. The
 * name a roster printed inside one body (`roster-name:<body>`) is a seat and a name, and is the last resort.
 */
const STRENGTH = ["openstates", "bioguide", "fec", "legiscan", "votesmart", "wikidata", "opensecrets", "followthemoney", "ballotpedia"] as const;

/** Namespaces in which one person holds exactly one value: two different values are two different people. */
const SINGLE_VALUED = new Set(["ocd-person", "congress", "legiscan", "votesmart", "wikidata", "opensecrets", "followthemoney", "ballotpedia"]);
export const isSingleValuedNamespace = (namespace: string): boolean => SINGLE_VALUED.has(namespace);

const BIOGUIDE = /^(?:congress(?:-api)?:)?([A-Z]\d{6})$/;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Eight hex digits of FNV-1a over the text: stable, and free of any server-only module so the browser bundle can carry this file. */
function hash8(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export const isSeatNameScheme = (scheme: string): boolean => scheme.startsWith("roster-name:");

/** `<kind>:<state>:<key>`, lower case. The state is two letters, or `us` for a federal thing. */
export function mintId(kind: MintedKind, state: string | null | undefined, key: string): string {
  const where = state?.trim().toLowerCase() || "us";
  const stable = slug(key);
  if (!/^[a-z]{2}$/.test(where) || !stable) throw new Error(`MINT_ID_INVALID:${kind}`);
  return `${kind}:${where}:${stable}`;
}

/** The keys a person is known by, strongest first. Name keys inside a body come last, since they are only a seat and a name. */
export function strongestKeys(keys: readonly IdentityKey[]): readonly IdentityKey[] {
  const rank = ([scheme]: IdentityKey) => {
    const at = (STRENGTH as readonly string[]).indexOf(scheme);
    return at >= 0 ? at : isSeatNameScheme(scheme) ? STRENGTH.length + 1 : STRENGTH.length;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

/** The id for a person nobody holds yet, from the strongest key the source gave. The same keys always give the same id. */
export function personId(state: string | null | undefined, keys: readonly IdentityKey[]): string {
  const [best] = strongestKeys(keys);
  if (!best) throw new Error("MINT_ID_NEEDS_A_KEY");
  const [scheme, value] = best;
  const openStates = scheme === "openstates" ? OPEN_STATES.exec(value)?.[1] : undefined;
  if (openStates) return mintId("person", state, openStates);
  if (scheme === "bioguide" || scheme === "fec") return mintId("person", state, value);
  if (isSeatNameScheme(scheme)) return mintId("person", state, `${value}-${hash8(scheme)}`);
  return mintId("person", state, `${scheme}-${value}`);
}

/**
 * The keys the matcher compares for an entity: its own id and every external id it holds, written the same way whichever
 * source spelled them. Open States ids (`ocd-person/<uuid>`, `plural:<uuid>`, `plural:<st>:<uuid>`) are one key, and a
 * bioguide id is one key. A seat-and-name key is not an identity and is left out. A bare number is never a key by
 * itself, because two sources number their people independently; it is kept only with the scheme that issued it.
 * Any other value a record lists is a key too, so a record that lists another's id is tied to it.
 */
export function identityKeys(id: string | null, external: readonly IdentityKey[]): readonly string[] {
  const keys = new Set<string>();
  const add = (value: string, own = false) => {
    if (own || !/^\d+$/.test(value)) keys.add(value);
    const openStates = OPEN_STATES.exec(value)?.[1];
    if (openStates) keys.add(`ocd-person:${openStates.toLowerCase()}`);
    const bioguide = BIOGUIDE.exec(value)?.[1];
    if (bioguide) keys.add(`congress:${bioguide}`);
  };
  if (id) add(id, true);
  for (const [scheme, value] of external) {
    if (isSeatNameScheme(scheme) || scheme === ID_ALIAS) continue;
    add(value);
    keys.add(`${scheme}:${value}`);
  }
  return [...keys];
}

/** The surviving ids for any ids that were merged into another, as `alias -> survivor`. An id that is not an alias is absent. */
export async function survivingIds(query: Query, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (!ids.length) return new Map();
  const rows = await query(`SELECT value, entity_id FROM entity_external_id WHERE scheme = '${ID_ALIAS}' AND value = ANY($1::text[])`, [ids]);
  return new Map(rows.map(row => [String(row.value), String(row.entity_id)]));
}

/** Saves `alias` as another name for `survivor`, so a reader link, a stored reaction or a source that still says `alias` finds the survivor. */
export async function saveAlias(query: Query, survivor: string, alias: string): Promise<void> {
  if (survivor === alias) return;
  await query(`INSERT INTO entity_external_id (entity_id, scheme, value) VALUES ($1, '${ID_ALIAS}', $2)
    ON CONFLICT (scheme, value) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [survivor, alias]);
}
