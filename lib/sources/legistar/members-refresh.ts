import { join } from "node:path";
import { DurableEvidenceStore } from "../../control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../../control-plane/scheduler/vault.ts";
import { ensureMeetingDoors } from "../../doors/meeting-doors.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { heldLegistarMemberRows } from "./members-tasks.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { loadLegistarMembers, saveLegistarMembers } from "./members-cache.ts";
import { makeLegistarMembersReader } from "./members.ts";
import { publishLegistarMembers } from "./members-publication.ts";
import { runInSourceAcquisitionDomain, ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../acquisition-deadline.ts";

export async function refreshLegistarMembers(store: RoutineDataStore, now: string, slug: string) {
  await ensureMeetingDoors({ store, now });
  const rows = await heldLegistarMemberRows({ store, now, bypassCache: true });
  const tenants = new Map<string, BodySourceWiring[]>();
  for (const row of rows.filter(row => row.agendaSourceType === "LEGISTAR" && row.config.slug === slug)) {
    const held = tenants.get(row.config.slug) ?? [];
    if (!held.some(prior => prior.bodyId === row.bodyId)) tenants.set(row.config.slug, [...held, row]);
  }
  const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
  const gaps: { key: string; detail: string }[] = [];
  let records = 0, versionId: string | null = null, candidateId: string | null = null;
  for (const [slug, own] of tenants) {
    try {
      const read = makeLegistarMembersReader(undefined, await loadLegistarMembers(vault, slug));
      const raw = await runInSourceAcquisitionDomain({ sourceLabel: `legistar-members:${slug}`, timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS }, signal => read(slug, signal));
      await saveLegistarMembers(vault, raw, now);
      const result = await publishLegistarMembers({ store, raw, rows: own, now: new Date().toISOString() });
      gaps.push(...result.unbound.map(gap => ({ key: gap.key, detail: gap.code })));
      records += result.changed; versionId = result.published.promoted!.versionId; candidateId = result.published.candidate.candidate.id;
    } catch (error) { gaps.push({ key: slug, detail: error instanceof Error ? error.message : String(error) }); }
  }
  return { records, versionId, candidateId, gaps };
}
