/** The runner's one-time child: republishes every pointed version that still embeds source bodies as one holding vault references. */
import { pathToFileURL } from "node:url";
import { publishPeopleSource, readPeopleSourceProjection, peopleJurisdiction } from "../lib/civic-data/people-source-publication.ts";
import { publishStatePeople, type StatePeopleAcquisition } from "../lib/civic-data/state-people-publication.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { federalDirectoryCandidate, type FederalDirectoryAcquisition, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { readOpenStatesPeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { holdPluralVoteEvidence, pluralVotesCandidate, pluralVotesContract, readPluralVotesProjection, type PluralBillEvidence, type PluralVotesProjection } from "../lib/sources/plural/votes.ts";
import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { captureConversionLine } from "../lib/civic-data/capture-conversion.ts";

const PEOPLE_SOURCES = ["official-state-people", "statewide-executive-sources", "congress-api"] as const;
/* Facts the builders derive again from the roster and gaps; carrying them would list them twice. */
const DERIVED_PEOPLE_FACTS = new Set(["PEOPLE_FIELD_DISAGREEMENT", "PEOPLE_SOURCE_COMPARISON_PENDING", "PEOPLE_SOURCE_GAP"]);
type Facts = NonNullable<RoutineCandidate["excludedFacts"]>;
interface Converted { readonly scope: string; readonly from: string; readonly to: string | null; readonly refusal?: string }

const embedded = (rows: unknown): rows is { body: string }[] => Array.isArray(rows) && rows.some(row => typeof (row as { body?: unknown }).body === "string");
const outcomeOf = (scope: string, from: string, outcome: { promoted: { versionId: string } | null; candidate: { failureCode?: string | null } }): Converted =>
  ({ scope, from, to: outcome.promoted?.versionId ?? null, ...(outcome.promoted ? {} : { refusal: outcome.candidate.failureCode ?? "REFUSED" }) });

async function pointed(store: RoutineDataStore, read: { kind: string; metadata?: { versionId?: string | null } }) {
  return read.kind === "PROMOTED" && read.metadata?.versionId ? (await store.readCandidate(read.metadata.versionId))?.candidate ?? null : null;
}

async function convertEmbeddedCaptures(input: { store: RoutineDataStore; vault: EvidenceStore; now: () => string; states?: readonly string[] }): Promise<Converted[]> {
  const { store, vault, now } = input, states = input.states ?? PLURAL_STATES, converted: Converted[] = [];
  for (const state of states) for (const sourceId of PEOPLE_SOURCES) {
    const held = await pointed(store, await readPeopleSourceProjection(peopleJurisdiction(state), sourceId, { store, now: now(), bypassCache: true }));
    const payload = held?.normalizedPayload as { releaseId: string; acquisitions?: StatePeopleAcquisition[]; excludedFacts?: Facts } | undefined;
    if (!held || !embedded(payload?.acquisitions)) continue;
    const facts = payload.excludedFacts ?? [];
    const { outcome } = await publishPeopleSource({ store, vault, state, sourceId, roster: (held.readModel as { roster: Parameters<typeof publishPeopleSource>[0]["roster"] }).roster,
      acquisitions: payload.acquisitions, releaseId: payload.releaseId, now: now(), confirmUnchanged: false,
      gaps: facts.filter(fact => fact.code === "PEOPLE_SOURCE_GAP").map(fact => fact.record as { sourceUrl: string; detail: string }),
      excludedFacts: facts.filter(fact => !DERIVED_PEOPLE_FACTS.has(fact.code)) });
    converted.push(outcomeOf(held.scope, held.id, outcome));
  }
  for (const state of states) {
    const held = await pointed(store, await readOpenStatesPeopleProjection(`US-${state.toUpperCase()}`, { store, now: now(), bypassCache: true }));
    const payload = held?.normalizedPayload as { releaseId: string; acquisitions?: StatePeopleAcquisition[]; gaps?: { sourceUrl: string; detail: string }[]; excludedFacts?: Facts } | undefined;
    if (!held || !embedded(payload?.acquisitions)) continue;
    const { outcome } = await publishStatePeople({ store, vault, state, roster: (held.readModel as { roster: Parameters<typeof publishStatePeople>[0]["roster"] }).roster,
      acquisitions: payload.acquisitions, releaseId: payload.releaseId, now: now(), confirmUnchanged: false, gaps: payload.gaps ?? [],
      excludedFacts: (payload.excludedFacts ?? []).filter(fact => !fact.key?.includes(":native-record:")) });
    converted.push(outcomeOf(held.scope, held.id, outcome));
  }
  for (const state of states) {
    const held = await pointed(store, await readPluralVotesProjection(state, { store, now: now(), bypassCache: true }));
    const payload = held?.normalizedPayload as { acquisitions?: PluralBillEvidence[]; held?: { key: string; detail: string }[] } | undefined;
    if (!held || !embedded(payload?.acquisitions)) continue;
    const candidate = pluralVotesCandidate({ projection: held.readModel as PluralVotesProjection, acquired: await Promise.all(payload.acquisitions.map(row => holdPluralVoteEvidence(vault, row))),
      held: payload.held ?? [], checkedAt: now() });
    converted.push(outcomeOf(held.scope, held.id, await processRegisteredRoutineCandidate(store, pluralVotesContract(state), candidate, now(), held.id, { confirmUnchanged: false })));
  }
  const directory = await pointed(store, await readFederalDirectoryProjection({ store, now: now(), bypassCache: true }));
  const acquisitions = (directory?.normalizedPayload as { acquisitions?: FederalDirectoryAcquisition[] } | undefined)?.acquisitions;
  if (directory && embedded(acquisitions)) {
    const candidate = await federalDirectoryCandidate({ acquisitions, vault, retrievedAt: directory.retrieval.retrievedAt!, projection: directory.readModel as FederalDirectoryReadModel,
      excludedFacts: (directory.normalizedPayload as { excludedFacts?: Facts }).excludedFacts });
    converted.push(outcomeOf(directory.scope, directory.id, await processRegisteredManualCandidate(store, "congress-bulk-roster", candidate, now(), directory.id, { confirmUnchanged: false })));
  }
  return converted;
}

async function main() {
  assertRuntimeAuthority({ capabilities: ["CAPTURE_CONVERSION"] });
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const converted = await convertEmbeddedCaptures({ store: new PostgresRoutineDataStore(), vault: rawCaptureVault(), now: () => new Date().toISOString() });
  for (const row of converted) console.log(captureConversionLine(row));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
