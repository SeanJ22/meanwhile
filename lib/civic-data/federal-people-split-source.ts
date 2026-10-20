import { PUBLISHED_ARRAY_SLICE_SQL, PUBLISHED_NORMALIZED_ARRAY_SLICE_SQL, readPublishedArraySlice, type PublishedArraySlice } from "./published-array-slice.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { withHistoryIndex, type HistoryIndex } from "../control-plane/workers/streamed-history.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryContractId, federalDirectoryForState, heldDirectoryCandidate,
  type FederalDirectoryCapture, type FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import { federalMemberVotesCandidate, federalRollCallsCandidate, FEDERAL_ROLLCALL_SCOPE,
  type FederalRollCallWindow, type FederalRollCallsReadModel, type HeldAcquisition } from "../votes/data-plane.ts";
import type { MemberVote } from "../votes/types.ts";
import { parseResultTally, type PartyTally } from "../votes/party-breakdown.ts";
import type { RoutineCandidate, RoutineRecordClass } from "./types.ts";
import type { FederalPeopleCount, FederalPeopleSplitCount } from "./federal-people-split.ts";
import type { ManualProductionContractId } from "./manual-contracts.ts";

const DIRECTORY_SCOPE = "US:current-congress-directory";
const pattern = (ids: readonly string[]) => ids.length ? `^(?:${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$` : "a^";
type SliceOptions = Omit<Parameters<typeof readPublishedArraySlice>[0], "query" | "recordClass" | "scope">;
type Statement = ReturnType<HistoryIndex["prepare"]>;
export interface FederalPeopleSplitCandidate {
  readonly candidate: RoutineCandidate; readonly contractId: ManualProductionContractId; readonly from: string; readonly expectedCurrentVersion?: string;
  readonly replaceLegacyPositions?: boolean;
}
export interface HeldFederalPeopleSplit {
  readonly count: FederalPeopleSplitCount;
  candidates(): Iterable<FederalPeopleSplitCandidate>;
}

class HeldSource {
  private identity: PublishedArraySlice<unknown>["input"] | null = null;
  private readonly recordClass: RoutineRecordClass;
  private readonly scope: string;
  private readonly query: ReadOnlyQuery;
  constructor(recordClass: RoutineRecordClass, scope: string, query: ReadOnlyQuery) {
    this.recordClass = recordClass; this.scope = scope; this.query = query;
  }
  async read<T>(options: SliceOptions): Promise<PublishedArraySlice<T>> {
    const read = await readPublishedArraySlice<T>({ ...options, recordClass: this.recordClass, scope: this.scope, query: this.query });
    if (!read) throw new Error(`FEDERAL_SPLIT_SOURCE_UNAVAILABLE:${this.scope}`);
    if (this.identity && (read.input.versionId !== this.identity.versionId || read.input.readModelSha256 !== this.identity.readModelSha256))
      throw new Error(`FEDERAL_SPLIT_SOURCE_MOVED:${this.scope}`);
    this.identity ??= read.input;
    return read;
  }
  /** Only fixed-size pages of scheduling identities cross the connection. */
  async visitMetadata<T>(options: SliceOptions, visit: (row: T) => void): Promise<void> {
    let cursor: unknown = [], count = 0;
    do {
      count = 0;
      const query: ReadOnlyQuery = async statements => {
        const results = [];
        for (const statement of statements) {
          if (statement.text !== PUBLISHED_ARRAY_SLICE_SQL && statement.text !== PUBLISHED_NORMALIZED_ARRAY_SLICE_SQL) {
            results.push((await this.query([statement]))[0]);
            continue;
          }
          const parameter = statement.params.length + 1;
          const [rows] = await this.query([{ text: `WITH split_page AS (${statement.text})
            SELECT * FROM split_page WHERE row_kind='publication' OR ordinal>$${parameter}::bigint[]
            ORDER BY ordinal NULLS FIRST LIMIT 129`, params: [...statement.params, cursor] }]);
          const records = rows.filter(row => row.row_kind === "record");
          count = records.length;
          if (count) cursor = records.at(-1)!.ordinal;
          results.push(rows);
        }
        return results;
      };
      const read = await readPublishedArraySlice<T>({ ...options, recordClass: this.recordClass, scope: this.scope, query });
      if (!read) throw new Error(`FEDERAL_SPLIT_SOURCE_UNAVAILABLE:${this.scope}`);
      if (this.identity && (read.input.versionId !== this.identity.versionId || read.input.readModelSha256 !== this.identity.readModelSha256))
        throw new Error(`FEDERAL_SPLIT_SOURCE_MOVED:${this.scope}`);
      this.identity ??= read.input;
      for (const row of read.records) visit(row);
    } while (count === 128);
  }
  async object<T>(path: readonly string[], omitKeys: readonly string[] = [], keepKeys?: readonly string[]): Promise<T> {
    const read = await this.read<T>({ path, statePath: [], statePattern: ".*", objectRecord: true, omitKeys, keepKeys });
    if (!read.records[0]) throw new Error(`FEDERAL_SPLIT_SOURCE_SHAPE:${this.scope}:${path.join(".")}`);
    return read.records[0];
  }
}

