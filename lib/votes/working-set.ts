import { withHistoryIndex, type HistoryIndex } from "../control-plane/workers/streamed-history.ts";
import { acquireCongressSourceRevision } from "../officials/congress-source-revision.ts";
import { acquireCongressSourceFile } from "../officials/congress-source-file.ts";
import { readCongressYamlBlocks } from "../officials/congress-source-records.ts";
import { rawCaptureVault } from "../civic-data/raw-capture-remote.ts";
import type { MemberVote, VotePosition } from "./types.ts";

/** Country-wide identity joins and positions live on temporary disk. A task loads one member or one native roll. */
type Statement = ReturnType<HistoryIndex["prepare"]>;
export class VoteWorkingSet {
  private readonly identityInsert: Statement;
  private readonly hasIdentity: Statement;
  private readonly findLis: Statement;
  private readonly findParty: Statement;
  private readonly insertPosition: Statement;
  private readonly countPositions: Statement;
  private readonly memberRows: Statement;
  private readonly memberPositions: Statement;
  private readonly rollPositions: Statement;
  constructor(db: HistoryIndex) {
    db.exec("CREATE TABLE identities(bioguide TEXT PRIMARY KEY,lis TEXT,party TEXT); CREATE UNIQUE INDEX identities_lis ON identities(lis) WHERE lis<>''; CREATE TABLE positions(member TEXT NOT NULL,ref TEXT NOT NULL,position TEXT NOT NULL,PRIMARY KEY(member,ref)); CREATE INDEX positions_ref ON positions(ref)");
    this.identityInsert=db.prepare("INSERT INTO identities VALUES(?,?,?)");
    this.hasIdentity=db.prepare("SELECT bioguide FROM identities WHERE bioguide=?");
    this.findLis=db.prepare("SELECT bioguide FROM identities WHERE lis=?");
    this.findParty=db.prepare("SELECT party FROM identities WHERE bioguide=?");
    this.insertPosition=db.prepare("INSERT INTO positions VALUES(?,?,?) ON CONFLICT(member,ref) DO UPDATE SET position=excluded.position");
    this.countPositions=db.prepare("SELECT count(*) AS count FROM positions");
    this.memberRows=db.prepare("SELECT DISTINCT member FROM positions ORDER BY member");
    this.memberPositions=db.prepare("SELECT ref,position FROM positions WHERE member=? ORDER BY ref");
    this.rollPositions=db.prepare("SELECT member,position FROM positions WHERE ref=? ORDER BY member");
  }
  identity(bioguide: string, lis: string | null, party: string | null): void {
    this.identityInsert.run(bioguide,lis ?? "",party ?? "");
  }
  hasBioguide(id: string): boolean { return Boolean(this.hasIdentity.get(id)); }
  bioguideForLis(lis: string): string | null { return this.findLis.get(lis)?.bioguide ?? null; }
  party(member: string): string | null { return this.findParty.get(member.slice("congress:".length))?.party || null; }
  position(member: string, ref: string, position: VotePosition): void {
    this.insertPosition.run(member,ref,position);
  }
  get positionCount(): number { return Number(this.countPositions.get()?.count ?? 0); }
  members(): Iterable<string> {
    const rows=this.memberRows.iterate();
    return { *[Symbol.iterator]() { for(const row of rows) yield row.member; } };
  }
  positionsForMember(member: string): MemberVote[] {
    return [...this.memberPositions.iterate(member)]
      .map(row=>({officeholderId:member,voteId:row.ref,position:row.position as VotePosition}));
  }
  positionsForRoll(ref: string): MemberVote[] {
    return [...this.rollPositions.iterate(ref)]
      .map(row=>({officeholderId:row.member,voteId:ref,position:row.position as VotePosition}));
  }
}

export function withVoteWorkingSet<T>(work: (working: VoteWorkingSet) => Promise<T>): Promise<T> {
  return withHistoryIndex(db=>work(new VoteWorkingSet(db)));
}

/** The same pinned directory source as roster tasks, decoded one person at a time; no national JSON or term array survives. */
export async function loadVoteIdentityBridge(working: VoteWorkingSet): Promise<void> {
  const {sha}=await acquireCongressSourceRevision();
  const held=await acquireCongressSourceFile({url:`https://raw.githubusercontent.com/unitedstates/congress-legislators/${sha}/legislators-current.yaml`,vault:rawCaptureVault(),signal:AbortSignal.timeout(60_000)});
  let count=0;
  try {
    for await(const block of readCongressYamlBlocks(held.path)) {
      const person=Array.isArray(block)&&block.length===1 ? block[0] : null;
      if(!person || !/^[A-Z]\d{6}$/.test(person.id?.bioguide) || !Array.isArray(person.terms)) throw new Error("FEDERAL_VOTE_IDENTITY_BRIDGE_INVALID");
      working.identity(person.id.bioguide, typeof person.id.lis==="string" ? person.id.lis : null, person.terms.at(-1)?.party ?? null);
      count++;
    }
    if(!count) throw new Error("FEDERAL_VOTE_IDENTITY_BRIDGE_EMPTY");
  } finally { await held.dispose(); }
}
