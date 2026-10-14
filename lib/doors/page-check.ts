import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { DiscoveryRuntime } from "../control-plane/discovery/meetings-discovery-executor.ts";
import { censusReader } from "../control-plane/discovery/census-lane.ts";
import { isDoorRecord, type DoorRecord } from "./registry.ts";
import { divisionOfPage } from "./page-doors.ts";
import { probeUrlFor } from "./probe.ts";
import { recordDoorEvidence } from "./shut.ts";
import { recordDoorOutcome } from "./outcome.ts";
import { verifyEndpointBody } from "../hunt/meetings-site-discovery.ts";
import { enqueueWorkerTask } from "../control-plane/workers/runtime.ts";
import { loadRegistrationReference } from "../registration/reference.ts";
import { createHash } from "node:crypto";
import { classifySourceContent, SOURCE_FAMILIES } from "./source-content.ts";
import { recordSourceObservation } from "./source-capture.ts";
import { cycleVault, VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import { join } from "node:path";

export async function bindPageGovernment(repos: ControlPlaneRepositories, door: DoorRecord, now: string, root = process.cwd()): Promise<DoorRecord> {
  if (door.kind !== "page") return door;
  const items = typeof door.config.workItemId === "string" ? [await repos.workItems.read(door.config.workItemId)]
    : await repos.workItems.listWhere(["publicationOutcome", "doorId"], door.doorId);
  const divisions = new Set<string>();
  for (const item of items) {
    if (!item) continue;
    const contract = item.value.autonomousPlan?.contract;
    const canonical = contract?.schemaVersion === 2 ? contract.jurisdiction.canonicalId : item.value.subject;
    let division = divisionOfPage(canonical) ?? divisionOfPage(item.value.subject);
    if (!division && /^[a-z]{2}:/i.test(canonical ?? "")) {
      const ref = loadRegistrationReference(root, canonical!.slice(0, 2)).reference;
      const government = ref.governments.find(row => row[1] === canonical);
      division = government && government[4] >= 0 ? ref.divisions[government[4]]?.[0] ?? null : null;
    }
    if (division) divisions.add(division);
  }
  const ocdId = door.ocdId ?? divisionOfPage(door.bodyIds[0]) ?? (divisions.size === 1 ? [...divisions][0] : null);
  const workItemId = items.find(item => item)?.id;
  if (ocdId === door.ocdId && (!workItemId || door.config.workItemId === workItemId)) return door;
  const row = await repos.doors.mustRead(door.doorId);
  const next = { ...row.value, ocdId, config: { ...row.value.config, ...(workItemId ? { workItemId } : {}) } };
  return (await repos.doors.compareAndSet(door.doorId, row.revision, next, now)).value;
}

async function queuePageRead(repos: ControlPlaneRepositories, door: DoorRecord, now: string, changedAt: string) {
  if (typeof door.config.workItemId !== "string") throw new Error(`${door.doorId}: no saved work instructions for this page`);
  const item = await repos.workItems.mustRead(door.config.workItemId);
  const plan = item.value.autonomousPlan;
  if (!plan) throw new Error(`${door.doorId}: no saved extraction contract`);
  const url = probeUrlFor(door);
  const acquisitions = plan.acquisition.filter(source => source.route.url === url);
  if (!acquisitions.length) throw new Error(`${door.doorId}: no saved acquisition route for the page`);
  for (const acquisition of acquisitions) await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", contract: plan.contract,
    artifactId: acquisition.route.observation.artifactId, now, acquisition: { ...acquisition, held: [] },
    replayLabel: `page-check:${door.doorId}:${changedAt}` });
}

