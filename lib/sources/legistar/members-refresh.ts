import { join } from "node:path";
import { DurableEvidenceStore } from "../../control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../../control-plane/scheduler/vault.ts";
import { legistarTenantDoors } from "../../doors/legistar-tenant.ts";
import { legistarDoorQuery } from "./members-tasks.ts";
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
  const source = `legistar-members:${input.slug}`;
  const inputSource = `${source}:input`;
  const [prior] = await input.facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", [inputSource]);
  const [publication] = await input.facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", [source]);
  const read = makeLegistarMembersReader(vault, input.fetchImpl,
    publication && prior ? String(prior.sha256) : null, rows);
  const raw = await runInSourceAcquisitionDomain({ sourceLabel: `legistar-members:${input.slug}`, timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS }, signal => read(input.slug, signal));
  if (!raw) {
    const checkedAt = new Date(Math.max(Date.now(), Date.parse(input.now))).toISOString();
    await input.facts.query("UPDATE fact_store_load SET loaded_at=$2 WHERE source=$1", [source, checkedAt]);
    const signature = String(publication!.sha256);
    return { records: 0, held: 0, blanks: 0, blankReasons: {}, signature, versionId: `${source}:${signature}`,
      checkedAt, unchanged: true, members: null, bodies: null, gaps: null };
  }
  // The pages were saved after the pass began; checking them against the start time refuses every fresh read.
  const publishedAt = new Date(Math.max(Date.now(), Date.parse(raw.collectedAt), Date.parse(input.now))).toISOString();
  const result = await publishLegistarMembers({ facts: input.facts, clocks: input.clocks, vault, raw, rows, now: publishedAt });
  await input.facts.query(`INSERT INTO fact_store_load(source,sha256,loaded_at) VALUES($1,$2,$3)
    ON CONFLICT(source) DO UPDATE SET sha256=EXCLUDED.sha256,loaded_at=EXCLUDED.loaded_at`, [inputSource, raw.inputFingerprint, publishedAt]);
  return result;
}
