import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import { pluralVoteJurisdiction, pluralVoteState, PLURAL_VOTES_PARSER, PLURAL_VOTES_SOURCE, parsePluralBill, type PluralBillEvidence } from "./votes.ts";
import { parsePluralBulkSessionFile } from "./vote-bulk.ts";
import { acquireVoteSourceFile } from "../../state-rollcalls/source-file.ts";
import { canonicalCivicDataHash } from "../../civic-data/changes.ts";

export const PLURAL_SESSION_CATALOG = "https://openstates.org/data/session-csv/";
const DAY = 86_400_000;
type SharedOptions = Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now">;
export interface PluralVoteSourcePosition { hash: string; position: number; complete: boolean; page?: number }
export type PluralVoteProgress = Readonly<Record<string, PluralVoteSourcePosition>>;
type PluralBillResult = ReturnType<typeof parsePluralBill> & { evidence: PluralBillEvidence; session?: string; checkpoints?: PluralVoteProgress;
  sourceProbe?: {formatVersion:1;rawHash:string;complete:boolean} };
export const pluralVoteSourceHash = (acquisitions: readonly Pick<PluralBillEvidence,"requestedUrl"|"finalUrl"|"sha256">[]): string =>
  canonicalCivicDataHash(acquisitions.map(row=>[row.requestedUrl,row.finalUrl,row.sha256])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const nativeBillId = (value: unknown): value is string => typeof value === "string" && /^ocd-bill\/[0-9a-f-]{36}$/.test(value);
interface Session { identifier: string; start: string; bulkUrl: string | null }
export const pluralJurisdictionsUrl = (page = 1) => `https://v3.openstates.org/jurisdictions?classification=state&include=legislative_sessions&per_page=52&page=${page}`;
export const pluralJurisdictionUrl = (state: string) => `https://v3.openstates.org/jurisdictions/${pluralVoteState(state)}?include=legislative_sessions`;
function publicBulkUrl(raw: unknown, state: string): string | null {
  if (typeof raw !== "string") return null;
  const url = new URL(raw, PLURAL_SESSION_CATALOG);
  return url.origin === "https://data.openstates.org" && url.pathname.startsWith("/csv/latest/") &&
    decodeURIComponent(url.pathname.split("/").at(-1) ?? "").startsWith(`${state.toUpperCase()}_`) && url.pathname.endsWith(".zip") && !url.search ? url.href : null;
}
export function currentPluralSessions(bytes: Uint8Array, state: string, asOf: string): Session[] {
  const value = object(JSON.parse(decode(bytes)));
  if (value.id !== pluralVoteJurisdiction(state) || !Array.isArray(value.legislative_sessions)) throw new Error("PLURAL_SESSION_IDENTITY_INVALID");
  const year = Number(asOf.slice(0, 4));
  const sessions = value.legislative_sessions.map(raw => {
    const row = object(raw);
    if (typeof row.identifier !== "string" || !row.identifier || row.start_date !== null && typeof row.start_date !== "string") throw new Error("PLURAL_SESSION_SHAPE_INVALID");
    const downloads = Array.isArray(row.downloads) ? row.downloads : [];
    const bulk = downloads.map(object).find(download => download.data_type === "csv");
    const name = typeof row.name === "string" ? row.name : row.identifier;
    // Some jurisdictions leave classification blank; others call special
    // sessions primary. Use the publisher's literal regular/special label.
    const special = /special|extraordinary|called/i.test(name) || row.classification === "special" && !/regular/i.test(name);
    const namedYear = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(name)?.[1];
    const cycleYear = Number(namedYear ?? String(row.start_date ?? "").slice(0, 4));
    return { identifier: row.identifier, start: typeof row.start_date === "string" ? row.start_date : "",
      bulkUrl: publicBulkUrl(bulk?.url, state), special, cycleYear };
  }).filter(row => row.start && row.start <= asOf.slice(0, 10) && row.cycleYear <= year)
    .sort((a, b) => b.cycleYear - a.cycleYear || b.start.localeCompare(a.start) || b.identifier.localeCompare(a.identifier));
  if (!sessions.length || new Set(sessions.map(row => row.identifier)).size !== sessions.length) throw new Error("PLURAL_SESSIONS_MISSING_OR_DUPLICATE");
  const regular = sessions.find(row => !row.special) ?? sessions[0]!;
  return sessions.filter(row => row.identifier === regular.identifier || row.special && row.cycleYear >= regular.cycleYear && row.start >= regular.start)
    .map(({ identifier, start, bulkUrl }) => ({ identifier, start, bulkUrl }));
}

function evidence(release: Omit<KnownRelease, "bytes"> & { bytes?: Uint8Array }, body = release.bytes ? decode(release.bytes) : ""): PluralBillEvidence {
  return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, body, retrievedAt: release.retrievedAt,
    sha256: release.sha256, sourceCheck: knownReleaseSourceCheck(release), ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}) };
}