export async function runPageDoorChecks(repos: ControlPlaneRepositories, runtime: DiscoveryRuntime, doors: readonly DoorRecord[], root = process.cwd()) {
  const report = { read: 0, changed: 0, failures: [] as string[] };
  for (const original of doors) {
    if (runtime.budget.spent()) break;
    if (original.kind !== "page" || original.status !== "OPEN") continue;
    try {
      const door = await bindPageGovernment(repos, original, runtime.now(), root);
      const at = runtime.now();
      const lastCheck = Date.parse(door.validators?.checkedAt ?? "");
      const cadence = (door.checkEveryMinutes ?? 720) * 60_000;
      if (!door.readNow && Number.isFinite(lastCheck) && Date.parse(at) - lastCheck < cadence) continue;
      const url = probeUrlFor(door);
      if (!url) throw new Error(`${door.doorId}: page has no address`);
      const page = await censusReader(runtime, door.doorId).get(url);
      if (!page) {
        await recordDoorOutcome(repos.doors, door.doorId, "FAILURE", at);
        throw new Error(`${door.doorId}: source could not be read`);
      }
      const contentHash = createHash("sha256").update(page.body).digest("hex");
      const changed = contentHash !== door.validators?.contentHash;
      const pending = changed || Boolean(door.validators?.changedAt && Date.parse(door.validators.changedAt) > Date.parse(door.lastSuccessAt ?? "1970-01-01"));
      const changedAt = changed ? at : door.validators!.changedAt!;
      if (pending) {
        if (typeof door.config.sourceScopes === "string") {
          const scopes = JSON.parse(door.config.sourceScopes) as { ocdId: string; state: string; names: string[] }[];
          for (const scope of scopes) await recordSourceObservation(repos, { url, ...scope,
            disposition: classifySourceContent({ url, text: page.body, contentType: page.contentType ?? "", names: scope.names, owed: SOURCE_FAMILIES }),
            capture: { bytes: new TextEncoder().encode(page.body), contentType: page.contentType ?? "" } }, at, cycleVault(join(root, ...VAULT_DIR)));
          await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", at);
        } else await queuePageRead(repos, door, at, changedAt);
      }
      const row = await repos.doors.mustRead(door.doorId);
      await repos.doors.compareAndSet(door.doorId, row.revision, { ...row.value, readNow: false,
        validators: { etag: null, lastModified: null, contentHash, checkedAt: at, changedAt: changed ? at : door.validators?.changedAt ?? null } }, at);
      if (!pending) await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", at);
      report.read++;
      if (changed) report.changed++;
    } catch (error) { report.failures.push(error instanceof Error ? error.message : String(error)); }
  }
  return report;
}

export async function recheckShutDoors(repos: ControlPlaneRepositories, runtime: DiscoveryRuntime, doors: readonly DoorRecord[]) {
  const report = { checked: 0, reopened: 0, failures: [] as string[] };
  for (const door of doors) {
    if (runtime.budget.spent()) break;
    if (!isDoorRecord(door) || door.status !== "SHUT") continue;
    try {
      const url = probeUrlFor(door);
      const page = url ? await censusReader(runtime, door.doorId).get(url) : null;
      const row = await repos.doors.mustRead(door.doorId);
      await repos.doors.compareAndSet(door.doorId, row.revision, { ...row.value, validators: {
        etag: null, lastModified: null, contentHash: row.value.validators?.contentHash ?? null,
        changedAt: row.value.validators?.changedAt ?? null, checkedAt: runtime.now() } }, runtime.now());
      report.checked++;
      if (!page || !url) { report.failures.push(`${door.doorId}: runner transport could not read the source`); continue; }
      const vendor = door.kind === "legistar" ? "legistar-api" : door.kind === "civicclerk" ? "civicclerk-api" : door.kind;
      const check = verifyEndpointBody({ vendor, url },
        { status: page.status, body: page.body, finalUrl: page.url });
      if (check.verdict !== "YIELDED") { report.failures.push(`${door.doorId}: ${check.detail}`); continue; }
      const reopened = await recordDoorEvidence(repos.doors, door.doorId, { kind: "GOOD", rows: check.count ?? 0 }, runtime.now(), repos);
      await recordDoorOutcome(repos.doors, door.doorId, "SUCCESS", runtime.now());
      if (reopened.change === "REOPENED") report.reopened++;
    } catch (error) { report.failures.push(`${door.doorId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return report;
}
