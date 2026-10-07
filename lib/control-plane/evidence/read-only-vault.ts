/**
 * The evidence vault, read-only, for routine children that may not reach a
 * filesystem writer. Same on-disk layout as `DurableEvidenceStore`:
 *
 * - every committed object is a body beside its `<key>.meta.json` sidecar; a
 *   body with no sidecar is never listed;
 * - an artifact's id is recomputed from its sidecar (`artifactId(tier, contentHash)`);
 * - every read recomputes the body's sha256 and refuses a mismatch.
 *
 * `root` is the vault root (`VAULT_DIR`). An absent root is an empty vault;
 * any other failure is thrown.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { netlifyEvidenceStoreFromEnv, VAULT_READ_TIMEOUT_MS, type NetlifyEvidenceStore } from "./netlify-store.ts";
import { artifactMeta, extensionFor } from "./store.ts";
import { ARTIFACT_TIERS, artifactId, type Artifact, type ArtifactTier } from "./artifact.ts";
import type { ArtifactRecord } from "../repository/types.ts";

/** The project every standing-runner artifact is filed under (`FRESHNESS_PROJECT`). */
export const READ_ONLY_VAULT_PROJECT = "freshness";
const SIDECAR_SUFFIX = ".meta.json";
const TEMP_PREFIX = ".wtp-evidence-tmp-";

export interface HeldVaultArtifact {
  readonly id: string;
  readonly tier: ArtifactTier;
  /** `sha256-<hex>`, the vault's own form. */
  readonly contentHash: string;
  readonly contentType: string;
  readonly canonicalUrl: string | null;
  readonly retrievalUrl: string | null;
  readonly retrievedAt: string | null;
  readonly httpStatus: number | null;
  readonly sourceId: string | null;
  readonly workItemId: string | null;
  /** The Attempt that retrieved the bytes, and the route it ran, as the sidecar recorded them. */
  readonly attemptId: string | null;
  readonly methodRouteId: string | null;
  /** The robots verdict the retrieval ran under (`ALLOWED`…), as the sidecar recorded it. */
  readonly permission: string | null;
  /** Retention travels with the sidecar; a private copy cannot extend a limited lifetime. */
  readonly retentionPolicy?: string | null;
  readonly bodyPath: string;
  readonly bodySha256: string;
}

export interface VaultIndex {
  readonly byId: ReadonlyMap<string, HeldVaultArtifact>;
  /** By the bare hex of the bytes' sha256. */
  readonly byHash: ReadonlyMap<string, HeldVaultArtifact>;
  /** By the work item they were filed under: how evidence names the page a sanitized derivative was made from. */
  readonly byWorkItem: ReadonlyMap<string, readonly HeldVaultArtifact[]>;
}

interface Sidecar {
  readonly meta?: {
    readonly contentType?: string;
    readonly contentHash?: string;
    readonly custom?: Readonly<Record<string, string>>;
  };
  readonly bodySha256?: string;
}

const TIERS: readonly string[] = ARTIFACT_TIERS;
const INDEX_READ_CONCURRENCY = 16;
const capturesByIndex = new WeakMap<VaultIndex, Map<string, HeldVaultArtifact>>();

function heldFromSidecar(sidecar: Sidecar, bodyPath: string): HeldVaultArtifact | null {
  const meta = sidecar.meta, tier = meta?.custom?.tier, hash = meta?.contentHash;
  if (!meta || typeof hash !== "string" || !/^sha256-[0-9a-f]{64}$/.test(hash) || typeof tier !== "string" || !TIERS.includes(tier) || typeof sidecar.bodySha256 !== "string") return null;
  const status = Number(meta.custom?.httpStatus);
  return { id:artifactId(tier as ArtifactTier,hash),tier:tier as ArtifactTier,contentHash:hash,contentType:meta.contentType??"",
    canonicalUrl:meta.custom?.canonicalUrl??null,retrievalUrl:meta.custom?.retrievalUrl??null,retrievedAt:meta.custom?.retrievedAt??null,
    httpStatus:Number.isInteger(status)?status:null,sourceId:meta.custom?.sourceId??null,workItemId:meta.custom?.workItemId??null,
    attemptId:meta.custom?.attemptId??null,methodRouteId:meta.custom?.methodRouteId??null,permission:meta.custom?.permission??null,
    retentionPolicy:meta.custom?.retentionPolicy??null,bodyPath,bodySha256:sidecar.bodySha256 };
}

function populateIndex(index: VaultIndex, captures: ReadonlyMap<string,HeldVaultArtifact>): void {
  const byId=index.byId as Map<string,HeldVaultArtifact>,byHash=index.byHash as Map<string,HeldVaultArtifact>,byWorkItem=index.byWorkItem as Map<string,HeldVaultArtifact[]>;
  byId.clear();byHash.clear();byWorkItem.clear();
  for(const held of captures.values()) {
    byId.set(held.id,held);byHash.set(held.contentHash.slice(7),held);
    if(held.workItemId!==null) {
      const group=byWorkItem.get(held.workItemId)??[];group.push(held);byWorkItem.set(held.workItemId,group);
    }
  }
}

