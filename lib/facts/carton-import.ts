import { requireRegistryState, stateFromRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { createHash } from "node:crypto";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import type { BodyRoster } from "../registry/body-rosters.ts";
import { receiptCapture } from "./capture.ts";
import { ensureEntity } from "./entities.ts";
import { openBlank, type Clocks, type FactDb, type Query } from "./publish.ts";
import { nameKey, publishRosterFacts } from "./roster-facts.ts";
import { publishCommentFacts } from "./comment-facts.ts";
import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { Body } from "../registry/types.ts";
import { publishBodyOffice } from "../civic-data/worker-body-directory.ts";

interface CartonImportReport {
  readonly rosters: number;
  readonly live: number;
  readonly confirmed: number;
  readonly blanks: number;
  readonly unreadable: readonly { readonly url: string; readonly reason: string }[];
}

const MEMBER_FIELDS = ["termNote", "termStart", "termEnd", "email", "phone", "websiteUrl", "contactKind"] as const;
// Re-prove the input after a parser/checker repair, then remember that exact input in the existing load row.
const importHash = (version:string) => createHash("sha256").update(`2:${version}`).digest("hex");

/** The rosters readers saw before facts, each re-proved on a saved copy of its own page; what fails stays a blank with its reason. */
export async function importCartonRosters(input: {
  readonly rosters: readonly BodyRoster[]; readonly versionId: string; readonly state: string;
  readonly facts: FactDb & { readonly query: Query }; readonly clocks: Clocks;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<CartonImportReport> {
  const report = { rosters: 0, live: 0, confirmed: 0, blanks: 0, unreadable: [] as { url: string; reason: string }[] };
  for (const roster of input.rosters) {
    const state = /\/state:([a-z]{2})/.exec(roster.bodyId)?.[1]?.toUpperCase() ?? null;
    const parentId = /^(ocd-division\/[^#]+)#/.exec(roster.bodyId)?.[1] ?? null;
    const bodyId = await ensureEntity(input.facts.query, { id: roster.bodyId, kind: "body", name: roster.bodyName, state, parentId });
    const byUrl = new Map<string, BodyRoster["members"]>();
    for (const member of roster.members) {
      const url = member.membershipSource?.sourceUrl ?? roster.sourceUrl;
      byUrl.set(url, [...byUrl.get(url) ?? [], member]);
    }
    for (const [url, members] of byUrl) {
      const read = await receiptCapture({ url, repos: input.repos, vault: input.vault, fetch: input.fetch, now: input.now, windowHours: input.clocks.windowHours("officeholder") });
      if ("error" in read) {
        report.unreadable.push({ url, reason: read.error });
        for (const member of members) {
          await openBlank(input.facts.query, { entityId: bodyId, field: `member-row:${member.id}`, stage: "ACQUIRE", reason: "SOURCE_BLOCKED",
            detail: `${url}: ${read.error}`, retryMinutes: input.clocks.retryMinutes("officeholder") });
        }
        continue;
      }
      const tally = await publishRosterFacts(input.facts, {
        body: { id: roster.bodyId, name: roster.bodyName, state, parentId },
        capture: read.capture, complete: false, producedBy: `carton:${input.versionId}`,
        shownMemberIds: new Map(members.map(member => [nameKey(member.name), member.id])),
        members: members.map(member => ({ recordId: member.id,
          fields: { name: member.name, office: member.officeTitle, ...Object.fromEntries(MEMBER_FIELDS.flatMap(field => member[field] ? [[field, member[field]]] : [])) },
          ...(member.fieldSources ? { fieldSources: member.fieldSources } : {}) })),
      }, input.clocks, new Date(input.now));
      report.live += tally.live; report.confirmed += tally.confirmed; report.blanks += tally.blanks;
    }
    report.rosters++;
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [`${CARTON_ROSTERS}:${requireRegistryState(input.state)}`, importHash(input.versionId)]);
  return report;
}

const CARTON_ROSTERS = "carton:rosters";

/** Carries each state's current rosters onto facts once. */
export async function cartonRosters(query: Query, readCandidate: (id: string) => Promise<{ readonly candidate: { readonly readModel: unknown } } | null>,
  scope: string): Promise<{ readonly versionId: string; readonly rosters: readonly BodyRoster[]; readonly state: string } | null> {
  const state = stateFromRegistryRuntimeScope(scope);
  if (!state) throw new Error(`REGISTRY_STATE_SCOPE_INVALID:${scope}`);
  const [row] = await query("SELECT current_version_id AS id FROM civic_data_promotions WHERE key=$1",
    [`REGISTRY_RUNTIME_BINDING:${scope}`]);
  if (!row) return null;
  if ((await query("SELECT sha256 FROM fact_store_load WHERE source=$1",[`${CARTON_ROSTERS}:${state}`]))[0]?.sha256 === importHash(String(row.id))) return null;
  const read = await readCandidate(String(row.id));
  const rosters = (read?.candidate.readModel as { bodyRosters?: BodyRoster[] } | undefined)?.bodyRosters;
  return rosters?.length ? { versionId: String(row.id), rosters, state } : null;
}

const CARTON_COMMENTS = "carton:comment-rules";
/** Where comment rules were promoted before they were facts. */
const COMMENT_PARTITION = { recordClass: "CURATED_READER_RECORD", scope: "US-AZ+US-NH+US-NJ:public-comment-rules:reviewed-bodies" } as const;

/** The newest promoted comment-rule partition, until it has been carried onto facts once. */
export async function cartonComments(query: Query, readCandidate: (id: string) => Promise<{ readonly candidate: { readonly readModel: unknown } } | null>):
  Promise<{ readonly versionId: string; readonly records: readonly CommentAccess[] } | null> {
  const [row] = await query(`SELECT id FROM civic_data_candidates WHERE record_class = $1 AND scope = $2 AND promoted_version_id = id
    ORDER BY retrieved_at DESC LIMIT 1`, [COMMENT_PARTITION.recordClass, COMMENT_PARTITION.scope]);
  if (!row) return null;
  if ((await query("SELECT sha256 FROM fact_store_load WHERE source=$1",[CARTON_COMMENTS]))[0]?.sha256 === importHash(String(row.id))) return null;
  const records = ((await readCandidate(String(row.id)))?.candidate.readModel as { records?: CommentAccess[] } | undefined)?.records ?? [];
  return { versionId: String(row.id), records };
}

/** The comment rules readers saw before facts, each rule re-proved on a saved copy of its page. */
export async function importCartonComments(input: {
  readonly records: readonly CommentAccess[]; readonly versionId: string;
  readonly facts: FactDb & { readonly query: Query }; readonly clocks: Clocks;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<CartonImportReport> {
  const report = { rosters: 0, live: 0, confirmed: 0, blanks: 0, unreadable: [] as { url: string; reason: string }[] };
  for (const record of input.records) {
    const state = /\/state:([a-z]{2})/.exec(record.bodyId)?.[1]?.toUpperCase() ?? /^curated:([a-z]{2})\//.exec(record.bodyId)?.[1]?.toUpperCase() ?? null;
    const body = { id: record.bodyId, name: record.bodyNames?.[0] ?? null, state, parentId: record.ocdId };
    const read = await receiptCapture({ url: record.sourceUrl, repos: input.repos, vault: input.vault, fetch: input.fetch, now: input.now, windowHours: input.clocks.windowHours("comment_rule") });
    if ("error" in read) {
      report.unreadable.push({ url: record.sourceUrl, reason: read.error });
      const bodyId = await ensureEntity(input.facts.query, { id: body.id, kind: "body", name: body.name ?? body.id, state, parentId: body.parentId });
      await openBlank(input.facts.query, { entityId: bodyId, field: "comment:period", stage: "ACQUIRE", reason: "SOURCE_BLOCKED",
        detail: `${record.sourceUrl}: ${read.error}`, retryMinutes: input.clocks.retryMinutes("comment_rule") });
      continue;
    }
    const outcomes = await publishCommentFacts(input.facts, { body, capture: read.capture, producedBy: `carton:${input.versionId}`,
      reading: { fields: record as unknown as Record<string, unknown>, fieldSources: record.fieldSources ?? {} } }, input.clocks, new Date(input.now));
    report.live += outcomes.filter(row => "decision" in row && row.decision === "PUBLISH").length;
    report.confirmed += outcomes.filter(row => "decision" in row && row.decision === "CONFIRM").length;
    report.blanks += outcomes.filter(row => "blank" in row).length;
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [CARTON_COMMENTS, importHash(input.versionId)]);
  return report;
}

const CARTON_OFFICES = "carton:office-contacts";

/** The bodies whose office address or phone readers saw before facts, until they have been carried onto facts once. */
export async function cartonOffices(query: Query, registry: { readonly versionId: string; readonly payload: { readonly registry: { readonly bodies: readonly Body[] } } } | null, state: string):
  Promise<{ readonly versionId: string; readonly bodies: readonly Body[]; readonly state: string } | null> {
  if (!registry || (await query("SELECT sha256 FROM fact_store_load WHERE source=$1",[`${CARTON_OFFICES}:${requireRegistryState(state)}`]))[0]?.sha256 === importHash(registry.versionId)) return null;
  return { versionId: registry.versionId, state: requireRegistryState(state), bodies: registry.payload.registry.bodies.filter(row => (row.officeAddress || row.officePhone) && row.provenance.sourceUrl) };
}

/** The office addresses and phones readers saw on bodies before facts, each re-proved on a saved copy of the body's page. */
export async function importCartonOffices(input: {
  readonly bodies: readonly Body[]; readonly versionId: string; readonly state: string;
  readonly facts: FactDb & { readonly query: Query }; readonly clocks: Clocks;
  readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<CartonImportReport> {
  const report = { rosters: 0, live: 0, confirmed: 0, blanks: 0, unreadable: [] as { url: string; reason: string }[] };
  for (const body of input.bodies) {
    const url = body.provenance.sourceUrl!;
    const read = await receiptCapture({ url, repos: input.repos, vault: input.vault, fetch: input.fetch, now: input.now, windowHours: input.clocks.windowHours("contact") });
    if ("error" in read) {
      report.unreadable.push({ url, reason: read.error });
      const bodyId = await ensureEntity(input.facts.query, { id: body.id, kind: "body", name: body.name ?? body.id, state: /\/state:([a-z]{2})/.exec(body.id)?.[1]?.toUpperCase() ?? null, parentId: body.ocdId });
      for (const field of [body.officeAddress ? "office_address" : null, body.officePhone ? "office_phone" : null].filter((f): f is string => f !== null)) {
        await openBlank(input.facts.query, { entityId: bodyId, field, stage: "ACQUIRE", reason: "SOURCE_BLOCKED", detail: `${url}: ${read.error}`,
          retryMinutes: input.clocks.retryMinutes("contact") });
        report.blanks++;
      }
      continue;
    }
    const outcomes = await publishBodyOffice(input.facts, body, { bodyId: body.id, capture: read.capture, address: body.officeAddress ?? null, phone: body.officePhone ?? null },
      `carton:${input.versionId}`, input.clocks, new Date(input.now));
    report.live += outcomes.filter(row => "decision" in row && row.decision === "PUBLISH").length;
    report.confirmed += outcomes.filter(row => "decision" in row && row.decision === "CONFIRM").length;
    report.blanks += outcomes.filter(row => "blank" in row).length;
    report.rosters++;
  }
  await input.facts.query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
    ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [`${CARTON_OFFICES}:${requireRegistryState(input.state)}`, importHash(input.versionId)]);
  return report;
}
