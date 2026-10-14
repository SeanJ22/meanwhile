import { contentHash } from "../control-plane/ids.ts";
import { artifactId, classifyAcquisition, defaultRetention, type Artifact } from "../control-plane/evidence/artifact.ts";
import { newFieldManualEntry, writeFieldManual } from "../control-plane/field-manual.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { CycleVault } from "../control-plane/scheduler/vault.ts";
import { pageDoorDraft, pageAddress } from "./page-doors.ts";
import { upsertDerivedDoor } from "./registry.ts";
import { VOTING_SOURCE_DOOR_KIND } from "../ballot/voting-source-publication.ts";
import type { SourceDisposition } from "./source-content.ts";

type Repos = Pick<ControlPlaneRepositories, "doors" | "artifacts" | "fieldManual">;
interface SourceObservation {
  url: string;
  ocdId: string;
  state: string;
  names: readonly string[];
  disposition: SourceDisposition;
  capture: { contentType: string; bytes: Uint8Array } | null;
  workItemId?: string;
}

export async function recordSourceObservation(repos: Repos, observation: SourceObservation, at: string, vault: Pick<CycleVault, "putBytes">) {
  const address = pageAddress(observation.url);
  if (!address) throw new Error("Source observation has no public URL");
  const { disposition } = observation;
  let copyId: string | null = null;
  if (observation.capture) {
    const { bytes, contentType } = observation.capture;
    const hash = contentHash(bytes), tier = classifyAcquisition(new TextDecoder().decode(bytes)).tier;
    const workItemId = observation.workItemId ?? `source:${observation.ocdId}`;
    const artifact: Artifact = { id: artifactId(tier, hash), tier, contentHash: hash, byteLength: bytes.byteLength,
      contentType, canonicalUrl: address.url, retrievalUrl: observation.url, retrievedAt: at, httpStatus: 200,
      headers: {}, sourceId: "source-discovery", methodRouteId: "source-discovery", workItemId,
      attemptId: `source-discovery:${workItemId}:${at}`, permission: "ALLOWED", transport: "REACHABLE", retentionPolicy: defaultRetention(tier) };
    const saved = await vault.putBytes(artifact, bytes);
    if (!saved.stored) throw new Error(saved.why);
    if (!(await repos.artifacts.read(workItemId)).some(row => row.artifactId === artifact.id)) await repos.artifacts.append(workItemId, artifact.id, { artifactId: artifact.id, workItemId, routeTaskId: null,
      attemptId: artifact.attemptId, tier, contentHash: hash, byteLength: bytes.byteLength,
      contentType, canonicalUrl: address.url, partial: false, recordedAt: at }, at);
    copyId = artifact.id;
  }
  await recordSourceDisposition(repos, observation, copyId, at);
  if (disposition.kind === "DOOR" && disposition.recordClass && disposition.family !== "voting") {
    const draft = pageDoorDraft({ url: address.url, recordClass: disposition.recordClass, retrievedAt: at,
      ocdId: observation.ocdId, workItemId: observation.workItemId, foundBy: null })!;
    const prior = (await repos.doors.listWhere(["config", "url"], address.url)).find(row => row.value.status !== "SUSPENDED");
    const scopes = JSON.parse(String(prior?.value.config.sourceScopes ?? "[]")) as { ocdId: string; state: string; names: string[] }[];
    const scope = { ocdId: observation.ocdId, state: observation.state, names: [...observation.names] };
    const mappings = [...new Map([...scopes, scope].map(scope => [scope.ocdId, scope])).values()];
    await upsertDerivedDoor(repos.doors, { ...draft, kind: prior?.value.kind ?? draft.kind, doorId: prior?.id ?? draft.doorId, ocdId: prior?.value.ocdId ?? draft.ocdId,
      holds: [...new Set([...(prior?.value.holds ?? []), ...draft.holds!])],
      config: { ...prior?.value.config, ...draft.config, sourceScopes: JSON.stringify(mappings) } }, at, at);
  } else if (disposition.kind !== "DOOR") await retireSourceDoors(repos.doors, observation, at);
  return { copyId, disposition: disposition.kind };
}

export async function recordSourceDisposition(repos: Pick<ControlPlaneRepositories, "fieldManual">,
  observation: Pick<SourceObservation, "url" | "ocdId" | "state" | "names" | "disposition">, copyId: string | null, at: string) {
  const address = pageAddress(observation.url);
  if (!address) return;
  const { disposition } = observation;
  const kind = disposition.kind === "DOOR" ? "SOURCE_REGISTER" : disposition.kind === "EVIDENCE" ? "SOURCE_EVIDENCE" : "SOURCE_SKIPPED";
  const entry = newFieldManualEntry("source-content", `${observation.ocdId}:${address.url}`, { role: "SHARED", kind,
    title: observation.names[0] ?? observation.ocdId, summary: disposition.reason,
    states: [observation.state.toLowerCase()], recordClasses: disposition.recordClass ? [disposition.recordClass] : [],
    observedAt: at, outcome: disposition.kind === "SKIP" ? "REFERENCE" : "YIELDED", url: address.url,
    payload: { ocdId: observation.ocdId, disposition: disposition.kind, copyId, quote: disposition.quote } });
  const written = await writeFieldManual(repos, [entry], at);
  if (written.error) throw new Error(written.error);
}

export async function retireSourceDoors(repo: ControlPlaneRepositories["doors"],
  observation: Pick<SourceObservation, "url" | "ocdId" | "disposition" | "capture" | "workItemId">, at: string) {
  const address = pageAddress(observation.url);
  if (!address || observation.disposition.kind === "DOOR") return;
  const rows = [...await repo.listWhere(["config", "url"], address.url), ...await repo.listWhere(["kind"], VOTING_SOURCE_DOOR_KIND)];
  for (const row of new Map(rows.map(row => [row.id, row])).values()) {
    const door = row.value;
    if (door.origin !== "DERIVED" || door.status === "SUSPENDED" || !["page", VOTING_SOURCE_DOOR_KIND].includes(door.kind)) continue;
    const url = door.kind === VOTING_SOURCE_DOOR_KIND
      ? (JSON.parse(String(door.config.votingSource)) as { url: string }).url : String(door.config.url);
    if (pageAddress(url)?.url !== address.url) continue;
    if (!observation.capture && (door.lastSuccessAt || door.validators?.checkedAt)) continue;
    if (observation.disposition.kind === "SKIP" && door.ocdId !== observation.ocdId && !(observation.workItemId && door.config.workItemId === observation.workItemId)) continue;
    await repo.compareAndSet(row.id, row.revision, { ...door, status: "SUSPENDED", readNow: false,
      notes: observation.disposition.reason, updatedAt: at }, at);
  }
}