/** Add a successfully vaulted capture without listing the vault again. */
export function includeVaultCapture(index: VaultIndex, artifact: Artifact, key: string, root: string): void {
  const bodyPath=process.env.WTP_VAULT_PROVIDER==="netlify"?`netlify:${key}`:join(root,...key.split("/"));
  const held=heldFromSidecar({meta:artifactMeta(artifact),bodySha256:artifact.contentHash},bodyPath)!;
  const captures=capturesByIndex.get(index)??new Map([...index.byId.values()].map(row=>[row.bodyPath,row]));
  captures.set(bodyPath,held);
  const ordered=new Map([...captures].sort(([a],[b])=>a<b?-1:a>b?1:0));
  capturesByIndex.set(index,ordered);populateIndex(index,ordered);
}

async function orderedPool<T,R>(rows:readonly T[], read:(row:T)=>Promise<R>):Promise<R[]> {
  const results=new Array<R>(rows.length);let next=0;let failed=false;
  await Promise.all(Array.from({length:Math.min(INDEX_READ_CONCURRENCY,rows.length)},async()=>{
    while(!failed) {
      const at=next++;if(at>=rows.length)return;
      try {results[at]=await read(rows[at]);} catch(error) {failed=true;throw error;}
    }
  }));
  return results;
}

/** Index every committed artifact under the project, by id and by content. */
export async function indexVault(root: string, project: string = READ_ONLY_VAULT_PROJECT, options: {readonly signal?:AbortSignal} = {}): Promise<VaultIndex> {
  const byId = new Map<string, HeldVaultArtifact>();
  const byHash = new Map<string, HeldVaultArtifact>();
  const byWorkItem = new Map<string, HeldVaultArtifact[]>();
  const stopped=new AbortController();
  const requestSignal=()=>AbortSignal.any([stopped.signal,AbortSignal.timeout(VAULT_READ_TIMEOUT_MS),...(options.signal?[options.signal]:[])]);
  let held: (HeldVaultArtifact|null)[];
  const remote = netlifyEvidenceStoreFromEnv();
  try {
    if (remote) {
      const keys=await remote.list(`project/${project}/`,requestSignal());
      held=await orderedPool(keys,async key=>{
        const description=await remote.describe(key,requestSignal());
        return description?heldFromSidecar(description,`netlify:${key}`):null;
      });
    } else {
      const paths:string[]=[];
      let directories=[join(root,"project",project)];
      while(directories.length) {
        const found=await orderedPool(directories,async directory=>{
          requestSignal().throwIfAborted();
          let entries:Dirent[];
          try {entries=await readdir(directory,{withFileTypes:true});}
          catch(cause) {if((cause as NodeJS.ErrnoException).code==="ENOENT")return [] as string[];throw cause;}
          const next:string[]=[];
          for(const entry of entries) {
            if(entry.name.startsWith(TEMP_PREFIX))continue;
            const path=join(directory,entry.name);
            if(entry.isDirectory())next.push(path);
            else if(entry.name.endsWith(SIDECAR_SUFFIX))paths.push(path);
          }
          return next;
        });
        directories=found.flat();
      }
      // libuv's directory listings are ordered; parallel completion cannot
      // change which capture wins a repeated content id or its work-item order.
      held=await orderedPool(paths.sort(),async path=>heldFromSidecar(JSON.parse(await readFile(path,{encoding:"utf8",signal:requestSignal()})) as Sidecar,path.slice(0,-SIDECAR_SUFFIX.length)));
    }
  } catch(error) {stopped.abort(error);throw error;}
  const captures=new Map(held.flatMap(row=>row?[[row.bodyPath,row] as const]:[]));
  const index={byId,byHash,byWorkItem};capturesByIndex.set(index,captures);populateIndex(index,captures);
  return index;
}

/**
 * The work item a crosswalk's evidence page is filed under, named by the raw page's sha256: a page that carries a
 * credential is held only as its sanitized derivative, whose own hash differs, so the raw hash names it here.
 */
export function crosswalkEvidenceWorkItem(rawSha256: string): string {
  return `crosswalk-evidence:${rawSha256}`;
}

