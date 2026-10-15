import { join } from "node:path";
import { DurableEvidenceStore } from "../../control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../../control-plane/scheduler/vault.ts";
import { legistarTenantDoors } from "../../doors/legistar-tenant.ts";
import { legistarDoorQuery } from "./members-tasks.ts";
import { loadLegistarMembers, saveLegistarMembers } from "./members-cache.ts";
import { makeLegistarMembersReader } from "./members.ts";
import { publishLegistarMembers } from "./members-publication.ts";
import type { Clocks, FactDb, Query } from "../../facts/publish.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { runInSourceAcquisitionDomain, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../acquisition-deadline.ts";

export async function refreshLegistarMembers(input: {
  facts: FactDb & { readonly query: Query }; clocks: Clocks; now: string; slug: string;
  doors?: Query; vault?: EvidenceStore; fetchImpl?: typeof fetch;
}) {
  const rows = await legistarTenantDoors(input.doors ?? legistarDoorQuery(), input.slug);
  if (!rows.length) throw new Error("LEGISTAR_MEMBERS_TENANT_UNBOUND");
  const vault = input.vault ?? new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
  let prior = await loadLegistarMembers(vault, input.slug);
  if (prior && Date.parse(input.now) - Date.parse(prior.collectedAt) > input.clocks.windowHours("officeholder") * 3_600_000) prior = null;
  const read = makeLegistarMembersReader(input.fetchImpl, prior);
  const raw = await runInSourceAcquisitionDomain({ sourceLabel: `legistar-members:${input.slug}`, timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS }, signal => read(input.slug, signal));
  await saveLegistarMembers(vault, raw, input.now);
  return publishLegistarMembers({ facts: input.facts, clocks: input.clocks, vault, raw, rows, now: input.now });
}
