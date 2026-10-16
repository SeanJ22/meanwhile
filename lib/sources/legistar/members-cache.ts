import { createHash } from "node:crypto";
import { recordAcquisition, type Artifact } from "../../control-plane/evidence/artifact.ts";
import { putArtifact, putManifest, buildManifest, readArtifact, type EvidenceStore, type EvidenceManifest, manifestKey } from "../../control-plane/evidence/store.ts";
import { FRESHNESS_PROJECT } from "../../control-plane/scheduler/durable.ts";
import { legistarMemberSignature, validateLegistarMembers, type LegistarMembers, type CachedLegistarMembers, memberReading, memberProbe } from "./members-model.ts";

export async function loadLegistarMembers(vault: EvidenceStore, slug: string): Promise<CachedLegistarMembers | null> {
  const workItemId = `legistar-members:${slug}`;
  const pointer = await vault.get(latestKey(slug));
  if (!pointer) return null;
  const { manifest: key, signature, collectedAt } = JSON.parse(new TextDecoder().decode(pointer.bytes));
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) || !Number.isFinite(Date.parse(collectedAt))) throw new Error("LEGISTAR_MEMBERS_CACHE_POINTER_INVALID");
  if (typeof key !== "string" || !key.startsWith(`project/${FRESHNESS_PROJECT}/source/legistar:${slug}/`) ||
    !key.endsWith(`/${workItemId}/manifest.json`) || key.includes("..")) throw new Error("LEGISTAR_MEMBERS_CACHE_POINTER_INVALID");
  return { signature, collectedAt, read: () => readLegistarMembers(vault, slug, key, signature) };
}

async function readLegistarMembers(vault: EvidenceStore, slug: string, key: string, signature: string): Promise<LegistarMembers> {
  const workItemId = `legistar-members:${slug}`;
  const stored = await vault.get(key);
  if (!stored) throw new Error("LEGISTAR_MEMBERS_CACHE_MANIFEST_MISSING");
  const manifest: EvidenceManifest = JSON.parse(new TextDecoder().decode(stored.bytes));
  if (manifest.project !== FRESHNESS_PROJECT || manifest.workItemId !== workItemId || !Array.isArray(manifest.artifacts)) throw new Error("LEGISTAR_MEMBERS_CACHE_MANIFEST_INVALID");
  const readings: LegistarMembers["readings"] = [];
  const raw: LegistarMembers = { slug, bodies: [], persons: [], offices: [], readings, signature: "", collectedAt: "" };
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    const url = new URL(artifact.canonicalUrl), collection = url.pathname.split("/").at(-1)!;
    if (url.origin !== "https://webapi.legistar.com" || url.pathname !== `/v1/${slug}/${collection}` || !["bodies", "persons", "officerecords"].includes(collection)) throw new Error("LEGISTAR_MEMBERS_CACHE_ROUTE_INVALID");
    if (memberProbe(url)) continue;
    const held = await readArtifact(vault, FRESHNESS_PROJECT, artifact, "PARSER");
    if (`sha256-${createHash("sha256").update(held.bytes).digest("hex")}` !== artifact.contentHash || held.bytes.byteLength !== artifact.byteLength) throw new Error("LEGISTAR_MEMBERS_CACHE_HASH_INVALID");
    const rows = JSON.parse(held.text);
    if (!Array.isArray(rows)) throw new Error("LEGISTAR_MEMBERS_CACHE_ROWS_INVALID");
    seen.add(collection);
    if (collection === "bodies") raw.bodies.push(...rows);
    else if (collection === "persons") raw.persons.push(...rows);
    else raw.offices.push(...rows);
    readings.push(memberReading(artifact, rows));
  }
  if (seen.size !== 3) throw new Error("LEGISTAR_MEMBERS_CACHE_INCOMPLETE");
  raw.bodies.sort((a, b) => a.BodyId - b.BodyId); raw.persons.sort((a, b) => a.PersonId - b.PersonId); raw.offices.sort((a, b) => a.OfficeRecordId - b.OfficeRecordId);
  validateLegistarMembers(raw);
  raw.signature = legistarMemberSignature(raw);
  if (raw.signature !== signature) throw new Error("LEGISTAR_MEMBERS_CACHE_SIGNATURE_INVALID");
  raw.collectedAt = readings.map(reading => reading.artifact.retrievedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!;
  return raw;
}

export async function saveLegistarMembers(vault: EvidenceStore, raw: LegistarMembers, now: string): Promise<void> {
  const artifacts = raw.readings.map(reading => reading.artifact);
  if (!artifacts.length) throw new Error("LEGISTAR_MEMBERS_CACHE_NO_SOURCE_READS");
  const latest = [...artifacts].sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt)).at(-1)!;
  await putManifest(vault, FRESHNESS_PROJECT, latest, buildManifest(FRESHNESS_PROJECT, latest.workItemId, artifacts, now));
  const pointer = Buffer.from(JSON.stringify({ manifest: manifestKey(FRESHNESS_PROJECT, latest), signature: legistarMemberSignature(raw), collectedAt: raw.collectedAt }));
  await vault.put(latestKey(raw.slug), pointer, { contentType: "application/json", byteLength: pointer.byteLength,
    contentHash: `manifest:legistar-members:${raw.slug}:latest`, objectClass: "MUTABLE_INDEX" });
}

export async function saveLegistarReading(vault: EvidenceStore, slug: string, reading: {
  url: string; text: string; retrievedAt: string; body: unknown;
}) {
  const { artifact } = recordAcquisition({ canonicalUrl: reading.url, retrievedAt: reading.retrievedAt, httpStatus: 200, contentType: "application/json",
    sourceId: `legistar:${slug}`, methodRouteId: "legistar-members", workItemId: `legistar-members:${slug}`, attemptId: reading.retrievedAt,
    permission: "ALLOWED", transport: "REACHABLE" }, reading.text);
  await putArtifact(vault, FRESHNESS_PROJECT, artifact, Buffer.from(reading.text));
  return memberReading(artifact, reading.body);
}

export async function legistarMemberCapture(vault: EvidenceStore, artifact: Artifact) {
  const held = await readArtifact(vault, FRESHNESS_PROJECT, artifact, "PARSER");
  if (`sha256-${createHash("sha256").update(held.bytes).digest("hex")}` !== artifact.contentHash || held.bytes.byteLength !== artifact.byteLength) throw new Error("LEGISTAR_MEMBERS_CACHE_HASH_INVALID");
  return { evidence: { artifactId: artifact.id, contentHash: artifact.contentHash, text: held.text, acquiredByAttemptId: artifact.attemptId,
    canonicalUrl: artifact.canonicalUrl, retrievedAt: artifact.retrievedAt, sourceId: artifact.sourceId, methodRouteId: artifact.methodRouteId },
    observedAt: artifact.retrievedAt, httpStatus: 200, transport: "REACHABLE" as const, partial: false };
}

function latestKey(slug: string): string {
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
  return `project/${FRESHNESS_PROJECT}/source/legistar:${slug}/latest.json`;
}
