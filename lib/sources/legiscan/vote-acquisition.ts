import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../known-release.ts";
import { readCompleteResponse } from "../source-bytes.ts";
import { digest, LEGISCAN_VOTES_PARSER, LEGISCAN_VOTES_SOURCE, legiscanState, object, parseLegiscanDatasetFile, parseLegiscanDatasetList,
  text, type LegiscanDatasetEvidence, type LegiscanSession } from "./dataset.ts";
import { acquireVoteSourceFile } from "../../state-rollcalls/source-file.ts";
import { decodeLegiscanDatasetEnvelope } from "./dataset-envelope.ts";
import type { PluralVoteFact } from "../plural/votes.ts";
import type { Officeholder } from "../../officials/types.ts";

const DAY = 86_400_000;
const DATASET_RESPONSE_LIMIT = 384 * 1024 * 1024;
type SharedOptions = Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now">;
export const legiscanDatasetListUrl = (state: string) => `https://api.legiscan.com/?op=getDatasetList&state=${legiscanState(state)}`;
const datasetUrl = (session: LegiscanSession) => `https://api.legiscan.com/?op=getDataset&id=${session.sessionId}&dataset_hash=${session.datasetHash}`;
export type LegiscanDatasetResult = Awaited<ReturnType<typeof parseLegiscanDatasetFile>> & { session: LegiscanSession };
export interface LegiscanCompletedDataset {
  session: LegiscanSession; evidence: LegiscanDatasetEvidence; rollCalls: number; memberVotes: number; unmatchedPositions: number;
}
/** The current regular cycle includes later special sessions, without
 * downloading prior cycles or next year's prefile before they begin. */
export function currentLegiscanSessions(sessions: readonly LegiscanSession[], asOf: string): LegiscanSession[] {
  const year = Number(asOf.slice(0, 4));
  if (!Number.isSafeInteger(year)) throw new Error("LEGISCAN_SESSION_AS_OF_INVALID");
  const started = sessions.filter(session => session.yearStart <= year && !session.prefile && !/\bprefil(?:e|ing)\b/i.test(session.sessionName));
  const regular = started.filter(session => !session.special && !/\b(?:special|extra(?:ordinary)?)\b/i.test(session.sessionName));
  const latestYear = Math.max(...(regular.length ? regular : started).map(session => session.yearStart));
  return started.filter(session => session.yearStart >= latestYear);
}

/** Neither the API credential nor vendor dataset access keys enter source URLs or saved bytes. */
function privateTransport(state: string, apiKey: string | undefined, transport: typeof fetch): typeof fetch {
  const access = new Map<number, { key: string; hash: string }>();
  const request = async (url: URL, init?: RequestInit) => {
    if (!apiKey) throw new Error("LEGISCAN_API_KEY_UNAVAILABLE");
    url.searchParams.set("key", apiKey);
    let response: Response;
    try { response = await transport(url.href, { ...init, redirect: "error" }); }
    catch { throw new Error("LEGISCAN_PUBLISHER_REQUEST_FAILED"); }
    return response;
  };
  const listing = async (url: URL, init?: RequestInit) => {
    const response = await request(url, init);
    if (response.status !== 200) return new Response(response.body, { status: response.status, headers: response.headers });
    const bytes = await readCompleteResponse(response, 4 * 1024 * 1024), payload = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (payload.status !== "OK" || !Array.isArray(payload.datasetlist)) throw new Error("LEGISCAN_DATASET_LIST_RESPONSE_INVALID");
    for (const value of payload.datasetlist) {
      const row = object(value);
      if (Number.isSafeInteger(row.session_id) && text(row.access_key)) access.set(Number(row.session_id), { key: text(row.access_key), hash: text(row.dataset_hash) });
      delete row.access_key;
    }
    // HTTP byte count/ETag describe the private body, not the redacted saved body.
    const headers = new Headers(response.headers); headers.delete("content-length"); headers.delete("etag");
    return new Response(JSON.stringify(payload), { status: 200, headers });
  };
  return (async (value, init) => {
    const publicUrl = new URL(String(value));
    if (publicUrl.origin !== "https://api.legiscan.com" || publicUrl.pathname !== "/" || publicUrl.searchParams.has("key") || publicUrl.searchParams.has("access_key")) throw new Error("LEGISCAN_PUBLIC_SOURCE_ROUTE_INVALID");
    const op = publicUrl.searchParams.get("op");
    if (op === "getDatasetList") return listing(publicUrl, init);
    if (op !== "getDataset") throw new Error("LEGISCAN_SOURCE_OPERATION_INVALID");
    const id = Number(publicUrl.searchParams.get("id")), expectedHash = publicUrl.searchParams.get("dataset_hash");
    if (!access.has(id)) {
      const response = await listing(new URL(legiscanDatasetListUrl(state)), init);
      if (response.status !== 200) { await response.body?.cancel(); throw new Error("LEGISCAN_DATASET_ACCESS_LIST_UNAVAILABLE"); }
      await response.body?.cancel();
    }
    const credential = access.get(id);
    if (!credential || credential.hash !== expectedHash) throw new Error("LEGISCAN_DATASET_RELEASE_CHANGED");
    publicUrl.searchParams.delete("dataset_hash"); publicUrl.searchParams.set("access_key", credential.key);
    const response = await request(publicUrl, init);
    // A fresh Response has no private response.url for the evidence writer to retain.
    return new Response(response.body, { status: response.status, headers: response.headers });
  }) as typeof fetch;
}
const evidence = (release: Omit<KnownRelease, "bytes">): LegiscanDatasetEvidence => ({ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl,
  retrievedAt: release.retrievedAt, sha256: release.sha256, ...(release.vaultKey ? { vaultKey: release.vaultKey } : {}), sourceCheck: knownReleaseSourceCheck(release) });