async function stateDirectory(source: HeldSource, state: string): Promise<FederalDirectoryReadModel> {
  const header = await source.object<Omit<FederalDirectoryReadModel, "roster" | "directory" | "vacancies">>([], ["roster", "directory", "vacancies"]);
  const roster = await source.object<Omit<FederalDirectoryReadModel["roster"], "officeholders" | "divisions" | "unmatched">>(["roster"], ["officeholders", "divisions", "unmatched"]);
  const directory = await source.object<Omit<FederalDirectoryReadModel["directory"], "byMember" | "committees">>(["directory"], ["byMember", "committees"]);
  const officeholders = (await source.read<FederalDirectoryReadModel["roster"]["officeholders"][number]>({ path: ["roster", "officeholders"], statePath: ["state"], statePattern: `^${state}$` })).records;
  const ids = officeholders.map(holder => holder.id), own = { statePath: ["officeholderId"], statePattern: pattern(ids) };
  const divisions = (await source.read<FederalDirectoryReadModel["roster"]["divisions"][number]>({ path: ["roster", "divisions"], ...own })).records;
  const unmatched = (await source.read<FederalDirectoryReadModel["roster"]["unmatched"][number]>({ path: ["roster", "unmatched"], ...own })).records;
  const byMember = await source.object<FederalDirectoryReadModel["directory"]["byMember"]>(["directory", "byMember"], [], ids.map(id => id.slice(9)));
  const committees = await source.object<FederalDirectoryReadModel["directory"]["committees"]>(["directory", "committees"], [],
    [...new Set(Object.values(byMember).flatMap(entry => entry.committees.map(seat => seat.committeeId)))]);
  const vacancies = (await source.read<NonNullable<FederalDirectoryReadModel["vacancies"]>[number]>({ path: ["vacancies"], statePath: ["ocdId"],
    statePattern: `^ocd-division/country:us/(?:state|district|territory):${state.toLowerCase()}/` })).records;
  return federalDirectoryForState({ ...header, vacancies, roster: { ...roster, officeholders: [...officeholders], divisions: [...divisions], unmatched: [...unmatched] },
    directory: { ...directory, byMember, committees } }, state);
}

function count(db: HistoryIndex, table: "members" | "positions"): FederalPeopleCount {
  const total = db.prepare(`SELECT coalesce(sum(old_count),0) AS old,coalesce(sum(new_count),0) AS new FROM ${table}`).get()!;
  const keys = (condition: string) => [...db.prepare(`SELECT id FROM ${table} WHERE ${condition} ORDER BY rowid`).iterate()].map(row => row.id);
  return { old: Number(total.old), new: Number(total.new), missing: keys("old_count>0 AND new_count=0"),
    duplicated: keys("new_count>1"), added: keys("new_count>0 AND old_count=0") };
}

function partyBreakdown(db: HistoryIndex, voteId: string, result: string): PartyTally[] | null {
  const expected = parseResultTally(result);
  if (!expected) return null;
  const rows = db.prepare(`SELECT m.party,sum(CASE WHEN p.position='YES' THEN p.old_count ELSE 0 END) AS yes,
    sum(CASE WHEN p.position='NO' THEN p.old_count ELSE 0 END) AS no FROM positions p LEFT JOIN members m ON m.id=p.member
    WHERE p.ref=? AND p.position IN ('YES','NO') GROUP BY m.party`).iterate(voteId);
  const tallies: PartyTally[] = [];
  let yes = 0, no = 0;
  for (const row of rows) {
    const party = row.party === null ? null : JSON.parse(row.party) as string | null;
    if (party === null) return null;
    yes += Number(row.yes); no += Number(row.no);
    tallies.push({ party: `${party}s`, yes: Number(row.yes), no: Number(row.no) });
  }
  return yes === expected.yes && no === expected.no ? tallies.sort((a, b) => a.party.localeCompare(b.party)) : null;
}

/** The source stays immutable in PostgreSQL; scratch disk holds the migration's
 * identity counts and staged outputs. A publication hydrates one state/member. */
