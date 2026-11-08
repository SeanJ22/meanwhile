import { censusWorkDivision } from "../census-geography/division-id.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { stateVersion, type ReaderStatePackage } from "./state.ts";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the held records of many shapes, read by field
/** A record and its position in the state's own list, which a composition restores. */
export type Placed = readonly [number, unknown];

/**
 * A state's answer, cut by division. The state's file holds what no division owns; each division's file holds its share, and a ZIP's answer is the
 * state's statewide part with the shares of the divisions it lies in. Nothing here is specific to one reader.
 */
export interface StateWide {
  readonly state: string;
  /** The versions of the entries the answer is read from, which its version is the hash of. */
  readonly versions: { readonly runtime?: string; readonly people?: string; readonly federal?: string; readonly campaigns?: string; readonly offices?: string; readonly ballot?: string; readonly geography: string };
  readonly boundaryUrl: string;
  readonly stateLegislatorAuthority: unknown;
  /** The people, federal and ballot entries as read, without the records the divisions hold. */
  readonly reads: { readonly people: Row; readonly federal: Row; readonly ballot: Row };
  /** The registry, the rosters and the Census scopes without the records the divisions share out. */
  readonly rest: { readonly registry: Row; readonly people: Row | null; readonly legislativePeople: Row | null; readonly federal: Row | null; readonly scopes: readonly Row[] | null };
}
/** Placed records by part. */
export type StateShare = Readonly<Record<string, readonly Placed[]>>;

const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
export const stateDivisionId = (state: string): string => {
  const place = Object.values(FIPS_TO_STATE).find(row => row.postal === state)!;
  return `ocd-division/country:us/${place.prefix}:${state.toLowerCase()}`;
};
/** The rosters of the package, and what each division holds of a roster: its links, holders, vacancies, ended memberships, disagreements and unmatched seats. */
const ROSTERS = [["people", "people"], ["legislative", "legislativePeople"]] as const;
const ROSTER_LISTS = { divisions: "links", officeholders: "holders", vacancies: "vacancies", endedMemberships: "ended", disagreements: "disagreements", unmatched: "unmatched" } as const;
/** What a ballot holds by contest, and what by division. */
const BALLOT_BY_CONTEST = ["candidacies", "measures", "measureRecords", "filingCandidacies"] as const;
const BALLOT_LISTS = ["contests", "absences", "candidateTickets", ...BALLOT_BY_CONTEST] as const;

/**
 * Cuts a state's whole package, with the divisions of its registration, into the statewide part and a share for each division. `probe` is the state read
 * for one ZIP: the entries read for a ZIP carry their own dates and versions, which are not those of the whole state's read.
 */
