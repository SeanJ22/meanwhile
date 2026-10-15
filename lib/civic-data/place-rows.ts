import { createHash } from "node:crypto";

/** One element of a promoted payload, keyed by the divisions, bodies and targets that select it. */
interface PlaceElement {
  /** The JSON path of the array or map the element sits in. */
  readonly collection: readonly (string | number)[];
  /** The element's key when the collection is a map. */
  readonly memberKey: string | null;
  readonly ordinal: number;
  /** `d:<division>`, `b:<body>` and `t:<target>`. */
  readonly keys: readonly string[];
  readonly member: unknown;
}

/** The elements of one collection that answer to exactly the same divisions, bodies and targets: a body's meetings, a contest's candidacies. */
export interface PlaceRow {
  readonly collection: string;
  readonly groupKey: string;
  readonly keys: readonly string[];
  readonly digest: string;
  readonly members: readonly { readonly o: number; readonly k: string | null; readonly m: unknown }[];
}

export interface PlaceRowSet {
  /** The payload with every sliced collection emptied; what every place reads. */
  readonly base: unknown;
  readonly rows: readonly PlaceRow[];
  /** One digest per division the rows touch, so a promotion can tell which places changed. */
  readonly digests: ReadonlyMap<string, string>;
}

export const PLACE_ROW_CLASSES: ReadonlySet<string> = new Set(["REGISTRY_RUNTIME_BINDING", "MEETING", "MEETING_OUTCOME",
  "FEDERAL_DIRECTORY", "STATE_LEGISLATOR", "BALLOT_CANDIDACY", "BALLOT_FILING", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION",
  "CURATED_READER_RECORD", "FEC_FUNDING", "STATE_CAMPAIGN_FINANCE", "VOTING_SITE", "CENSUS_GEOGRAPHY"]);

const DERIVED_CAMPAIGN_SITES = "US:candidate-campaign-sites-derived";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string[] => typeof value === "string" && value !== "" ? [value] : [];
const texts = (value: unknown): string[] => array(value).flatMap(text);
const without = (value: unknown, ...keys: string[]): Json => Object.fromEntries(Object.entries(object(value)).filter(([key]) => !keys.includes(key)));
const divisionsOf = (x: Json) => [...text(x.ocdId), ...text(x.divisionId)];

interface Matched { readonly divisions?: readonly string[]; readonly bodies?: readonly string[]; readonly targets?: readonly string[] }

class Builder {
  readonly rows: PlaceElement[] = [];
  private readonly ordinals = new Map<string, number>();
  add(collection: readonly (string | number)[], member: unknown, match: Matched, memberKey: string | null = null): void {
    const path = JSON.stringify(collection);
    const ordinal = this.ordinals.get(path) ?? 0;
    this.ordinals.set(path, ordinal + 1);
    const keys = [...new Set([...(match.divisions ?? []).map(id => `d:${id}`), ...(match.bodies ?? []).map(id => `b:${id}`),
      ...(match.targets ?? []).map(id => `t:${id}`)])];
    if (keys.length) this.rows.push({ collection, memberKey, ordinal, keys, member });
  }
}

function ballotRows(builder: Builder, ballot: unknown, at: readonly (string | number)[], lineup?: unknown): Json {
  const contests = array(object(ballot).contests).map(object);
  const placeOf = new Map(contests.map(contest => [String(contest.id), divisionsOf(contest)] as const));
  for (const contest of contests) builder.add([...at, "contests"], contest, { divisions: divisionsOf(contest) });
  for (const key of ["candidacies", "measures"] as const) for (const row of array(object(ballot)[key]).map(object)) {
    builder.add([...at, key], row, { divisions: placeOf.get(String(row.contestId)) ?? [] });
  }
  for (const row of array(object(lineup).contests).map(object)) builder.add(["generalLineup", "contests"], row, { divisions: placeOf.get(String(row.contestId)) ?? [] });
  return { ...without(ballot, "contests", "candidacies", "measures"), contests: [], candidacies: [], measures: [] };
}

