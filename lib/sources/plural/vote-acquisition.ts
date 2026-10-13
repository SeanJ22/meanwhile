import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import { pluralVoteJurisdiction, pluralVoteState, PLURAL_VOTES_PARSER, PLURAL_VOTES_SOURCE, parsePluralBill, type PluralBillEvidence } from "./votes.ts";
import { parsePluralBulkSession } from "./vote-bulk.ts";

export const PLURAL_SESSION_CATALOG = "https://openstates.org/data/session-csv/";
const DAY = 86_400_000;
type SharedOptions = Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now">;
export type PluralBillResult = ReturnType<typeof parsePluralBill> & { evidence: PluralBillEvidence };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const nativeBillId = (value: unknown): value is string => typeof value === "string" && /^ocd-bill\/[0-9a-f-]{36}$/.test(value);
interface Session { identifier: string; start: string; bulkUrl: string | null }
export const pluralJurisdictionUrl = (state: string) => `https://v3.openstates.org/jurisdictions/${pluralVoteState(state)}?include=legislative_sessions`;
function publicBulkUrl(raw: unknown, state: string): string | null {
  if (typeof raw !== "string") return null;
  const url = new URL(raw, PLURAL_SESSION_CATALOG);
  return url.origin === "https://data.openstates.org" && url.pathname.startsWith("/csv/latest/") &&
    decodeURIComponent(url.pathname.split("/").at(-1) ?? "").startsWith(`${state.toUpperCase()}_`) && url.pathname.endsWith(".zip") && !url.search ? url.href : null;
}
function recentSessions(bytes: Uint8Array, state: string, asOf: string): Session[] {
  const value = object(JSON.parse(decode(bytes)));
  if (value.id !== pluralVoteJurisdiction(state) || !Array.isArray(value.legislative_sessions)) throw new Error("PLURAL_SESSION_IDENTITY_INVALID");
  const sessions = value.legislative_sessions.map(raw => {
    const row = object(raw);
    if (typeof row.identifier !== "string" || !row.identifier || row.start_date !== null && typeof row.start_date !== "string") throw new Error("PLURAL_SESSION_SHAPE_INVALID");
    const downloads = Array.isArray(row.downloads) ? row.downloads : [];
    const bulk = downloads.map(object).find(download => download.data_type === "csv");
    return { identifier: row.identifier, start: typeof row.start_date === "string" ? row.start_date : "", bulkUrl: publicBulkUrl(bulk?.url, state) };
  }).filter(row => row.start && row.start <= asOf.slice(0, 10)).sort((a, b) => b.start.localeCompare(a.start) || b.identifier.localeCompare(a.identifier));
  if (!sessions.length || new Set(sessions.map(row => row.identifier)).size !== sessions.length) throw new Error("PLURAL_SESSIONS_MISSING_OR_DUPLICATE");
  // Include the latest regular session and all special sessions since its start,
  // plus the preceding regular cycle when the publisher supplies it.
  const regular = value.legislative_sessions.map(object).filter(row => row.classification === "primary" && typeof row.start_date === "string")
    .map(row => String(row.start_date)).filter(start => start <= asOf.slice(0, 10)).sort().reverse();
  const cutoff = regular[1] ?? sessions[Math.min(1, sessions.length - 1)]!.start;
  return sessions.filter(row => row.start >= cutoff);
}
function evidence(release: KnownRelease, body = decode(release.bytes)): PluralBillEvidence {
  return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, body, retrievedAt: release.retrievedAt,
    sha256: release.sha256, sourceCheck: knownReleaseSourceCheck(release), ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}) };
}

/** State-bounded public CSV sessions carry voter_id; JSON bulk exports only names.
 * Known public catalog links need no key. Metadata/API fallback uses the held API key. */