/** State-bounded public CSV sessions carry voter_id; JSON bulk exports only names.
 * Known public catalog links need no key. Metadata/API fallback uses the held API key. */
export async function acquireStateVotes(input: SharedOptions & {
  state: string; signal: AbortSignal; apiKey?: string;
  onBill?: (result: PluralBillResult) => Promise<void>;
  resume?: PluralVoteProgress;
  onCheckpoint?: (progress: PluralVoteProgress) => Promise<void>;
}) {
  const state = pluralVoteState(input.state), apiKey = input.apiKey ?? process.env.PLURAL_API_KEY;
  const now = input.now?.() ?? new Date().toISOString();
  const shared = { store: input.store, locks: input.locks, fetchImpl: input.fetchImpl, now: input.now,
    sourceId: PLURAL_VOTES_SOURCE, parserVersion: PLURAL_VOTES_PARSER, checkAfterMs: DAY, signal: input.signal };
  // Each bill goes to onBill once; only its outcome count stays, so a run never holds every body.
  const held: { key: string; detail: string }[] = [], acquisitions: PluralBillEvidence[] = [];
  const completedBulkSessions = new Set<string>(), resolvedBulkUrls = new Set<string>();
  let bills = 0;
  const sourceProbe=(complete:boolean)=>({formatVersion:1 as const,rawHash:pluralVoteSourceHash(acquisitions),
    complete:complete&&!held.some(row=>row.key!==PLURAL_SESSION_CATALOG&&!resolvedBulkUrls.has(row.key)&&/^https?:\/\/|^ocd-bill\//.test(row.key))});
  const publish = async (result: PluralBillResult, countBill = true) => {
    if (countBill) bills++;
    held.push(...result.held);
    await input.onBill?.(result);
  };
  const readBulk = async (session: string, url: string, finalSource: boolean) => {
    let consumerFailed = false;
    let release: Awaited<ReturnType<typeof acquireVoteSourceFile>> | undefined;
    try {
      release = await acquireVoteSourceFile({ ...shared, releaseId: `${state}:session:${session}`, url,
        maxBytes: 512 * 1024 * 1024, allowedHosts: ["data.openstates.org"] });
      const source = evidence(release);
      // Raw source evidence is durable before any reader publication. The cache
      // index is accepted only after the complete archive validates.
      await release.capture();
      acquisitions.push(source);
      const previous = input.resume?.[url];
      let position = previous?.hash === release.sha256 ? previous.position : 0;
      let batch: import("./votes.ts").PluralVoteFact[] = [];
      const deliver = async (held: { key: string; detail: string }[] = [], complete = false) => {
        const votes = batch; batch = [];
        try { await publish({ votes, held, evidence: source, session,
          sourceProbe:sourceProbe(complete&&finalSource),
          checkpoints: { [url]: { hash: release!.sha256, position, complete } } }, votes.length > 0 || held.length > 0); }
        catch (error) { consumerFailed = true; throw error; }
      };
      if (!(previous?.hash === release.sha256 && previous.complete)) {
        const parsed = await parsePluralBulkSessionFile(state, session, release.path, source, {
          signal: input.signal, afterPosition: position,
          onVote: async (vote, at) => { position = at; batch.push(vote); if (batch.length >= 128) await deliver(); },
        });
        await deliver(parsed.held, true);
      }
      await release.accept();
    } catch (error) {
      if (consumerFailed) throw error;
      input.signal.throwIfAborted(); held.push({ key: url, detail: error instanceof Error ? error.message : String(error) }); return false;
    } finally { await release?.dispose(); }
    completedBulkSessions.add(session); resolvedBulkUrls.add(url); return true;
  };
  // The public catalog is preferred; its anonymous form currently hides URLs.
  const publicSessions: { session: string; url: string; updated: string }[] = [];
  try {
    const catalog = await acquireKnownRelease({ ...shared, releaseId: "public-session-csv-catalog", url: PLURAL_SESSION_CATALOG,
      allowedHosts: ["openstates.org"], maxBytes: 8 * 1024 * 1024, validate: bytes => { if (!decode(bytes).includes("Session")) throw new Error("PLURAL_CATALOG_INVALID"); } });
    for (const item of decode(catalog.bytes).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const href = /href=["']([^"']+)["']/.exec(item[1])?.[1];
      const url = publicBulkUrl(href, state), updated = /updated (\d{4}-\d{2}-\d{2})/.exec(item[1])?.[1];
      const archive = url ? new URL(url) : null;
      const session = archive ? decodeURIComponent(archive.pathname.split("/").at(-1)!).slice(state.length + 1).split("_csv_")[0] : null;
      if (url && session && updated) publicSessions.push({ session, url, updated });
    }
  } catch (error) { input.signal.throwIfAborted(); held.push({ key: PLURAL_SESSION_CATALOG, detail: error instanceof Error ? error.message : String(error) }); }
  if (publicSessions.length && !apiKey) {
    const ordered = [...new Map(publicSessions.map(row => [row.session, row])).values()].sort((a,b) => b.updated.localeCompare(a.updated));
    const recentThrough = ordered[Math.min(1, ordered.length - 1)]!.updated;
    const recent = ordered.filter(row => row.updated >= recentThrough);
    for (const [index,row] of recent.entries()) await readBulk(row.session, row.url,index===recent.length-1);
    if (recent.every(row => completedBulkSessions.has(row.session)) || !apiKey && bills) {
      return { bills, held: held.filter(row => row.key !== PLURAL_SESSION_CATALOG), acquisitions };
    }
  }
  if (!apiKey) throw new Error("PLURAL_PUBLIC_SESSION_LINKS_UNAVAILABLE_AND_API_KEY_UNAVAILABLE");
  const apiShared = { ...shared, headers: { "X-API-KEY": apiKey }, allowedHosts: ["v3.openstates.org"] };
  // One small shared national catalog supplies all state session links. Per-state
  // metadata requests exhaust Open States' quota before the portfolio finishes.
  let jurisdiction: Record<string, unknown> | undefined;
  for (let page = 1; ; page++) {
    const catalog = await acquireKnownRelease({ ...apiShared, releaseId: `jurisdiction-session-catalog:${page}`, url: pluralJurisdictionsUrl(page),
      maxBytes: 4 * 1024 * 1024, validate: bytes => { const value = object(JSON.parse(decode(bytes)));
        if (!Array.isArray(value.results) || !Number.isSafeInteger(object(value.pagination).max_page)) throw new Error("PLURAL_JURISDICTION_CATALOG_INVALID"); } });
    acquisitions.push(evidence(catalog, ""));
    const value = object(JSON.parse(decode(catalog.bytes)));
    jurisdiction = (value.results as unknown[]).map(object).find(row => row.id === pluralVoteJurisdiction(state));
    if (jurisdiction || page >= Number(object(value.pagination).max_page)) break;
  }
  if (!jurisdiction) throw new Error("PLURAL_JURISDICTION_NOT_IN_CATALOG");
  const sessions=currentPluralSessions(new TextEncoder().encode(JSON.stringify(jurisdiction)), state, now);
  const pending: {bill:Record<string,unknown>;revision:string;billUrl:string;sessionKey:string;hash:string;position:number;page:number;complete:boolean}[]=[];
  const pageCheckpoints:PluralVoteProgress[]=[];
  for (const [sessionIndex,session] of sessions.entries()) {
    if (completedBulkSessions.has(session.identifier)) continue;
    if (session.bulkUrl && await readBulk(session.identifier, session.bulkUrl,sessionIndex===sessions.length-1)) continue;
    const sessionKey = `api-session:${state}:${session.identifier}`;
    const previous = input.resume?.[sessionKey];
    for (let page = previous && !previous.complete && Number.isSafeInteger(previous.page) ? previous.page! : 1; ; page++) {
      input.signal.throwIfAborted();
      const url = new URL("https://v3.openstates.org/bills");
      url.searchParams.set("jurisdiction", pluralVoteJurisdiction(state)); url.searchParams.set("session", session.identifier);
      url.searchParams.set("sort", "updated_desc"); url.searchParams.set("per_page", "20"); url.searchParams.set("page", String(page));
      const listing = await acquireKnownRelease({ ...apiShared, releaseId: `${state}:${session.identifier}:bills:${page}`, url: url.href, maxBytes: 8 * 1024 * 1024,
        validate: bytes => { const root = object(JSON.parse(decode(bytes))); if (!Array.isArray(root.results) || !Number.isSafeInteger(object(root.pagination).max_page) || Number(object(root.pagination).max_page) < 0) throw new Error("PLURAL_BILL_LIST_INVALID"); } });
      acquisitions.push(evidence(listing, ""));
      const root = object(JSON.parse(decode(listing.bytes))), bills = root.results as unknown[];
      const start = previous?.page === page && previous.hash === listing.sha256 ? previous.position : 0;
      for (let index = start; index < bills.length; index++) {
        const raw = bills[index];
        const bill = object(raw);
        if (!nativeBillId(bill.id) || object(bill.jurisdiction).id !== pluralVoteJurisdiction(state)) throw new Error("PLURAL_BILL_LIST_IDENTITY_INVALID");
        const billUrl = `https://v3.openstates.org/bills/${bill.id}?include=votes`;
        const revision = canonicalCivicDataHash(bill);
        if (input.resume?.[billUrl]?.hash === revision && input.resume[billUrl].complete) continue;
        pending.push({bill,revision,billUrl,sessionKey,hash:listing.sha256,position:index+1,page,
          complete:index===bills.length-1&&page>=Number(object(root.pagination).max_page)});
      }
      if (page >= Number(object(root.pagination).max_page)) {
        pageCheckpoints.push({ [sessionKey]: { hash: listing.sha256, position: 0, page: 1, complete: true } });
        break;
      }
    }
    if (session.bulkUrl) resolvedBulkUrls.add(session.bulkUrl);
  }
  // Discover small revision catalogs first, so the existing final bill publication
  // can carry the complete source hash without a duplicate metadata candidate.
  for(const [index,task]of pending.entries()){
    input.signal.throwIfAborted();
    let result:PluralBillResult;
    try{
      const release=await acquireKnownRelease({...apiShared,releaseId:`${state}:bill:${task.bill.id}`,url:task.billUrl,maxBytes:16*1024*1024,
        validate:(bytes,release)=>{parsePluralBill(state,evidence({...release,bytes}as KnownRelease));}});
      const source=evidence(release);result={...parsePluralBill(state,source),evidence:source};
    }catch(error){input.signal.throwIfAborted();held.push({key:String(task.bill.id),detail:error instanceof Error?error.message:String(error)});continue;}
    await publish({...result,sourceProbe:sourceProbe(index===pending.length-1),checkpoints:{
      [task.billUrl]:{hash:task.revision,position:0,complete:true},
      [task.sessionKey]:task.complete?{hash:task.hash,position:0,page:1,complete:true}:
        {hash:task.hash,position:task.position,page:task.page,complete:false},
    }});
  }
  for(const checkpoint of pageCheckpoints)await input.onCheckpoint?.(checkpoint);
  // An alternate route's success resolves its outage; malformed facts remain held.
  return { bills, acquisitions, held: held.filter(row => row.key !== PLURAL_SESSION_CATALOG && !resolvedBulkUrls.has(row.key)) };
}