/** Splits a promoted payload into what every place reads and one row per element a place selects. */
export function placeRowsOf(recordClass: string, scope: string, payload: unknown): PlaceRowSet {
  const b = new Builder();
  const p = object(payload);
  let base: unknown;
  if (recordClass === "REGISTRY_RUNTIME_BINDING") {
    const registry = object(p.registry);
    for (const x of array(registry.divisions).map(object)) b.add(["registry", "divisions"], x, { divisions: divisionsOf(x) });
    for (const x of array(registry.bodies).map(object)) b.add(["registry", "bodies"], x, { divisions: [...divisionsOf(x), ...texts(x.alsoServesOcdIds)], bodies: text(x.id) });
    for (const x of array(p.statewideExecutives).map(object)) b.add(["statewideExecutives"], x, { divisions: text(x.stateOcdId) });
    for (const x of array(object(p.officialCandidacies).rows).map(object)) b.add(["officialCandidacies", "rows"], x, { divisions: texts(object(x.holder).divisions) });
    base = { registry: { divisions: [], bodies: [] }, statewideExecutives: [], officialCandidacies: { rows: [] } };
  } else if (recordClass === "MEETING" || recordClass === "MEETING_OUTCOME") {
    const key = recordClass === "MEETING" ? "meetings" : "sittings";
    for (const x of array(p[key]).map(object)) b.add([key], x, { divisions: divisionsOf(x), bodies: text(x.bodyId) });
    base = { [key]: [] };
  } else if (recordClass === "FEDERAL_DIRECTORY" || recordClass === "STATE_LEGISLATOR") {
    const roster = object(p.roster);
    const placesOf = new Map<string, string[]>();
    for (const x of array(roster.divisions).map(object)) {
      b.add(["roster", "divisions"], x, { divisions: divisionsOf(x) });
      for (const id of text(x.officeholderId)) placesOf.set(id, [...placesOf.get(id) ?? [], ...divisionsOf(x)]);
    }
    for (const x of array(roster.officeholders).map(object)) b.add(["roster", "officeholders"], x, { divisions: placesOf.get(String(x.id)) ?? [] });
    base = { roster: { ...without(roster, "divisions", "officeholders", "unmatched"), divisions: [], officeholders: [], unmatched: [] } };
  } else if ((recordClass === "BALLOT_CANDIDACY" || recordClass === "BALLOT_FILING") && p.ballots !== undefined) {
    const ballots = Object.fromEntries(Object.entries(object(p.ballots)).map(([key, ballot]) => [key, ballotRows(b, ballot, ["ballots", key])]));
    base = { ...without(p, "ballots"), ballots };
  } else if (recordClass === "BALLOT_CANDIDACY" || recordClass === "BALLOT_FILING") {
    base = { ballot: ballotRows(b, p.ballot, ["ballot"], p.generalLineup), generalLineup: { contests: [] } };
  } else if (recordClass === "CANDIDATE_PROFILE") {
    for (const key of ["cards", "links"] as const) for (const [member, value] of Object.entries(object(object(p[key])[key]))) {
      b.add([key, key], value, { targets: [member] }, member);
    }
    base = { cards: { cards: {} }, links: { links: {} } };
  } else if (recordClass === "CANDIDATE_PUBLICATION") {
    for (const x of array(p.documents).map(object)) b.add(["documents"], x, { targets: text(x.candidateKey) });
    base = { documents: [] };
  } else if (recordClass === "CURATED_READER_RECORD" && scope === DERIVED_CAMPAIGN_SITES) {
    for (const key of ["records", "portraits"] as const) for (const x of array(p[key]).map(object)) b.add([key], x, { targets: [...text(x.id), ...text(x.candidacyId)] });
    base = { ...without(p, "records", "portraits"), records: [], portraits: [] };
  } else if (recordClass === "FEC_FUNDING") {
    for (const x of array(p.candidates).map(object)) b.add(["candidates"], x, { targets: texts(x.targetKeys) });
    base = { ...without(p, "candidates"), candidates: [] };
  } else if (recordClass === "STATE_CAMPAIGN_FINANCE") {
    for (const x of array(p.records).map(object)) b.add(["records"], x, { targets: texts(x.targetKeys) });
    base = { ...without(p, "records"), records: [] };
  } else if (recordClass === "VOTING_SITE") {
    for (const x of array(p.jurisdictions).map(object)) b.add(["jurisdictions"], x, { divisions: divisionsOf(x) });
    base = { ...without(p, "jurisdictions"), jurisdictions: [] };
  } else if (recordClass === "CENSUS_GEOGRAPHY") {
    const scopes = array(p.scopes).map(object).map((meta, i) => {
      for (const grouping of array(meta.groupings).map(object)) b.add(["scopes", i, "groupings"], without(grouping, "overlaps"),
        { divisions: text(grouping.ocdId), targets: text(grouping.geoid).map(geoid => `${String(meta.type)}:${geoid}`) });
      return { ...without(meta, "groupings"), groupings: [] };
    });
    base = { scopes };
  } else {
    for (const x of array(p.records).map(object)) b.add(["records"], x, { divisions: [...divisionsOf(x), ...text(x.stateOcdId)] });
    base = { ...without(p, "records"), records: [] };
  }
  const rows = groupRows(b.rows);
  return { base, rows, digests: divisionDigests(rows) };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function groupRows(elements: readonly PlaceElement[]): PlaceRow[] {
  const groups = new Map<string, { collection: string; keys: string[]; members: PlaceRow["members"][number][] }>();
  for (const element of elements) {
    const collection = JSON.stringify(element.collection), keys = [...element.keys].sort();
    const id = `${collection}\n${keys.join("\n")}`;
    const group = groups.get(id) ?? { collection, keys, members: [] };
    groups.set(id, group);
    group.members.push({ o: element.ordinal, k: element.memberKey, m: element.member });
  }
  return [...groups.entries()].map(([id, group]) => ({ ...group, groupKey: sha(id).slice(0, 32), digest: sha(JSON.stringify(group.members)) }));
}

/** A body's division is its id before the `#`. */
function divisionsTouched(row: PlaceRow): string[] {
  return row.keys.flatMap(key => key.startsWith("d:") ? [key.slice(2)] : key.startsWith("b:") ? [key.slice(2).split("#")[0]!] : []);
}

function divisionDigests(rows: readonly PlaceRow[]): Map<string, string> {
  const hashes = new Map<string, ReturnType<typeof createHash>>();
  for (const row of rows) for (const division of new Set(divisionsTouched(row))) {
    hashes.set(division, (hashes.get(division) ?? createHash("sha256")).update(row.digest));
  }
  return new Map([...hashes].map(([division, hash]) => [division, hash.digest("hex")]));
}

/** The slice one place reads: the base with each selected element put back where it came from, in its original order. */
export function placeValueOf(base: unknown, rows: readonly Pick<PlaceRow, "collection" | "members">[]): unknown {
  const value = structuredClone(base) as Json;
  const elements = rows.flatMap(row => row.members.map(member => ({ collection: row.collection, ...member })))
    .sort((a, b) => a.collection.localeCompare(b.collection) || a.o - b.o);
  for (const element of elements) {
    let container: unknown = value;
    for (const step of JSON.parse(element.collection) as (string | number)[]) container = (container as Record<string | number, unknown>)[step];
    if (Array.isArray(container)) container.push(element.m);
    else if (element.k !== null) (container as Json)[element.k] = element.m;
  }
  return value;
}

export interface PlaceRowStatement { readonly text: string; readonly params: readonly string[] }

/** What a scope's rows already hold, so a promotion writes only the groups that changed. */
export const HELD_PLACE_ROWS_SQL = `SELECT collection || '|' || group_key AS id, digest FROM civic_data_place_rows WHERE record_class=$1 AND scope=$2`;

/**
 * Brings a scope's rows to one version: its base, the groups whose digest moved, and none of the groups it no longer has, each
 * statement a no-op unless that version is the scope's current pointer. Divisions whose digest moved are marked changed at `changedAt`.
 */
export function placeRowStatements(input: { readonly recordClass: string; readonly scope: string; readonly versionId: string;
  readonly set: PlaceRowSet; readonly held: ReadonlyMap<string, string>; readonly changedAt: string }): PlaceRowStatement[] {
  const current = (version: string) =>
    `EXISTS (SELECT 1 FROM civic_data_promotions WHERE record_class=$1 AND scope=$2 AND current_version_id=${version})`;
  const changed = input.set.rows.filter(row => input.held.get(`${row.collection}|${row.groupKey}`) !== row.digest);
  const groups = JSON.stringify([{ collection: "", group_key: "", keys: [], digest: "", members: input.set.base },
    ...changed.map(row => ({ collection: row.collection, group_key: row.groupKey, keys: row.keys, digest: row.digest, members: row.members }))]);
  const ids = JSON.stringify(input.set.rows.map(row => `${row.collection}|${row.groupKey}`));
  const digests = JSON.stringify(Object.fromEntries(input.set.digests));
  const scoped = [input.recordClass, input.scope];
  return [
    { text: `INSERT INTO civic_data_place_rows (record_class, scope, collection, group_key, version_id, keys, digest, members)
      SELECT $1, $2, g.collection, g.group_key, $3, ARRAY(SELECT $1 || '|' || $2 || '|' || k FROM jsonb_array_elements_text(g.keys) k), g.digest, g.members
      FROM jsonb_to_recordset($4::jsonb) AS g(collection text, group_key text, keys jsonb, digest text, members jsonb) WHERE ${current("$3")}
      ON CONFLICT (record_class, scope, collection, group_key) DO UPDATE
        SET version_id=excluded.version_id, keys=excluded.keys, digest=excluded.digest, members=excluded.members`,
      params: [...scoped, input.versionId, groups] },
    { text: `DELETE FROM civic_data_place_rows r WHERE r.record_class=$1 AND r.scope=$2 AND r.collection<>'' AND ${current("$3")}
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text($4::jsonb) i WHERE i = r.collection || '|' || r.group_key)`,
      params: [...scoped, input.versionId, ids] },
    { text: `INSERT INTO civic_data_place_changes (record_class, scope, division_id, digest, changed_at)
      SELECT $1, $2, d.key, d.value, $4::timestamptz FROM jsonb_each_text($5::jsonb) d WHERE ${current("$3")}
      ON CONFLICT (record_class, scope, division_id) DO UPDATE SET digest=excluded.digest, changed_at=excluded.changed_at
      WHERE civic_data_place_changes.digest IS DISTINCT FROM excluded.digest`,
      params: [...scoped, input.versionId, input.changedAt, digests] },
    { text: `UPDATE civic_data_place_changes SET digest='', changed_at=$4::timestamptz
      WHERE record_class=$1 AND scope=$2 AND digest<>'' AND NOT ($5::jsonb ? division_id) AND ${current("$3")}`,
      params: [...scoped, input.versionId, input.changedAt, digests] },
  ];
}

/** Current pointers of place-sliced classes whose rows are not at that version, oldest promotion first. */
export const UNBUILT_PLACE_ROWS_SQL = `SELECT p.record_class, p.scope, p.current_version_id, p.promoted_at::text AS promoted_at FROM civic_data_promotions p
  WHERE p.record_class IN (SELECT jsonb_array_elements_text($1::jsonb)) AND NOT EXISTS (SELECT 1 FROM civic_data_place_rows r
    WHERE r.record_class=p.record_class AND r.scope=p.scope AND r.collection='' AND r.group_key='' AND r.version_id=p.current_version_id)
  ORDER BY p.promoted_at`;
