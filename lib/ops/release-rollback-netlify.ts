/** Rollback server adapter: the existing release credential and read-only migration reader only; no build, push or migration. */
import { createHash } from "node:crypto";
import { readAppliedMigrationWhen } from "../db/applied-migrations.ts";
import { phaseFromSql } from "../db/migration-phases.ts";
import { NETLIFY_SITE_ID_DEFAULT } from "./origins.ts";
import { rollbackCompatibility, rollbackId, rollbackSha, rollbackUnavailable, rollbackView, type AppliedRollbackMigration,
  type RollbackAdapter, type RollbackDeploy, type RollbackMigration } from "./release-rollback.ts";

const RAW = "https://raw.githubusercontent.com/SeanJ22/meanwhile";
const API = "https://api.netlify.com/api/v1";
type ObjectRow = Record<string, unknown>;
function object(value: unknown): ObjectRow | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectRow : null; }
function deploy(value: unknown): RollbackDeploy | null {
  const row = object(value);
  return row && rollbackId(row.id) && rollbackSha(row.commit_ref) && row.context === "production" && row.branch === "main" && row.state === "ready" &&
    typeof row.published_at === "string" && Number.isFinite(Date.parse(row.published_at))
    ? { id: row.id, sha: row.commit_ref, publishedAt: row.published_at } : null;
}

/** Resolve files by full commit, hash their actual bytes and derive their phases from SQL. */
export async function readRollbackCatalog(sha: string, fetchImpl: typeof fetch = fetch): Promise<readonly RollbackMigration[] | null> {
  if (!rollbackSha(sha)) return null;
  async function text(path: string) {
    const response = await fetchImpl(`${RAW}/${sha}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Migration source unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1_000_000) throw new Error("Migration source too large");
    return bytes;
  }
  try {
    const source = JSON.parse(new TextDecoder().decode(await text("lib/db/migrations/meta/_journal.json"))) as { entries?: unknown };
    if (!Array.isArray(source.entries) || source.entries.length === 0 || source.entries.length > 200) return null;
    const entries: { when: number; tag: string }[] = [];
    for (const value of source.entries) {
      const row = object(value);
      if (!row || !Number.isSafeInteger(row.when) || Number(row.when) <= 0 || typeof row.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(row.tag) ||
          entries.some(other => other.when === row.when || other.tag === row.tag)) return null;
      entries.push({ when: Number(row.when), tag: row.tag });
    }
    const result: RollbackMigration[] = [];
    // Bound concurrent source reads; this cache lasts only for the current view reading.
    for (let offset = 0; offset < entries.length; offset += 6) {
      result.push(...await Promise.all(entries.slice(offset, offset + 6).map(async entry => {
        const bytes = await text(`lib/db/migrations/${entry.tag}.sql`);
        return { ...entry, hash: createHash("sha256").update(bytes).digest("hex"), phase: phaseFromSql(new TextDecoder().decode(bytes)).phase };
      })));
    }
    return result;
  } catch { return null; }
}

export function netlifyRollbackAdapter(input: { readonly env?: Readonly<Record<string, string | undefined>>; readonly fetchImpl?: typeof fetch;
  readonly readApplied?: () => Promise<readonly AppliedRollbackMigration[] | null>;
  readonly readCatalog?: (sha: string) => Promise<readonly RollbackMigration[] | null> } = {}): RollbackAdapter {
  const env = input.env ?? process.env, fetchImpl = input.fetchImpl ?? fetch;
  const token = env.NETLIFY_AUTH_TOKEN || env.NETLIFY_TOKEN;
  const siteId = env.NETLIFY_SITE_ID || NETLIFY_SITE_ID_DEFAULT;
  const headers = { authorization: `Bearer ${token ?? ""}` };
  async function json(path: string): Promise<unknown> {
    if (!token) throw new Error("Release credential unavailable");
    const response = await fetchImpl(`${API}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Release reading unavailable");
    return response.json();
  }
  async function published() { return deploy(object(await json(`/sites/${encodeURIComponent(siteId)}`))?.published_deploy); }
  const readApplied = input.readApplied ?? (async () => {
    const connection = env.DATABASE_URL;
    if (!connection) return null;
    let host = "";
    try { host = new URL(connection).hostname; } catch { return null; }
    // Same production identity as the existing migration applier's inspection branch.
    if (!host.endsWith(".neon.tech") || host.replace(/-pooler(?=\.)/, "").split(".")[0] !== "ep-dry-river-axwtolzc") return null;
    const read = await readAppliedMigrationWhen(connection);
    if (!read.ok || read.appliedHashes.length !== read.appliedWhen.length) return null;
    return read.appliedHashes;
  });
  let verifiedCatalogs = new Map<string, Promise<readonly RollbackMigration[] | null>>();
  return {
    published,
    async confirm(current, target) {
      const currentCatalog = await verifiedCatalogs.get(current.sha), targetCatalog = await verifiedCatalogs.get(target.sha);
      if (!currentCatalog || !targetCatalog) return false;
      const applied = await readApplied();
      return applied !== null && rollbackCompatibility(applied, currentCatalog, targetCatalog) === null;
    },
    async read() {
      verifiedCatalogs = new Map();
      if (!token) return rollbackUnavailable("The existing release credential is not configured, so earlier releases could not be read.");
      try {
        const current = await published();
        if (!current) return rollbackUnavailable("The current published production release could not be identified.");
        const applied = await readApplied();
        if (applied === null) return rollbackUnavailable("The production migration journal could not be read. No restore is offered.");
        const catalogs = new Map<string, Promise<readonly RollbackMigration[] | null>>();
        const catalog = (sha: string) => {
          if (!catalogs.has(sha)) catalogs.set(sha, (input.readCatalog ?? ((value: string) => readRollbackCatalog(value, fetchImpl)))(sha));
          return catalogs.get(sha)!;
        };
        const currentCatalog = await catalog(current.sha);
        if (!currentCatalog || rollbackCompatibilityReadRefused(applied, currentCatalog))
          return rollbackUnavailable("Applied migrations could not be matched to the current production code. No restore is offered.");
        const history = await json(`/sites/${encodeURIComponent(siteId)}/deploys?per_page=40&page=1`);
        if (!Array.isArray(history)) return rollbackUnavailable("Production release history could not be read.");
        const candidates = history.map(deploy).filter((row): row is RollbackDeploy => row !== null && row.id !== current.id && Date.parse(row.publishedAt) < Date.parse(current.publishedAt))
          .sort((a,b) => Date.parse(b.publishedAt)-Date.parse(a.publishedAt))
          .filter((row,index,rows) => rows.findIndex(other => other.id === row.id) === index).slice(0,3);
        const rows = await Promise.all(candidates.map(async row => ({ deploy: row, catalog: await catalog(row.sha) })));
        verifiedCatalogs = catalogs;
        return rollbackView({ current, applied, catalog: currentCatalog, candidates: rows });
      } catch { return rollbackUnavailable("Production releases could not be read just now. No restore is offered."); }
    },
    async restore(deployId) {
      if (!token || !rollbackId(deployId)) return "denied";
      try {
        const response = await fetchImpl(`${API}/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`,
          { method: "POST", headers, signal: AbortSignal.timeout(15_000) });
        if (response.status === 401 || response.status === 403) return "denied";
        return response.status === 201 ? "accepted" : "unknown";
      } catch { return "unknown"; }
    },
  };
}

function rollbackCompatibilityReadRefused(applied: readonly AppliedRollbackMigration[], catalog: readonly RollbackMigration[]) {
  return applied.some(row => !catalog.some(known => known.when === row.when && known.hash === row.hash));
}
