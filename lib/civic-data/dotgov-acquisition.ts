import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openArchiveSource, type ArchiveObjectStore } from "../sources/archive-download.ts";
import { streamCsvRecords } from "../sources/prl/streaming.ts";
import { dotGovColumns, dotGovCounts, dotGovRow, DOTGOV_BOUNDARY, type DotGovCounts, type DotGovDomain, type DotGovSnapshot } from "./dotgov.ts";
import { requestPublisher, sourceAcquisitionFailure } from "./source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { OUTBOUND_USER_AGENT } from "../geo/outbound-agent.ts";

export const DOTGOV_COMMITS_URL = "https://api.github.com/repos/cisagov/dotgov-data/commits?path=current-full.csv&per_page=1";
const csvLine = (row: readonly string[]) => row.map(cell => /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(",") + "\n";
const stateOf = (row: DotGovDomain) => /^[A-Z]{2}$/.test(row.state ?? "") ? row.state! : "US";

function dotGovSourceError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message === "PRL_SOURCE_TRUNCATED")
    return sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", "CISA dotgov: short read of the pinned registry CSV.");
  if (["PRL_CSV_RECORD_TOO_LARGE", "PRL_CSV_INVALID_QUOTE", "PRL_CSV_TRUNCATED_QUOTE"].includes(error.message))
    return sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `CISA dotgov: malformed registry CSV (${error.message}).`);
  return error;
}