export async function acquireStateVotes(input: SharedOptions & {
  state: string; signal: AbortSignal; apiKey?: string;
  onBill?: (result: PluralBillResult) => Promise<void>;
}) {
  const state = pluralVoteState(input.state), apiKey = input.apiKey ?? process.env.PLURAL_API_KEY;
  const now = input.now?.() ?? new Date().toISOString();
  const shared = { store: input.store, locks: input.locks, fetchImpl: input.fetchImpl, now: input.now,
    sourceId: PLURAL_VOTES_SOURCE, parserVersion: PLURAL_VOTES_PARSER, checkAfterMs: DAY, signal: input.signal };
  const results: PluralBillResult[] = [], held: { key: string; detail: string }[] = [], acquisitions: PluralBillEvidence[] = [];
  const completedBulkSessions = new Set<string>(), resolvedBulkUrls = new Set<string>();
  const publish = async (result: PluralBillResult) => {
    results.push(result); acquisitions.push(result.evidence); held.push(...result.held);
    await input.onBill?.(result);
  };
  const readBulk = async (session: string, url: string) => {
    let result: PluralBillResult;
    try {
      let parsed: Awaited<ReturnType<typeof parsePluralBulkSession>> | undefined;
      const release = await acquireKnownRelease({ ...shared, releaseId: `${state}:session:${session}`, url,
        maxBytes: 256 * 1024 * 1024, allowedHosts: ["data.openstates.org"],
        validate: async (bytes, release) => { parsed = await parsePluralBulkSession(state, session, bytes, {
          requestedUrl: url, finalUrl: release.finalUrl, retrievedAt: release.retrievedAt, sha256: release.sha256, body: "" }); } });
      const source = evidence(release, "");
      result = { ...parsed ?? await parsePluralBulkSession(state, session, release.bytes, source), evidence: source };
    } catch (error) {
      input.signal.throwIfAborted(); held.push({ key: url, detail: error instanceof Error ? error.message : String(error) }); return false;
    }
    await publish(result); completedBulkSessions.add(session); resolvedBulkUrls.add(url); return true;
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
  if (publicSessions.length) {
    const ordered = [...new Map(publicSessions.map(row => [row.session, row])).values()].sort((a,b) => b.updated.localeCompare(a.updated));
    const recentThrough = ordered[Math.min(1, ordered.length - 1)]!.updated;
    const recent = ordered.filter(row => row.updated >= recentThrough);
    for (const row of recent) await readBulk(row.session, row.url);
    if (recent.every(row => completedBulkSessions.has(row.session)) || !apiKey && results.length) {
      return { results, held: held.filter(row => row.key !== PLURAL_SESSION_CATALOG), acquisitions };
    }
  }
  if (!apiKey) throw new Error("PLURAL_PUBLIC_SESSION_LINKS_UNAVAILABLE_AND_API_KEY_UNAVAILABLE");
  const apiShared = { ...shared, headers: { "X-API-KEY": apiKey }, allowedHosts: ["v3.openstates.org"] };
  const metadata = await acquireKnownRelease({ ...apiShared, releaseId: `${state}:sessions`, url: pluralJurisdictionUrl(state),
    maxBytes: 4 * 1024 * 1024, validate: bytes => { recentSessions(bytes, state, now); } });
  acquisitions.push(evidence(metadata));
  for (const session of recentSessions(metadata.bytes, state, now)) {
    if (completedBulkSessions.has(session.identifier)) continue;
    if (session.bulkUrl && await readBulk(session.identifier, session.bulkUrl)) continue;
    for (let page = 1; ; page++) {
      input.signal.throwIfAborted();
      const url = new URL("https://v3.openstates.org/bills");
      url.searchParams.set("jurisdiction", pluralVoteJurisdiction(state)); url.searchParams.set("session", session.identifier);
      url.searchParams.set("sort", "updated_desc"); url.searchParams.set("per_page", "100"); url.searchParams.set("page", String(page));
      const listing = await acquireKnownRelease({ ...apiShared, releaseId: `${state}:${session.identifier}:bills:${page}`, url: url.href, maxBytes: 8 * 1024 * 1024,
        validate: bytes => { const root = object(JSON.parse(decode(bytes))); if (!Array.isArray(root.results) || !Number.isSafeInteger(object(root.pagination).max_page) || Number(object(root.pagination).max_page) < 0) throw new Error("PLURAL_BILL_LIST_INVALID"); } });
      acquisitions.push(evidence(listing));
      const root = object(JSON.parse(decode(listing.bytes))), bills = root.results as unknown[];
      for (const raw of bills) {
        const bill = object(raw);
        if (!nativeBillId(bill.id) || object(bill.jurisdiction).id !== pluralVoteJurisdiction(state)) throw new Error("PLURAL_BILL_LIST_IDENTITY_INVALID");
        const billUrl = `https://v3.openstates.org/bills/${bill.id}?include=votes`;
        let result: PluralBillResult;
        try {
          const release = await acquireKnownRelease({ ...apiShared, releaseId: `${state}:bill:${bill.id}`, url: billUrl, maxBytes: 16 * 1024 * 1024,
            validate: (bytes, release) => { parsePluralBill(state, evidence({ ...release, bytes } as KnownRelease)); } });
          const source = evidence(release); result = { ...parsePluralBill(state, source), evidence: source };
        } catch (error) { input.signal.throwIfAborted(); held.push({ key: String(bill.id), detail: error instanceof Error ? error.message : String(error) }); continue; }
        await publish(result);
      }
      if (page >= Number(object(root.pagination).max_page)) break;
    }
    if (session.bulkUrl) resolvedBulkUrls.add(session.bulkUrl);
  }
  // An alternate route's success resolves its outage; malformed facts remain held.
  return { results, acquisitions, held: held.filter(row => row.key !== PLURAL_SESSION_CATALOG && !resolvedBulkUrls.has(row.key)) };
}