/** Every request is state bounded; a missing session leaves other verified sessions publishable. */
export async function acquireLegiscanVotes(input: SharedOptions & { state: string; signal: AbortSignal; apiKey?: string; holders: readonly Officeholder[];
  onDataset?: (result: LegiscanDatasetResult) => Promise<void>;
  onVote?: (vote: PluralVoteFact) => Promise<void> }) {
  const state = legiscanState(input.state), url = legiscanDatasetListUrl(state), fetchImpl = privateTransport(state, input.apiKey ?? process.env.LEGISCAN_API_KEY, input.fetchImpl ?? fetch);
  const shared = { store: input.store, locks: input.locks, now: input.now, fetchImpl, sourceId: LEGISCAN_VOTES_SOURCE, parserVersion: LEGISCAN_VOTES_PARSER,
    signal: input.signal, allowedHosts: ["api.legiscan.com"] };
  const listing = await acquireKnownRelease({ ...shared, releaseId: `dataset-list:${state}`, url, maxBytes: 4 * 1024 * 1024, checkAfterMs: DAY,
    validate: bytes => { parseLegiscanDatasetList(new TextDecoder("utf-8", { fatal: true }).decode(bytes), state); } });
  const sessions = currentLegiscanSessions(parseLegiscanDatasetList(new TextDecoder("utf-8", { fatal: true }).decode(listing.bytes), state), input.now?.() ?? new Date().toISOString());
  const results: LegiscanDatasetResult[] = [], completed: LegiscanCompletedDataset[] = [], held: { key: string; detail: string }[] = [];
  for (const session of sessions) {
    input.signal.throwIfAborted();
    let result: LegiscanDatasetResult, consumerFailed = false;
    try {
      const url = datasetUrl(session);
      const release = await acquireVoteSourceFile({ ...shared, releaseId: `dataset:${state}:${session.sessionId}:${session.datasetHash}`, url,
        maxBytes: DATASET_RESPONSE_LIMIT, checkAfterMs: Number.MAX_SAFE_INTEGER });
      try {
        const source = evidence(release), archivePath = `${release.path}.zip`;
        await decodeLegiscanDatasetEnvelope({ path: release.path, archivePath, session, signal: input.signal });
        await release.capture();
        const facts = await parseLegiscanDatasetFile({ state, session, path: archivePath, evidence: source, holders: input.holders, signal: input.signal,
          onVote: input.onVote ? async vote => { try { await input.onVote!(vote); } catch (error) { consumerFailed = true; throw error; } } : undefined });
        await release.accept();
        result = { ...facts, evidence: { ...facts.evidence, ...source, members: facts.evidence.members }, session };
      } finally { await release.dispose(); }
    } catch (error) {
      if (consumerFailed) throw error;
      input.signal.throwIfAborted();
      held.push({ key: `session:${session.sessionId}`, detail: error instanceof Error ? error.message : String(error) }); continue;
    }
    // Callback consumers publish and release one session before fetching the next.
    // Only standalone callers asking for the result retain normalized sessions.
    if (!input.onDataset) results.push(result);
    completed.push({ session, evidence: result.evidence, rollCalls: result.rollCalls, memberVotes: result.memberVotes, unmatchedPositions: result.unmatchedPositions });
    held.push(...result.held);
    await input.onDataset?.(result);
  }
  return { state, results, completed, held, listing: evidence(listing), listingHash: digest(listing.sha256) };
}
