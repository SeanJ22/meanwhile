import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import { receiptCapture } from "./capture.ts";
import { ensureEntity } from "./entities.ts";
import { openBlank, type Clocks, type FactDb, type Query } from "./publish.ts";
import { nameKey, publishRosterFacts } from "./roster-facts.ts";

export interface CartonImportReport {
  readonly rosters: number;
  readonly live: number;
  readonly confirmed: number;
  readonly blanks: number;
  readonly unreadable: readonly { readonly url: string; readonly reason: string }[];
}

const MEMBER_FIELDS = ["termNote", "termStart", "termEnd", "email", "phone", "websiteUrl", "contactKind"] as const;

/** The rosters readers saw before facts, each re-proved on a saved copy of its own page; what fails stays a blank with its reason. */
export async function importCartonRosters(input: {
  readonly rosters: readonly BodyRoster[]; readonly versionId: string;
  readonly facts: FactDb & { readonly query: Query }; readonly clocks: Clocks;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<CartonImportReport> {
  const report = { rosters: 0, live: 0, confirmed: 0, blanks: 0, unreadable: [] as { url: string; reason: string }[] };
  for (const roster of input.rosters) {
    const state = /\/state:([a-z]{2})/.exec(roster.bodyId)?.[1]?.toUpperCase() ?? null;
    const parentId = /^(ocd-division\/[^#]+)#/.exec(roster.bodyId)?.[1] ?? null;
    await ensureEntity(input.facts.query, { id: roster.bodyId, kind: "body", name: roster.bodyName, state, parentId });
    const byUrl = new Map<string, BodyRoster["members"]>();
    for (const member of roster.members) {
      const url = member.membershipSource?.sourceUrl ?? roster.sourceUrl;
      byUrl.set(url, [...byUrl.get(url) ?? [], member]);
    }
    for (const [url, members] of byUrl) {
      const read = await receiptCapture({ url, repos: input.repos, vault: input.vault, fetch: input.fetch, now: input.now });
      if ("error" in read) {
        report.unreadable.push({ url, reason: read.error });
        for (const member of members) {
          await openBlank(input.facts.query, { entityId: roster.bodyId, field: `member-row:${member.id}`, stage: "ACQUIRE", reason: "SOURCE_BLOCKED",
            detail: `${url}: ${read.error}`, retryMinutes: input.clocks.retryMinutes("officeholder") });
        }
        continue;
      }
      const tally = await publishRosterFacts(input.facts, {
        body: { id: roster.bodyId, name: roster.bodyName, state, parentId },
        capture: read.capture, complete: false, producedBy: `carton:${input.versionId}`,
        legacyMemberIds: new Map(members.map(member => [nameKey(member.name), member.id])),
        members: members.map(member => ({ recordId: member.id,
          fields: { name: member.name, office: member.officeTitle, ...Object.fromEntries(MEMBER_FIELDS.flatMap(field => member[field] ? [[field, member[field]]] : [])) },
          ...(member.fieldSources ? { fieldSources: member.fieldSources } : {}) })),
      }, input.clocks, new Date(input.now));
      report.live += tally.live; report.confirmed += tally.confirmed; report.blanks += tally.blanks;
    }
    report.rosters++;
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [CARTON_ROSTERS, createHash("sha256").update(input.versionId).digest("hex")]);
  return report;
}

const CARTON_ROSTERS = "carton:rosters";

/** The newest promoted registry partition that still carried rosters, until they have been carried onto facts once. */
export async function cartonRosters(query: Query, readCandidate: (id: string) => Promise<{ readonly candidate: { readonly readModel: unknown } } | null>,
  scope: string): Promise<{ readonly versionId: string; readonly rosters: readonly BodyRoster[] } | null> {
  if ((await query("SELECT 1 FROM fact_store_load WHERE source = $1", [CARTON_ROSTERS])).length) return null;
  const rows = await query(`SELECT id FROM civic_data_candidates WHERE record_class = 'REGISTRY_RUNTIME_BINDING' AND scope = $1
    AND promoted_version_id = id ORDER BY retrieved_at DESC LIMIT 20`, [scope]);
  for (const row of rows) {
    const read = await readCandidate(String(row.id));
    const rosters = (read?.candidate.readModel as { bodyRosters?: BodyRoster[] } | undefined)?.bodyRosters;
    if (rosters?.length) return { versionId: String(row.id), rosters };
  }
  return null;
}
