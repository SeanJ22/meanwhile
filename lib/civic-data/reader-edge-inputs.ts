import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv } from "../control-plane/repository/pg-store.ts";
import { factReader, factsVersion } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { FEDERAL_PORTRAITS_SCOPE } from "../officials/federal-directory-read-model.ts";
import { STATE_PEOPLE_JURISDICTIONS, statePeopleSourcePointers } from "../officials/people-identity.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "../outcomes/data-plane.ts";
import { DOOR_OUTCOME_POINTERS } from "../outcomes/door-outcome-pointers.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../registry/runtime-data-plane.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { UNCHANGED_CONFIRMATION_PREFIX } from "./unchanged-confirmation.ts";
import { routineScopeState } from "./state-scope.ts";
import type { PromotedPointerIdentity } from "./types.ts";
import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

type Pointer = Pick<PromotedPointerIdentity, "recordClass" | "scope">;
const manual = (id: string) => MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === id)!;

export function readerEdgeSpecialPointers(doors: readonly Pointer[] = DOOR_OUTCOME_POINTERS) {
  return {
    "census-districts": [{ recordClass: CENSUS_GEO_RECORD_CLASS, scope: CENSUS_GEO_SCOPE }],
    "registry-runtime": [manual("registry-runtime-bindings")],
    "federal-directory": [manual("congress-bulk-roster"), { recordClass: "FEDERAL_DIRECTORY" as const, scope: FEDERAL_PORTRAITS_SCOPE }],
    "campaign-sites": [manual("campaign-sites")],
    "state-legislators": STATE_PEOPLE_JURISDICTIONS.flatMap(jurisdiction => statePeopleSourcePointers(jurisdiction)),
    "meeting-outcomes": [PIMA_LEGISTAR_OUTCOMES_CONTRACT, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, ...doors],
  };
}

export async function readerEdgeInputFingerprint(input: {
  readonly state: string;
  readonly queryDoors?: Query;
  readonly queryPromotions?: Query;
  readonly queryFacts?: Query | null;
  readonly codeVersion?: string;
}): Promise<string> {
  const state = routineScopeState(input.state);
  let queryDoors = input.queryDoors;
  if (!queryDoors) {
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("READER_EDGE_DOOR_REGISTRY_UNCONFIGURED");
    const sql = neon(connection);
    queryDoors = (statement, params = []) => sql.query(statement, [...params]);
  }
  const queryPromotions = input.queryPromotions ?? factReader();
  if (!queryPromotions) throw new Error("READER_EDGE_PROMOTION_STORE_UNCONFIGURED");
  const [doors] = await queryDoors(`SELECT md5(coalesce(string_agg(md5(jsonb_build_array(id,
      value->'kind',value->'bodyIds',value->'status',value->'holds',value->'config',value->'meeting')::text),
      '' ORDER BY id),'')) AS fingerprint
    FROM cp_doors WHERE value #>> '{scopeState}'=$1`, [state]);
  const [promotions] = await queryPromotions(`SELECT md5(coalesce(string_agg(md5(jsonb_build_array(p.key,p.source_id,
      p.current_version_id,p.last_known_good_version_id,p.promoted_at,
      (SELECT confirmation.sequence FROM civic_data_candidate_events confirmation
        WHERE confirmation.candidate_id=p.current_version_id AND left(confirmation.detail,$3)=$4
        ORDER BY confirmation.sequence DESC LIMIT 1))::text),'' ORDER BY p.key),'')) AS fingerprint
    FROM civic_data_promotions p WHERE civic_scope_state(p.scope)=$1 OR p.key=$2`,
  [state, `REGISTRY_RUNTIME_BINDING:${REGISTRY_RUNTIME_SCOPE}`, UNCHANGED_CONFIRMATION_PREFIX.length, UNCHANGED_CONFIRMATION_PREFIX]);
  for (const row of [doors, promotions]) {
    if (typeof row?.fingerprint !== "string" || !/^[a-f0-9]{32}$/.test(row.fingerprint)) throw new Error("READER_EDGE_INPUT_IDENTITY_INVALID");
  }
  const facts = await factsVersion(input.queryFacts === undefined ? factReader() : input.queryFacts, "", state);
  return createHash("sha256").update(JSON.stringify(["reader-inputs/2", state,
    input.codeVersion ?? process.env.WTP_RUNTIME_AUTHORITY_SHA ?? null, doors!.fingerprint, promotions!.fingerprint, facts])).digest("hex");
}

export async function checkReaderEdgePublicationInputs(input: Parameters<typeof readerEdgeInputFingerprint>[0] & {
  readonly artifactStore?: ReaderArtifactStore | null;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
}): Promise<{ readonly fingerprint: string; readonly current: ReaderEdgePublicationOutcome | null }> {
  const artifactStore = input.artifactStore === undefined ? resolveReaderArtifactWriteStore() : input.artifactStore;
  const fingerprint = await readerEdgeInputFingerprint(input);
  const state = routineScopeState(input.state);
  if (!artifactStore || artifactStore.kind === "local-file" && (input.env ?? process.env).WTP_READER_EDGE_LOCAL_OK !== "1") return { fingerprint, current: null };
  const identity = await artifactStore.readPublicationIdentity(state === "US" ? undefined : state.slice(3));
  const meetings = state === "US" ? await artifactStore.readPublicationIdentity("US") : identity;
  return { fingerprint, current: identity?.fingerprint === fingerprint && meetings?.fingerprint === fingerprint
    ? { ok: true, readerEdge: "CURRENT", store: artifactStore.kind === "local-file" ? "local folder" : "Netlify Blobs",
      sequence: identity.sequence, detail: null } : null };
}
