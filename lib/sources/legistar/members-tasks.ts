import { requiredManualProductionContract } from "../../civic-data/manual-contracts.ts";
import type { RoutineSourceTask, RoutineTaskClock } from "../../civic-data/runner.ts";
import { activeWiring, type BodySourceWiring } from "../../registry/source-wiring.ts";
import { readDerivedMeetingWiring, bodySourceWiringFor } from "../../civic-data/derived-meeting-wiring.ts";
import { readRegistryRuntimePrior } from "../../registry/runtime-data-plane.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";

export function legistarMemberTasks(rows: readonly BodySourceWiring[]): RoutineSourceTask[] {
  const contract = requiredManualProductionContract("registry-runtime-bindings");
  const slugs = [...new Set(rows.filter(row => row.agendaSourceType === "LEGISTAR").map(row => row.config.slug).filter(slug => /^[a-z0-9_-]+$/i.test(slug ?? "")))];
  return slugs.map(slug => ({ id: `legistar-members:${slug}`, registeredContractId: contract.id,
    sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    acquisitionFailureDomain: `legistar:${slug}`, requestedUrl: `https://webapi.legistar.com/v1/${slug}/officerecords`,
    authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: contract.parserNormalizerVersion,
    command: [...contract.command, "--legistar-members", `--legistar-client=${slug}`], cadenceMs: 12 * 60 * 60_000, retryMs: 60 * 60_000,
    contract: { readerProjection: contract.readerProjection, cadence: { defaultEveryMs: 12 * 60 * 60_000, description: "Twice-daily public members and terms" } } }));
}

export async function heldLegistarMemberRows(options: PromotedCivicDataReadOptions = {}): Promise<BodySourceWiring[]> {
  const derived = await readDerivedMeetingWiring(options);
  if (derived.kind !== "PROMOTED" && derived.kind !== "NOT_RECORDED") throw new Error("LEGISTAR_MEMBERS_TASK_WIRING_UNAVAILABLE");
  const rows = [...activeWiring(), ...(derived.kind === "PROMOTED" ? derived.value.records
    .filter(record => record.status === "ACTIVE" && ["LEGISTAR", "LEGISTAR_INSITE"].includes(record.row.kind))
    .map(record => {
      const row = bodySourceWiringFor(record.row);
      if (record.row.kind === "LEGISTAR_INSITE") {
        const slug = /^([a-z0-9_-]+)\.legistar\.com$/i.exec(new URL(record.row.route).hostname)?.[1];
        if (!slug) throw new Error("LEGISTAR_MEMBERS_INSITE_CLIENT_UNRESOLVED");
        row.config = { ...row.config, slug, eventBodyName: row.config.insiteBodyName || record.row.bodyName };
      }
      return row;
    }) : [])];
  const unique = new Map<string, BodySourceWiring>();
  for (const row of rows.filter(row => row.agendaSourceType === "LEGISTAR")) {
    const key = `${row.config.slug}:${row.bodyId}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

export async function heldLegistarMemberTasks(options: PromotedCivicDataReadOptions = {}): Promise<RoutineSourceTask[]> {
  return legistarMemberTasks(await heldLegistarMemberRows(options));
}

export async function legistarMemberClocks(store: RoutineDataStore, now: string): Promise<ReadonlyMap<string, RoutineTaskClock>> {
  const prior = await readRegistryRuntimePrior(store, now);
  const tenants = new Map<string, Map<string, string>>();
  for (const source of prior?.sourceReceipt.sources ?? []) {
    if (source.reviewOutcome === "BLOCKED" || source.httpStatus !== 200) continue;
    const url = new URL(source.finalUrl);
    const route = /^\/v1\/([a-z0-9_-]+)\/(bodies|persons|officerecords)$/.exec(url.pathname);
    if (url.hostname !== "webapi.legistar.com" || !route) continue;
    const reads = tenants.get(route[1]) ?? new Map<string, string>();
    if (Date.parse(source.retrievedAt) > Date.parse(reads.get(route[2]) ?? "1970-01-01")) reads.set(route[2], source.retrievedAt);
    tenants.set(route[1], reads);
  }
  return new Map([...tenants].filter(([, reads]) => reads.size === 3).map(([slug, reads]) => {
    const at = [...reads.values()].sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    return [`legistar-members:${slug}`, { lastAttemptedAt: at, lastSucceededAt: at, lastSucceededObservedAt: at }];
  }));
}