/** Source archives use the shared vault in bounded chunks; manifests are disposable indexes. */
export function dotGovArchiveCache(store: EvidenceStore): ArchiveObjectStore {
  const key = (path: string) => `project/freshness/source/cisa-dotgov-registry/archives/${path}`;
  return { get: async path => (await store.get(key(path)))?.bytes ?? null,
    head: async path => { const meta = await store.head(key(path)); return meta ? { size: meta.byteLength } : null; },
    put: async (path, bytes, contentType = "application/octet-stream") => {
      const mutable = path.endsWith("/source.json");
      await store.put(key(path), bytes, { contentType, byteLength: bytes.byteLength,
        contentHash: mutable ? `manifest:${key(path)}` : `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
        ...(mutable ? { objectClass: "MUTABLE_INDEX" as const } : {}) });
    } };
}

interface Database {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...values: string[]): void;
    iterate(...values: string[]): Iterable<Record<string, string>>;
  };
}

export interface DotGovAcquisition {
  readonly states: readonly string[];
  readonly counts: DotGovCounts;
  readonly rawHash: string;
  readonly sourceSha: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  /** Omitting the state returns only the small source summary. */
  snapshot(state?: string): DotGovSnapshot;
  csv(state: string): string;
  dispose(): Promise<void>;
}

/** The complete country streams to a bounded disk index. Only the asking state's rows enter memory. */
export async function acquireDotGov(signal?: AbortSignal, dependencies: {
  readonly fetchImpl?: typeof fetch;
  readonly archive?: ArchiveObjectStore;
  readonly minimumDomains?: number;
  readonly minimumElectionDomains?: number;
} = {}): Promise<DotGovAcquisition> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const revision = await requestPublisher("CISA dotgov revision", () => fetchImpl(DOTGOV_COMMITS_URL,
    { headers: { "user-agent": OUTBOUND_USER_AGENT, accept: "application/vnd.github+json" }, signal }));
  if (!revision.ok) throw sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `dotgov revision answered ${revision.status}`);
  let revisions: unknown;
  try { revisions = await revision.json(); }
  catch { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "dotgov source revision returned invalid JSON"); }
  const revisionSha = Array.isArray(revisions) ? (revisions[0] as { sha?: unknown } | null)?.sha : undefined;
  const sourceSha = typeof revisionSha === "string" ? revisionSha.toLowerCase() : undefined;
  if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "dotgov source revision was not a full Git commit SHA");
  const url = `https://raw.githubusercontent.com/cisagov/dotgov-data/${sourceSha}/current-full.csv`;
  const source = await openArchiveSource({ id: `cisa-dotgov-registry-${sourceSha}`, url, file: "current-full.csv", format: "csv" },
    (input, init) => fetchImpl(input, { ...init, signal: signal && init?.signal ? AbortSignal.any([signal, init.signal]) : signal ?? init?.signal }), dependencies.archive)
    .catch(error => { throw dotGovSourceError(error); });
  const root = await mkdtemp(join(tmpdir(), "dotgov-state-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => Database };
  const db = new DatabaseSync(join(root, "domains.sqlite"));
  const dispose = async () => { db.close(); await rm(root, { recursive: true, force: true }); };
  try {
    db.exec("PRAGMA journal_mode=OFF; PRAGMA cache_size=-1024; CREATE TABLE domains(domain TEXT PRIMARY KEY,state TEXT,value TEXT,csv TEXT) WITHOUT ROWID; CREATE INDEX by_state ON domains(state,domain); BEGIN");
    const insert = db.prepare("INSERT INTO domains VALUES(?,?,?,?)");
    let header: string[] | undefined, columns: readonly number[] = [], domains = 0, electionDomains = 0;
    const byType: Record<string, number> = {};
    for await (const cells of streamCsvRecords(source.textChunks)) {
      signal?.throwIfAborted();
      if (!header) {
        header = cells;
        try { columns = dotGovColumns(cells); }
        catch (error) { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", String(error)); }
        continue;
      }
      if (!cells.some(cell => cell.trim())) continue;
      if (cells.length !== header.length) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The CISA registry has a truncated row.");
      let row: DotGovDomain;
      try { row = dotGovRow(cells, columns); }
      catch (error) { throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", String(error)); }
      try { insert.run(row.domain, stateOf(row), JSON.stringify(row), csvLine(cells)); }
      catch (error) { if ((error as { errcode?: number }).errcode === 1555 || /UNIQUE constraint/.test(String(error))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "The CISA registry repeats a domain identifier."); throw error; }
      domains++; byType[row.type] = (byType[row.type] ?? 0) + 1;
      if (/election/i.test(row.type)) electionDomains++;
      if (domains % 10000 === 0) db.exec("COMMIT; BEGIN");
    }
    if (!header || domains < (dependencies.minimumDomains ?? 15000) || electionDomains < (dependencies.minimumElectionDomains ?? 500))
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `dotgov incomplete source: ${domains} domains, ${electionDomains} election domains`);
    db.exec("COMMIT");
    await source.accept?.();
    const counts = { domains, electionDomains, byType };
    const states = [...db.prepare("SELECT DISTINCT state FROM domains ORDER BY state").iterate()].map(row => row.state);
    const sourceIdentity = { name: "cisagov/dotgov-data", sha: sourceSha, url,
      file: "current-full.csv", licence: "US Government work, public domain", readAt: source.retrievedAt };
    return { states, counts, rawHash: source.sourceSha256, sourceSha, finalUrl: source.finalUrl, retrievedAt: source.retrievedAt,
      snapshot(state) {
        if (state !== undefined && !/^[A-Z]{2}$/.test(state)) throw new Error("CISA partition needs an exact state");
        const rows = state === undefined ? [] : [...db.prepare("SELECT value FROM domains WHERE state=? ORDER BY domain").iterate(state)].map(row => JSON.parse(row.value) as DotGovDomain);
        return { source: sourceIdentity, counts: dotGovCounts(rows), registryCounts: counts,
          ...(state === undefined ? { release: { sha: sourceSha, url, readAt: source.retrievedAt, counts } } : { state }), domains: rows, boundary: DOTGOV_BOUNDARY };
      },
      csv(state) {
        if (!/^[A-Z]{2}$/.test(state)) throw new Error("CISA evidence needs an exact state");
        return csvLine(header!) + [...db.prepare("SELECT csv FROM domains WHERE state=? ORDER BY domain").iterate(state)].map(row => row.csv).join("");
      }, dispose };
  } catch (error) { await dispose(); throw dotGovSourceError(error); }
  finally { await source.dispose(); }
}