/** The held bytes, proved to be the bytes the sidecar committed. */
export async function readHeldBytes(artifact: HeldVaultArtifact, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<Uint8Array> {
  const remote = artifact.bodyPath.startsWith("netlify:") ? netlifyEvidenceStoreFromEnv() : null;
  if (artifact.bodyPath.startsWith("netlify:") && !remote) throw new Error("NETLIFY_VAULT_UNCONFIGURED");
  const held = remote ? await remote.get(artifact.bodyPath.slice("netlify:".length),signal) : null;
  if (remote && !held) throw new Error(`VAULT_BODY_MISSING:${artifact.id}`);
  const bytes = held?.bytes ?? await readFile(artifact.bodyPath,{signal});
  const actual = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== artifact.bodySha256) {
    throw new Error(`VAULT_BODY_CORRUPTED:${artifact.id}: the sidecar committed ${artifact.bodySha256}, the body hashes to ${actual}`);
  }
  return new Uint8Array(bytes);
}

/** Locate one attributed capture without rescanning every sidecar in the vault.
 * The record supplies date/work/hash; source directories are trusted names read
 * from the vault root, never a caller-supplied path. A missing sidecar is a miss,
 * while unreadable or malformed matching metadata is a failed read. */
export async function findHeldCapture(root: string, record: ArtifactRecord,
  remote: Pick<NetlifyEvidenceStore, "directories" | "describe"> | null = netlifyEvidenceStoreFromEnv(),
): Promise<HeldVaultArtifact | null> {
  if (!/^sha256-[0-9a-f]{64}$/.test(record.contentHash) || !/^[a-z][a-z0-9-]{1,120}$/.test(record.workItemId) ||
      !Number.isFinite(Date.parse(record.recordedAt))) throw new Error("VAULT_CAPTURE_LOOKUP_IDENTITY_INVALID");
  let host: string | null = null;
  try { host = new URL(record.canonicalUrl).hostname; } catch { /* Other registered source IDs are still searched. */ }
  const day = new Date(record.recordedAt).toISOString().slice(0, 10).replaceAll("-", "/");
  if (remote) {
    const sourcePrefix = `project/${READ_ONLY_VAULT_PROJECT}/source/`;
    const filename = `${record.contentHash}.${extensionFor(record.contentType)}`;
    const lookup = async (source: string): Promise<HeldVaultArtifact | null> => {
      const key = `${source}/${day}/${record.workItemId}/${filename}`;
      const description = await remote.describe(key);
      return description ? attributedCapture(record, description, `netlify:${key}`) : null;
    };
    // The publisher host is the common source ID. Only list source directories
    // if it misses; no vault-wide body or metadata scan is needed for one copy.
    if (host) {
      const held = await lookup(sourcePrefix + host);
      if (held) return held;
    }
    for (const source of await remote.directories(sourcePrefix)) {
      if (source === sourcePrefix + host) continue;
      const held = await lookup(source);
      if (held) return held;
    }
    return null;
  }
  const sourceRoot = join(root, "project", READ_ONLY_VAULT_PROJECT, "source");
  let sources: string[];
  try { sources = (await readdir(sourceRoot, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (host && sources.includes(host)) sources = [host, ...sources.filter(source => source !== host)];
  for (const source of sources) {
    const directory = join(sourceRoot, source, day, record.workItemId);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const name of entries.filter(name => name.startsWith(`${record.contentHash}.`) && name.endsWith(SIDECAR_SUFFIX))) {
      const sidecarPath = join(directory, name);
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as Sidecar;
      const held = attributedCapture(record, sidecar, sidecarPath.slice(0, -SIDECAR_SUFFIX.length));
      if (held) return held;
    }
  }
  return null;
}

function attributedCapture(record: ArtifactRecord, sidecar: Sidecar, bodyPath: string): HeldVaultArtifact | null {
  const meta = sidecar.meta;
  // Identical bytes acquired by another Attempt are not this record's capture.
  if (meta?.custom?.attemptId !== record.attemptId) return null;
  if (!meta || meta.contentHash !== record.contentHash || meta.custom?.tier !== record.tier ||
      meta.custom?.workItemId !== record.workItemId ||
      meta.custom?.canonicalUrl !== record.canonicalUrl || meta.custom?.retrievedAt !== record.recordedAt ||
      typeof sidecar.bodySha256 !== "string") throw new Error(`VAULT_CAPTURE_SIDECAR_MISMATCH:${record.artifactId}`);
  const status = Number(meta.custom?.httpStatus);
  return { id: artifactId(record.tier, record.contentHash), tier: record.tier, contentHash: record.contentHash,
    contentType: meta.contentType ?? "", canonicalUrl: meta.custom.canonicalUrl,
    retrievalUrl: meta.custom.retrievalUrl ?? null, retrievedAt: meta.custom.retrievedAt,
    httpStatus: Number.isInteger(status) ? status : null, sourceId: meta.custom.sourceId ?? null,
    workItemId: meta.custom.workItemId, attemptId: meta.custom.attemptId,
    methodRouteId: meta.custom.methodRouteId ?? null, permission: meta.custom.permission ?? null,
    retentionPolicy: meta.custom.retentionPolicy ?? null, bodyPath, bodySha256: sidecar.bodySha256 };
}