export async function withHeldFederalPeopleSplit<T>(query: ReadOnlyQuery, work: (split: HeldFederalPeopleSplit) => Promise<T>): Promise<T> {
  return withHistoryIndex(async db => {
    db.exec(`CREATE TABLE members(id TEXT PRIMARY KEY,party TEXT,old_count INTEGER NOT NULL,new_count INTEGER NOT NULL);
      CREATE TABLE vote_members(id TEXT PRIMARY KEY); CREATE TABLE positions(id TEXT PRIMARY KEY,member TEXT,ref TEXT,position TEXT,old_count INTEGER,new_count INTEGER);
      CREATE INDEX positions_ref ON positions(ref); CREATE TABLE outputs(sequence INTEGER PRIMARY KEY,body TEXT NOT NULL)`);
    const oldMember = db.prepare("INSERT INTO members VALUES(?,?,1,0) ON CONFLICT(id) DO UPDATE SET old_count=old_count+1,party=excluded.party");
    const newMember = db.prepare("INSERT INTO members VALUES(?,?,0,1) ON CONFLICT(id) DO UPDATE SET new_count=new_count+1");
    const voteMember = db.prepare("INSERT OR IGNORE INTO vote_members VALUES(?)");
    const position = db.prepare("INSERT INTO positions VALUES(?,?,?,?,1,1) ON CONFLICT(id) DO UPDATE SET old_count=old_count+1,new_count=new_count+1");
    const output: Statement = db.prepare("INSERT INTO outputs VALUES(?,?)"); let sequence = 0;
    const stage = (row: FederalPeopleSplitCandidate) => output.run(sequence++, JSON.stringify(row));
    const directory = new HeldSource("FEDERAL_DIRECTORY", DIRECTORY_SCOPE, query), rolls = new HeldSource("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE, query);
    await directory.visitMetadata<{ id: string; partyLabel?: string | null }>({ path: ["roster", "officeholders"], statePath: [], statePattern: ".*", keepKeys: ["id", "partyLabel"] },
      holder => { if (typeof holder.id !== "string") throw new Error("FEDERAL_SPLIT_MEMBER_ID_MISSING"); oldMember.run(holder.id, JSON.stringify(holder.partyLabel ?? null)); });
    const captures = await directory.read<FederalDirectoryCapture>({ path: ["acquisitions"], payload: "normalizedPayload", statePath: [], statePattern: ".*", omitKeys: ["body"] });
    for (const state of FEDERAL_DIRECTORY_STATES) {
      const projection = await stateDirectory(directory, state);
      for (const holder of projection.roster.officeholders) newMember.run(holder.id, JSON.stringify(holder.partyLabel ?? null));
      stage({ contractId: federalDirectoryContractId(state), from: captures.input.versionId,
        candidate: heldDirectoryCandidate({ state, acquisitions: captures.records, retrievedAt: captures.retrievedAt, projection }) });
    }
    const header = await rolls.object<Omit<FederalRollCallWindow, "votes">>(["snapshot"], ["positions", "votes"]);
    const votes = (await rolls.read<FederalRollCallWindow["votes"][number]>({ path: ["snapshot", "votes"], statePath: [], statePattern: ".*" })).records;
    const window: FederalRollCallWindow = { ...header, votes: [...votes] };
    const acquisitions = await rolls.read<HeldAcquisition>({ path: ["acquisitions"], payload: "normalizedPayload", statePath: [], statePattern: ".*", omitKeys: ["body"] });
    const common = { acquisitions: acquisitions.records, retrievedAt: acquisitions.retrievedAt, expectedCongress: window.congress, expectedSession: window.session, snapshot: window };
    await rolls.visitMetadata<{ officeholderId: string }>({ path: ["snapshot", "positions"], statePath: [], statePattern: ".*", keepKeys: ["officeholderId"] },
      row => { if (typeof row.officeholderId !== "string") throw new Error("FEDERAL_SPLIT_POSITION_MEMBER_MISSING"); voteMember.run(row.officeholderId); });
    for (const member of db.prepare("SELECT id FROM vote_members ORDER BY rowid").iterate()) {
      const positions = (await rolls.read<MemberVote>({ path: ["snapshot", "positions"], statePath: ["officeholderId"], statePattern: pattern([member.id]) })).records;
      for (const row of positions) position.run(`${row.voteId}|${row.officeholderId}`, row.officeholderId, row.voteId, row.position);
      stage({ contractId: "congress-rollcalls", from: acquisitions.input.versionId,
        candidate: federalMemberVotesCandidate({ ...common, officeholderId: member.id, positions }) });
    }
    const keys = await rolls.read<readonly string[]>({ path: ["snapshot"], statePath: [], statePattern: ".*", objectRecord: true, objectKeys: true });
    const replaceLegacyPositions = keys.records[0]?.includes("positions") ?? false;
    const partyBreakdowns: FederalRollCallsReadModel["partyBreakdowns"] = replaceLegacyPositions
      ? Object.fromEntries(window.votes.map(vote => [vote.id, partyBreakdown(db, vote.id, vote.result)]))
      : await rolls.object<FederalRollCallsReadModel["partyBreakdowns"]>(["partyBreakdowns"]);
    const billSummaries = await rolls.object<FederalRollCallsReadModel["billSummaries"]>(["billSummaries"]);
    stage({ contractId: "congress-rollcalls", from: acquisitions.input.versionId, expectedCurrentVersion: acquisitions.input.versionId, replaceLegacyPositions,
      candidate: federalRollCallsCandidate({ ...common, partyBreakdowns, billSummaries }) });
    return work({ count: { members: count(db, "members"), positions: count(db, "positions") },
      candidates: () => ({ *[Symbol.iterator]() { for (const row of db.prepare("SELECT body FROM outputs ORDER BY sequence").iterate()) yield JSON.parse(row.body) as FederalPeopleSplitCandidate; } }) });
  });
}
