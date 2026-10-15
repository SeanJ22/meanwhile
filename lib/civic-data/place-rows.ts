import { createHash } from "node:crypto";

/** One element of a promoted payload, keyed by the divisions, bodies and targets that select it. */
export interface PlaceRow {
  /** The JSON path of the array or map the element sits in. */
  readonly collection: readonly (string | number)[];
  /** The element's key when the collection is a map. */
  readonly memberKey: string | null;
  readonly ordinal: number;
  /** `d:<division>`, `b:<body>` and `t:<target>`. */
  readonly keys: readonly string[];
  readonly member: unknown;
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
  readonly rows: PlaceRow[] = [];
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
  return { base, rows: b.rows, digests: divisionDigests(b.rows) };
}

/** A body's division is its id before the `#`. */
function divisionsTouched(row: PlaceRow): string[] {
  return row.keys.flatMap(key => key.startsWith("d:") ? [key.slice(2)] : key.startsWith("b:") ? [key.slice(2).split("#")[0]!] : []);
}

function divisionDigests(rows: readonly PlaceRow[]): Map<string, string> {
  const hashes = new Map<string, ReturnType<typeof createHash>>();
  for (const row of rows) for (const division of new Set(divisionsTouched(row))) {
    const hash = hashes.get(division) ?? createHash("sha256");
    hashes.set(division, hash.update(JSON.stringify([row.collection, row.memberKey, row.member])).update("\n"));
  }
  return new Map([...hashes].map(([division, hash]) => [division, hash.digest("hex")]));
}

/** The slice one place reads: the base with each selected row put back where it came from, in its original order. */
export function placeValueOf(base: unknown, rows: readonly Pick<PlaceRow, "collection" | "memberKey" | "ordinal" | "member">[]): unknown {
  const value = structuredClone(base) as Json;
  const ordered = [...rows].sort((a, b) => JSON.stringify(a.collection).localeCompare(JSON.stringify(b.collection)) || a.ordinal - b.ordinal);
  for (const row of ordered) {
    let container: unknown = value;
    for (const step of row.collection) container = (container as Record<string | number, unknown>)[step];
    if (Array.isArray(container)) container.push(row.member);
    else if (row.memberKey !== null) (container as Json)[row.memberKey] = row.member;
  }
  return value;
}

export interface PlaceRowStatement { readonly text: string; readonly params: readonly string[] }

/**
 * Writes one version's rows and its divisions' digests, each statement a no-op unless that version is the scope's
 * current pointer, then drops the version it replaced. `changedAt` marks only divisions whose digest moved.
 */
export function placeRowStatements(input: { readonly recordClass: string; readonly scope: string; readonly versionId: string;
  readonly replaces: string | null; readonly set: PlaceRowSet; readonly changedAt: string }): PlaceRowStatement[] {
  const current = (version: string, rc: string, scope: string) =>
    `EXISTS (SELECT 1 FROM civic_data_promotions WHERE record_class=${rc} AND scope=${scope} AND current_version_id=${version})`;
  const rows = JSON.stringify([{ collection: "", member_key: null, ordinal: 0, keys: [], member: input.set.base },
    ...input.set.rows.map(row => ({ collection: JSON.stringify(row.collection), member_key: row.memberKey, ordinal: row.ordinal, keys: row.keys, member: row.member }))]);
  const digests = JSON.stringify(Object.fromEntries(input.set.digests));
  return [
    { text: `INSERT INTO civic_data_place_rows (version_id, collection, member_key, ordinal, keys, member)
      SELECT $1, r.collection, r.member_key, r.ordinal, ARRAY(SELECT $1 || '|' || k FROM jsonb_array_elements_text(r.keys) k), r.member
      FROM jsonb_to_recordset($2::jsonb) AS r(collection text, member_key text, ordinal integer, keys jsonb, member jsonb)
      WHERE ${current("$1", "$3", "$4")} ON CONFLICT DO NOTHING`, params: [input.versionId, rows, input.recordClass, input.scope] },
    { text: `INSERT INTO civic_data_place_changes (record_class, scope, division_id, digest, changed_at)
      SELECT $1, $2, d.key, d.value, $3::timestamptz FROM jsonb_each_text($4::jsonb) d WHERE ${current("$5", "$1", "$2")}
      ON CONFLICT (record_class, scope, division_id) DO UPDATE SET digest=excluded.digest, changed_at=excluded.changed_at
      WHERE civic_data_place_changes.digest IS DISTINCT FROM excluded.digest`,
      params: [input.recordClass, input.scope, input.changedAt, digests, input.versionId] },
    { text: `UPDATE civic_data_place_changes SET digest='', changed_at=$3::timestamptz
      WHERE record_class=$1 AND scope=$2 AND digest<>'' AND NOT ($4::jsonb ? division_id) AND ${current("$5", "$1", "$2")}`,
      params: [input.recordClass, input.scope, input.changedAt, digests, input.versionId] },
    ...(input.replaces === null || input.replaces === input.versionId ? [] : [{
      text: `DELETE FROM civic_data_place_rows WHERE version_id=$1 AND ${current("$2", "$3", "$4")}`,
      params: [input.replaces, input.versionId, input.recordClass, input.scope] }]),
  ];
}

/** Current pointers of place-sliced classes with no rows yet, oldest promotion first. */
export const UNBUILT_PLACE_ROWS_SQL = `SELECT p.record_class, p.scope, p.current_version_id, p.promoted_at::text AS promoted_at FROM civic_data_promotions p
  WHERE p.record_class IN (SELECT jsonb_array_elements_text($1::jsonb)) AND NOT EXISTS (SELECT 1 FROM civic_data_place_rows r WHERE r.version_id=p.current_version_id AND r.collection='')
  ORDER BY p.promoted_at`;
