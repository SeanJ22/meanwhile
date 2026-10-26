import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Query } from "../facts/publish.ts";
import type { MeetingsDiscoveryAttempt } from "../hunt/meetings-site-discovery.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import { CURRENT_CALENDAR_READS_SQL } from "../control-plane/discovery/derived-wiring.ts";
import { registrationTarget } from "../registration/publication.ts";
import { MEETING_DOORS_RECORD_CLASS, MEETING_DOORS_SCOPE } from "../doors/meeting-doors.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import type { DerivedInputRef } from "./derived-authority.ts";
import { confirmDerivedSourceUnchanged, derivedSourceInputContent, withDerivedSourceContent } from "./derived-source-hash.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import type { RoutineDataStore, SourceHead } from "./store.ts";
import type { RoutineCandidate, RoutineRecordClass } from "./types.ts";

/** The current route selections and authority identifiers, without the discovery records or source bytes. */
export const MEETING_DERIVATION_SOURCE_SQL = `WITH current_walks AS MATERIALIZED (${CURRENT_CALENDAR_READS_SQL}),
  cited AS MATERIALIZED (
    SELECT DISTINCT x.item->>'artifactId' AS id FROM current_walks w
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.value->'found','[]'::jsonb)||coalesce(w.value->'steps','[]'::jsonb)) x(item)
    WHERE x.item->>'artifactId' IS NOT NULL
  ), artifact_inputs AS MATERIALIZED (
    SELECT record->>'artifactId' AS id,
      jsonb_build_object('kind','VAULTED_EVIDENCE','artifactId',record->>'artifactId','contentHash',record->>'contentHash',
        'tier',record->>'tier','retrievedAt',record->>'recordedAt') AS input
    FROM cp_log_artifacts WHERE record->>'artifactId' IN (SELECT id FROM cited)
      AND record->>'tier' IN ('RAW','SANITIZED_DERIVED')
  ) SELECT id,position,upper(value->>'stateCode') AS state,value->>'jurisdictionId' AS jurisdiction,
    value->>'attemptId' AS attempt_id,value->>'finishedAt' AS recorded_at,routes,
    coalesce((SELECT jsonb_agg(DISTINCT a.input) FROM artifact_inputs a WHERE a.id IN (
      SELECT x.item->>'artifactId' FROM jsonb_array_elements(coalesce(value->'found','[]'::jsonb)||coalesce(value->'steps','[]'::jsonb)) x(item)
    )),'[]'::jsonb) AS artifacts
  FROM current_walks ORDER BY id,position`;

export interface MeetingDerivationWalkHead {
  readonly id: string;
  readonly position: string;
  readonly state: string;
  readonly jurisdiction: string;
  readonly routes: readonly string[];
  readonly inputs: readonly DerivedInputRef[];
}
export interface MeetingDerivationProbe {
  readonly formatVersion: 1;
  readonly sourceId: string;
  readonly complete: boolean;
  readonly normalizationInputHash: string;
  /** Completed government inputs survive a pass cutoff, including when the civic facts did not change. */
  readonly groups: Readonly<Record<string, string>>;
  readonly pending: readonly string[];
}
export interface MeetingDerivationSource {
  readonly sourceContentInputs: readonly DerivedInputRef[];
  readonly walks: readonly MeetingDerivationWalkHead[];
  readonly normalizationInputHash: string;
  readonly groupHashes: Readonly<Record<string, string>>;
  readonly priorProbe: MeetingDerivationProbe | null;
  readonly outputHead: SourceHead | null;
  readonly dependenciesReady: boolean;
}

const promotedRef = (head: SourceHead | null): DerivedInputRef[] => head?.normalizedHash && head.candidateState === "PROMOTED" &&
  head.acquisitionSucceeded && !head.imported && head.versionId === head.lastKnownGoodVersionId ? [{ kind: "PROMOTED_VERSION",
    recordClass: head.recordClass, scope: head.scope, versionId: head.versionId, readModelSha256: head.normalizedHash, promotedAt: head.promotedAt }] : [];

/** Code and committed reference bytes affect normalization; a new check's clock does not. */
export function meetingDerivationConfig(root: string, files: readonly string[], settings: unknown): string {
  return canonicalCivicDataHash([settings, files.map(file => [file, canonicalCivicDataHash(readFileSync(join(root, file), "utf8"))])]);
}