export function cutState(pkg: ReaderStatePackage, registration: readonly Row[], probe: ReaderStatePackage): {
  readonly wide: StateWide; readonly shares: ReadonlyMap<string, StateShare>;
  /** The Census districts that reach into each ZIP: its answer is made from them beside the places of its map. */
  readonly zipDistricts: ReadonlyMap<string, readonly string[]>;
} {
  const own = stateDivisionId(pkg.state), parts = new Map<string, Map<string, Map<number, unknown>>>();
  const give = (division: string | null | undefined, part: string, at: number, item: unknown) => {
    const shares = parts.get(division || own) ?? new Map<string, Map<number, unknown>>();
    parts.set(division || own, shares);
    const held = shares.get(part) ?? new Map<number, unknown>();
    shares.set(part, held); held.set(at, item);
  };
  const giveAll = (owners: readonly string[], part: string, at: number, item: unknown) => { if (owners.length) for (const place of owners) give(place, part, at, item); else give(null, part, at, item); };
  const registry = pkg.registry as unknown as Row, divisions = rows(registry.registry.divisions), byId = new Map(divisions.map(row => [row.ocdId as string, row]));
  const position = new Map(divisions.map((row, n) => [row.ocdId as string, n]));
  for (const [n, row] of divisions.entries()) { give(row.ocdId, "divisions", n, row); if (row.canonicalOcdId) give(row.canonicalOcdId, "divisions", n, row); }
  for (const [n, body] of rows(registry.registry.bodies).entries()) {
    if (!body.ocdId || !["national", "state"].includes(byId.get(body.ocdId)?.tier)) continue;
    const served = [body.ocdId, ...rows(body.alsoServesOcdIds) as unknown as string[]];
    for (const place of served) {
      give(place, "bodies", n, body);
      for (const id of served) if (position.has(id)) give(place, "divisions", position.get(id)!, byId.get(id));
    }
  }
  // Who sits in which division: the people linked to it and, with them, every record held for the same person under another id or spelling of the name.
  const people = new Map<string, Set<string>>();
  const keys = (holder: Row) => [...personIdentityKeys(holder as never)];
  const sets: [string, Row | null][] = [...ROSTERS.map(([name, field]): [string, Row | null] => [name, pkg[field] as unknown as Row | null]), ["federal", (pkg.federal as unknown as Row | null)?.roster ?? null]];
  const nodes = sets.flatMap(([, set], s) => rows(set?.officeholders).map((holder, at) => ({ s, at, holder })));
  const root = nodes.map((_, n) => n), find = (n: number): number => (root[n] === n ? n : (root[n] = find(root[n]!)));
  const labelled = new Map<string, number>(), nodeAt = new Map(nodes.map((node, n) => [`${node.s}:${node.at}`, n]));
  for (const [n, { holder }] of nodes.entries()) for (const label of [...keys(holder).map(key => `i:${key}`), `n:${String(holder.name ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "")}`]) {
    if (label === "n:") continue;
    const first = labelled.get(label);
    if (first === undefined) labelled.set(label, n); else root[find(n)] = find(first);
  }
  const members = new Map<number, number[]>();
  for (const n of nodes.keys()) members.set(find(n), [...members.get(find(n)) ?? [], n]);
  const reach = new Map<string, Set<number>>(), linksOf = sets.map(([, set]) => new Map<string, number[]>());
  for (const [s, [, set]] of sets.entries()) {
    const index = new Map(rows(set?.officeholders).map((holder, at) => [holder.id as string, at]));
    for (const [n, link] of rows(set?.divisions).entries()) {
      const at = index.get(link.officeholderId);
      linksOf[s]!.set(link.officeholderId, [...linksOf[s]!.get(link.officeholderId) ?? [], n]);
      if (at !== undefined) reach.set(link.ocdId, (reach.get(link.ocdId) ?? new Set()).add(find(nodeAt.get(`${s}:${at}`)!)));
    }
  }
  for (const [division, roots] of reach) for (const r of roots) for (const n of members.get(r)!) {
    const { s, at, holder } = nodes[n]!, name = sets[s]![0], set = sets[s]![1]!;
    give(division, `${name}.holders`, at, holder);
    for (const link of linksOf[s]!.get(holder.id) ?? []) give(division, `${name}.links`, link, rows(set.divisions)[link]);
    for (const id of keys(holder)) people.set(id, (people.get(id) ?? new Set()).add(division));
  }
  for (const executive of rows(registry.statewideExecutives)) for (const id of keys(executive.holder)) people.set(id, (people.get(id) ?? new Set()).add(own));
  const where = (id: string | undefined | null) => (id ? [...people.get(id) ?? []] : []);
  for (const [name, set] of sets) {
    if (!set) continue;
    for (const [n, row] of rows(set.vacancies).entries()) give(row.ocdId, `${name}.vacancies`, n, row);
    for (const [n, row] of rows(set.endedMemberships).entries()) giveAll([...(row.divisionId ? [row.divisionId] : []), ...where(row.personId)], `${name}.ended`, n, row);
    for (const [n, row] of rows(set.disagreements).entries()) for (const place of where(row.personId)) give(place, `${name}.disagreements`, n, row);
    for (const [n, row] of rows(set.unmatched).entries()) for (const place of where(row.officeholderId)) give(place, `${name}.unmatched`, n, row);
  }
  const federal = pkg.federal as unknown as Row | null, byMember = Object.entries((federal?.directory?.byMember ?? {}) as Row);
  for (const [division, roots] of reach) for (const r of roots) for (const n of members.get(r)!) {
    const { s, holder } = nodes[n]!, entry = s === 2 ? byMember.findIndex(([id]) => `congress:${id}` === holder.id) : -1;
    if (entry >= 0) give(division, "federal.members", entry, byMember[entry]);
  }
  for (const [n, vacancy] of rows(federal?.vacancies).entries()) give(vacancy.ocdId, "federal.vacancies", n, vacancy);
  for (const [n, row] of rows(registry.officialCandidacies.rows).entries()) giveAll([...rows(row.holder.divisions) as unknown as string[], ...where(row.holder.id)], "candidacies", n, row);
  for (const [n, photo] of rows(registry.officialPhotos.photos).entries()) giveAll(where(photo.officeholderId), "photos", n, photo);
  for (const [n, record] of (pkg.memberOffices as unknown as Row[]).entries()) giveAll(where(record.officeholderId), "offices", n, record);
  const held = pkg.districts.kind === "HELD" ? pkg.districts : null;
  const zipDistricts = new Map<string, string[]>();
  for (const [n, container] of (held?.value.containers ?? []).entries()) {
    const id = censusWorkDivision(container.ref);
    if (!id) continue;
    give(id, "containers", n, { ref: container.ref });
    for (const overlap of container.overlaps ?? []) zipDistricts.set(overlap.zcta5, [...zipDistricts.get(overlap.zcta5) ?? [], id]);
  }
  for (const [n, row] of registration.entries()) give(row.ocdId, "local", n, row);
  // A ballot goes by contest to the division of the contest.
  const ballotRead = pkg.ballotRead, ballots = (ballotRead?.kind === "PROMOTED" || ballotRead?.kind === "BOOTSTRAP" ? (ballotRead.value as unknown as Row).ballots : {}) as Row;
  for (const [key, ballot] of Object.entries(ballots)) {
    const contestPlace = new Map(rows(ballot.contests).map(contest => [contest.id as string, contest.ocdId as string]));
    const candidacyContest = new Map(rows(ballot.candidacies).map(candidacy => [candidacy.id as string, candidacy.contestId as string]));
    for (const list of BALLOT_LISTS) for (const [n, row] of rows(ballot[list]).entries()) {
      const contest = list === "candidateTickets" ? candidacyContest.get(row.leadCandidacyId) : list === "contests" || list === "absences" ? undefined : row.contestId;
      give(list === "contests" || list === "absences" ? row.ocdId : contestPlace.get(contest as string), `ballot.${key}.${list}`, n, row);
    }
  }

  const empty = (set: Row | null, drop: readonly string[]): Row | null => set && Object.fromEntries(Object.entries(set).filter(([key]) => !drop.includes(key)));
  const versions = pkg.versionParts, seen = probe.versionParts;
  const rosterRest = (set: Row | null) => empty(set, Object.keys(ROSTER_LISTS));
  const read = (value: Row | undefined, drop: readonly string[]) => value && ({ ...value, projection: undefined, value: empty((value.value ?? null) as Row | null, drop) });
  const wide: StateWide = {
    state: pkg.state, boundaryUrl: pkg.boundaryUrl, stateLegislatorAuthority: probe.stateLegislatorAuthority,
    versions: { runtime: seen[0], people: seen[1], federal: seen[2], campaigns: seen[3], offices: versions[4], ballot: seen[7], geography: seen[8]! },
    reads: { people: read(probe.peopleRead as unknown as Row, ["roster"])!, federal: read(probe.federalRead as unknown as Row, Object.keys({ roster: 1, directory: 1, vacancies: 1 }))!,
      ballot: { ...read(probe.ballotRead as unknown as Row, ["ballots"])!, ballots: Object.fromEntries(Object.entries(ballots).map(([key, ballot]) => [key, empty(ballot, BALLOT_LISTS)])) } },
    rest: {
      registry: { ...registry, registry: { generatedAt: registry.registry.generatedAt }, officialPhotos: empty(registry.officialPhotos, ["photos"]),
        officialCandidacies: empty(registry.officialCandidacies, ["rows"]), bodyRosters: [] },
      people: rosterRest(pkg.people as unknown as Row | null), legislativePeople: rosterRest(pkg.legislativePeople as unknown as Row | null),
      federal: federal && { ...federal, roster: rosterRest(federal.roster), vacancies: [], directory: { ...federal.directory, byMember: {} } },
      scopes: held ? held.value.scopes as unknown as Row[] : null,
    },
  };
  const shares = new Map([...parts].map(([division, byPart]) => [division,
    Object.fromEntries([...byPart].map(([part, items]) => [part, [...items].sort(([a], [b]) => a - b)])) as StateShare]));
  return { wide, shares, zipDistricts };
}