export async function readMeetingDerivationSource(input: {
  readonly store: Pick<RoutineDataStore, "readSourceHead" | "readCandidatePath">;
  readonly query: Query;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly configHash: string;
  readonly pointers?: readonly { readonly recordClass: RoutineRecordClass; readonly scope: string }[];
}): Promise<MeetingDerivationSource> {
  const rows = await input.query(MEETING_DERIVATION_SOURCE_SQL, [null]);
  const walks: MeetingDerivationWalkHead[] = rows.map(row => ({ id: String(row.id), position: String(row.position), state: String(row.state),
    jurisdiction: String(row.jurisdiction), routes: row.routes as string[], inputs: [{ kind: "DISCOVERY_ATTEMPT", attemptId: String(row.attempt_id),
      recordId: String(row.position), recordedAt: String(row.recorded_at) },
      ...(typeof row.artifacts === "string" ? JSON.parse(row.artifacts) : row.artifacts) as DerivedInputRef[]] }));
  const states = [...new Set(walks.map(walk => walk.state))].sort();
  const pointers = [{ recordClass: MEETING_DOORS_RECORD_CLASS, scope: MEETING_DOORS_SCOPE }, ...(input.pointers ?? [])];
  const globalHeads = await Promise.all(pointers.map(pointer => input.store.readSourceHead(pointer.recordClass, pointer.scope)));
  const stateHeads = new Map<string, readonly (SourceHead | null)[]>();
  for (const state of states) stateHeads.set(state, await Promise.all([
    input.store.readSourceHead("REGISTRATION", registrationTarget(state).scope),
    input.store.readSourceHead("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state)),
  ]));
  const tuple = (head: SourceHead | null) => head ? [head.versionId, head.rawHash, head.normalizedHash, head.parserVersion, head.candidateState] : null;
  const normalizationInputHash = canonicalCivicDataHash([input.configHash, globalHeads.map(tuple), [...stateHeads].map(([state, heads]) => [state, heads.map(tuple)])]);
  const sourceContentInputs = [...globalHeads.flatMap(promotedRef), ...[...stateHeads.values()].flatMap(heads => heads.flatMap(promotedRef)), ...walks.flatMap(walk => walk.inputs)];
  const groupHashes = Object.fromEntries([...new Set(walks.map(walk => walk.jurisdiction))].map(jurisdiction => {
    const members = walks.filter(walk => walk.jurisdiction === jurisdiction);
    return [jurisdiction, canonicalCivicDataHash([input.configHash, globalHeads.map(tuple),
      stateHeads.get(members[0]!.state)?.map(tuple), members.map(walk => [walk.id, walk.position, walk.routes, walk.inputs.map(derivedSourceInputContent)])])];
  }));
  const outputHead = await input.store.readSourceHead(input.recordClass, input.scope);
  const rawProbe = outputHead ? await input.store.readCandidatePath<MeetingDerivationProbe>(outputHead.versionId, ["normalizedPayload", "sourceProbe"]) : null;
  const priorProbe = rawProbe?.formatVersion === 1 && rawProbe.sourceId === input.sourceId && typeof rawProbe.groups === "object" && Array.isArray(rawProbe.pending) ? rawProbe : null;
  return { sourceContentInputs, walks, normalizationInputHash, groupHashes, priorProbe, outputHead,
    dependenciesReady: promotedRef(globalHeads[0] ?? null).length > 0 };
}

export function meetingDerivationPending(source: MeetingDerivationSource, force = false): string[] {
  return Object.keys(source.groupHashes).filter(key => force || source.priorProbe?.groups[key] !== source.groupHashes[key] || source.priorProbe?.pending.includes(key));
}

export async function confirmMeetingDerivationSource(input: {
  readonly source: MeetingDerivationSource;
  readonly store: Parameters<typeof confirmDerivedSourceUnchanged>[0]["store"];
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly parserVersion: string;
  readonly now: string;
  readonly force?: boolean;
}) {
  const { source } = input;
  return confirmDerivedSourceUnchanged({ ...input, sourceContentInputs: source.sourceContentInputs,
    complete: !input.force && source.dependenciesReady && source.priorProbe?.complete === true &&
      source.priorProbe.normalizationInputHash === source.normalizationInputHash && meetingDerivationPending(source).length === 0 });
}

export function withMeetingDerivationProbe(candidate: RoutineCandidate, source: MeetingDerivationSource,
  completed: Readonly<Record<string, string>>, pending: readonly string[]): RoutineCandidate {
  const sourceProbe: MeetingDerivationProbe = { formatVersion: 1, sourceId: candidate.sourceId,
    complete: source.dependenciesReady && pending.length === 0, normalizationInputHash: source.normalizationInputHash, groups: completed, pending };
  const normalizedPayload = { ...(candidate.normalizedPayload as Record<string, unknown>), sourceProbe };
  return withDerivedSourceContent({ ...candidate, normalizedPayload,
    normalization: { ...candidate.normalization, normalizedPayloadHash: canonicalCivicDataHash(normalizedPayload) } }, source.sourceContentInputs);
}

/** Leave the standing runner time to publish the partial result before its termination signal. */
export function meetingDerivationCanContinue(): boolean { return Date.now() + 45_000 < passDeadlineFromEnv(); }

export async function readMeetingDerivationWalks(query: Query, heads: readonly MeetingDerivationWalkHead[]): Promise<{
  readonly attempt: MeetingsDiscoveryAttempt; readonly recordId: string; readonly recordedAt: string; readonly routes: string[];
}[]> {
  if (!heads.length) return [];
  const rows = await query(`SELECT log_key,record AS value,position FROM cp_log_discovery_attempts
    WHERE (log_key,position::text) IN (SELECT item->>0,item->>1 FROM jsonb_array_elements($1::jsonb) item)`,
    [JSON.stringify(heads.map(head => [head.id, head.position]))]);
  const byPosition = new Map(heads.map(head => [`${head.id}:${head.position}`, head]));
  return rows.map(row => { const attempt = (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as MeetingsDiscoveryAttempt;
    return { attempt, recordId: String(row.position), recordedAt: attempt.finishedAt, routes: [...(byPosition.get(`${row.log_key}:${row.position}`)?.routes ?? [])] }; });
}