/** The package a ZIP's answer is made from: the statewide part and the shares of the ZIP's divisions. */
export function composeState(wide: StateWide, shares: readonly StateShare[]): ReaderStatePackage {
  const union = (part: string): any[] => [...new Map(shares.flatMap(share => share[part] ?? []).sort(([a], [b]) => a - b)).values()]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const roster = (name: string, rest: Row | null): Row | null => rest && { ...rest, ...Object.fromEntries(Object.entries(ROSTER_LISTS).flatMap(([field, part]) =>
    name === "federal" && field === "vacancies" ? [] : [[field, union(`${name}.${part}`)]])) };
  const { rest, versions } = wide, localDivisions = union("local"), people = roster("people", rest.people);
  const members = new Map(shares.flatMap(share => share["federal.members"] ?? []).sort(([a], [b]) => a - b).map(([, entry]) => entry as [string, unknown]));
  const federal = rest.federal && { ...rest.federal, roster: roster("federal", rest.federal.roster), vacancies: union("federal.vacancies"),
    directory: { ...rest.federal.directory, byMember: Object.fromEntries(members) } };
  const ballots = Object.fromEntries(Object.entries((wide.reads.ballot.ballots ?? {}) as Row).map(([key, ballot]) =>
    [key, { ...ballot, ...Object.fromEntries(BALLOT_LISTS.map(list => [list, union(`ballot.${key}.${list}`)])) }]));
  const parts = [versions.runtime, versions.people, versions.federal, versions.campaigns, versions.offices, undefined, undefined, versions.ballot, versions.geography, "null", JSON.stringify(localDivisions)];
  return {
    state: wide.state, version: stateVersion(parts), versionParts: parts, boundaryUrl: wide.boundaryUrl, stateLegislatorAuthority: wide.stateLegislatorAuthority,
    peopleRead: { ...wide.reads.people, value: { ...wide.reads.people.value, roster: people } }, federalRead: { ...wide.reads.federal, value: federal },
    ballotRead: { ...wide.reads.ballot, value: { ...wide.reads.ballot.value, ballots } },
    districts: rest.scopes ? { kind: "HELD", versionId: versions.geography, value: { scopes: rest.scopes, containers: union("containers") } } : { kind: "NOT_PUBLISHED" },
    localDivisions, memberOffices: union("offices"), people, legislativePeople: roster("legislative", rest.legislativePeople), federal,
    registry: { ...rest.registry, registry: { ...rest.registry.registry, divisions: union("divisions"), bodies: union("bodies") },
      officialPhotos: { ...rest.registry.officialPhotos, photos: union("photos") }, officialCandidacies: { ...rest.registry.officialCandidacies, rows: union("candidacies") } },
  } as unknown as ReaderStatePackage;
}
