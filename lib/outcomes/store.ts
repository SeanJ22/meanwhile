/**
 * **READING THE DURABLE OUTCOME STORE — the retrieval half.**
 * (WS-LEGI, 2026-08-29.)
 *
 * `types.ts` in this directory says what is persisted and why. This file is how
 * anything gets it back out, and it is deliberately the ONLY way: the store's
 * whole value is that a caller asking *what did they decide* cannot be handed an
 * agenda, and that guarantee has to live in the accessor rather than in a
 * convention every caller is trusted to follow.
 *
 * ## The contract, for the integration owner
 *
 * ```ts
 * outcomeEvidenceFor({
 *   bodyId: "ocd-division/country:us/state:az/county:pima#governing",
 *   questionClass: "WHAT_WAS_DECIDED",
 * })
 * ```
 *
 * returns an {@link OutcomeEvidence} whose `state` is a NAMED state and whose
 * `records` are already filtered to the classes that answer that question. When
 * nothing answers, `gap` is a sentence that says WHOSE gap it is — and the
 * states are kept apart precisely so that sentence can be true:
 *
 * | state | what is actually true |
 * |---|---|
 * | `HELD` | We hold records that answer the question. |
 * | `NO_SITTING_HELD` | We hold no sitting for this body at all. OURS. |
 * | `NOT_YET_INGESTED` | We hold the sitting; no outcome ingest has run on it. OURS. |
 * | `EXTRACTION_FAILED` | Ingest ran and the route returned nothing. OURS, and RETRYABLE. |
 * | `NO_ACTION_RECORDED` | Ingest succeeded; the publisher recorded no action. THEIRS. |
 * | `ACTION_WITHOUT_ROLL_CALL` | Actions held; no per-person roll exists. THEIRS. |
 * | `MINUTES_NOT_YET_PUBLISHED` | The sitting concluded; its minutes are not published yet. THEIRS. |
 *
 * Those last three are the only ones that are facts about a government, and they are
 * the ones the render default must never let the others impersonate. `CLAUDE.md`:
 * *"We haven't recorded this yet" is a fact about us; "not in this chamber for
 * this vote" is a fact about them. They may never render as the same sentence.*
 *
 * `ACTION_WITHOUT_ROLL_CALL` is not a hypothetical. It is **108 acted Pima items
 * in four months** — items the board demonstrably decided and for which the
 * clerk entered no per-person roll. A store that returned "no records" for those
 * would be describing a real, well-documented decision as an absence.
 */

import { readFileSync } from "node:fs";

import {
  evidenceRecordsFor,
  ruleOnQuestion,
} from "../answerability/record-class.ts";
import type {
  QuestionClass,
  RecordClass,
} from "../answerability/record-class.ts";

import type {
  LegistarAgendaRecord,
  LegistarOutcomeRecord,
  LegistarRollCallRecord,
} from "../sources/legistar/outcomes.ts";
import { reconcilePublicationObservations } from "./publication.ts";
import type { ReconciledPublication } from "./publication.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "./types.ts";
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT,
  mesaMinutesOutcomeScopeIssue,
  PIMA_LEGISTAR_OUTCOMES_CONTRACT,
} from "./data-plane.ts";
import { currentMeetingOutcomesEdge, settleEdgeFirst } from "../registry/runtime-edge.ts";
import { DOOR_OUTCOME_POINTERS, doorOutcomeScopeIssue, type DoorOutcomePointer } from "./door-outcome-pointers.ts";

/** Where the committed store lives, relative to the repo root. */
export const OUTCOME_SNAPSHOT_PATH = ["data", "states", "az", "outcomes", "legistar-outcomes.json"];

const EMPTY: OutcomeSnapshot = {
  generatedOn: "UNKNOWN",
  generatedAt: "UNKNOWN",
  tenants: [],
  sittings: [],
};

let outcomeReadState: CivicDataReadResult<OutcomeSnapshot> = civicDataReadNotInitialized(
  PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
  PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
  "The Pima Legistar outcome pointer has not been read for this process.",
);
/** The edge version the current state was primed from, or null when it came from the database. */
let edgePrimedVersion: string | null = null;

/*
 * **MESA'S POINTER, HELD BESIDE PIMA'S** (NH332, 2026-09-25). Mesa's council
 * decisions are a separate routine contract with its own scope and pointer
 * (`mesa-legistar-minutes-outcomes`), so a Mesa refusal never moves Pima's
 * facts and a Pima refusal never moves Mesa's. The Reader combines the two
 * into the one snapshot every consumer already reads (`getOutcomeSnapshot`),
 * each sitting keeping its own publisher and provenance.
 *
 * Mesa has no bundled seed: before its first promotion it is simply not
 * recorded, and a Mesa read that fails leaves Pima's answers untouched.
 */
const MESA = MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT;
const mesaNotInitialized = (): CivicDataReadResult<OutcomeSnapshot> =>
  civicDataReadNotInitialized(MESA.recordClass, MESA.scope, "The Mesa minutes outcome pointer has not been read for this process.");
let mesaReadState: CivicDataReadResult<OutcomeSnapshot> = mesaNotInitialized();

/**
 * **EVERY DOOR'S POINTER, HELD BESIDE THEM** (DB-22). A door that collects outcomes has its own scope and pointer, so
 * its refusal never moves another door's facts. Each is read into its own state; a failed read is recorded there and
 * never costs a reader the others' answers. Empty unless a process read the registry's doors
 * (`door-outcome-pointers.ts`), and then the Reader combines these exactly as it combines Mesa's.
 */
const doorReadStates = new Map<string, { readonly pointer: DoorOutcomePointer; readonly state: CivicDataReadResult<OutcomeSnapshot> }>();
/**
 * What an edge artifact carried for the doors: every sitting that is neither Pima's nor Mesa's, with the pointers it
 * names. An edge process has no door list of its own, so the artifact is the list.
 */
let edgeDoorPart: { readonly value: OutcomeSnapshot; readonly pointers: readonly OutcomePointerRef[] } | null = null;

/** One or more doors' promoted sittings, with the pointers (version per door) they were read at. */
export interface DoorOutcomePart { readonly value: OutcomeSnapshot; readonly pointers: readonly OutcomePointerRef[] }

export interface OutcomePointerRef { readonly contractId: string; readonly tenant: string; readonly versionId: string }

/**
 * The committed store, read once per process.
 *
 * **A missing file returns the EMPTY store rather than throwing**, and that is a
 * deliberate difference from `getVotesSnapshot`, which throws so its callers can
 * choose a fallback. The difference is that every state this module reports is
 * already a named honest state: an empty store makes every query return
 * `NO_SITTING_HELD`, which is exactly true — we hold no sitting — and produces
 * the correct reader gap. Throwing here would make a missing artefact an
 * exception in a request path whose honest answer is a sentence.
 *
 * It is NOT a silent empty: `loadedFrom` reports whether a file was actually
 * read, and the ingest script and the tests both assert against real content.
 */
/**
 * A snapshot a test installed, taking precedence over the file.
 *
 * **This exists because the read below must be a LITERAL.** A path a bundler
 * cannot see is a path it must assume could be anything, and when this module
 * was first imported by `app/api/ask/grounded/route.ts` the old
 * `join(base, ...OUTCOME_SNAPSHOT_PATH)` made Turbopack trace **4,532 files**
 * into that one route bundle against a committed ceiling of 220 — `tests/`
 * fixtures and `docs/feedback` screenshots included. That is the R23 shape
 * `lib/sources/ballot-curated/index.ts` documents, and the last time it
 * happened planted credential fixtures reached a deployed artefact and failed
 * Netlify's secrets scan.
 *
 * A `root` PARAMETER cannot be reintroduced to fix a test. Any variable in the
 * path re-arms the whole-project trace, which is why the seam is a parsed
 * snapshot rather than a directory: a test that wants a different store reads
 * its own fixture — test files are not bundled — and installs the result.
 */
let injected: OutcomeSnapshot | null = null;

/**
 * Install a snapshot for the duration of a test, or pass `null` to restore the
 * file. Always restore: a leaked injection makes the next test read a store it
 * did not choose.
 */
export function useOutcomeSnapshotForTests(snapshot: OutcomeSnapshot | null): void {
  injected = snapshot;
  edgePrimedVersion = null;
  outcomeReadState = civicDataReadNotInitialized(
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
    "The Pima Legistar outcome pointer has not been read for this process.",
  );
  mesaReadState = mesaNotInitialized();
  doorReadStates.clear();
  edgeDoorPart = null;
}

function testSeed(): OutcomeSnapshot | null {
  if (!mayUseTestFixture()) return null;
  try {
    return JSON.parse(
      readFileSync("data/states/az/outcomes/legistar-outcomes.json", "utf8"),
    ) as OutcomeSnapshot;
  } catch {
    return null;
  }
}

function outcomeTestBootstrap(): CivicDataBootstrap<OutcomeSnapshot> {
  const value = testSeed();
  if (!value) throw new Error("PIMA_LEGISTAR_OUTCOME_TEST_SEED_MISSING");
  return {
    value,
    sourceId: PIMA_LEGISTAR_OUTCOMES_CONTRACT.sourceId,
    version: value.generatedAt,
    versionId: `test-seed:pima-legistar-outcomes:${value.generatedAt}`,
    sourceThrough: value.generatedAt,
    retrievedAt: value.generatedAt,
    detail: "Node test fixture selected only inside the explicit test process.",
  };
}

function validateOutcomeProjection(value: OutcomeSnapshot, version: string): void {
  if (!Array.isArray(value.sittings) || !Array.isArray(value.tenants)) {
    throw new Error(`Pima Legistar outcome projection ${version} is malformed.`);
  }
  if (value.sittings.some((sitting) => sitting.slug !== "pima" || sitting.meetingId !== `legistar:pima:${sitting.eventId}`)) {
    throw new Error(`Pima Legistar outcome projection ${version} crosses its tenant or meeting-id scope.`);
  }
}

/** Read the exact GOOD pointer. A database error never reopens tracked state. */
export async function readOutcomeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  edgePrimedVersion = null;
  outcomeReadState = mayUseTestFixture()
    ? await readPromotedOrBootstrap<OutcomeSnapshot>({
        ...options,
        recordClass: PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
        scope: PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
        bootstrap: outcomeTestBootstrap,
        allowUnconfiguredBootstrap: true,
      })
    : await readPromotedCivicData<OutcomeSnapshot>(
        PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
        PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
        options,
      );
  if (outcomeReadState.kind === "PROMOTED" || outcomeReadState.kind === "BOOTSTRAP") {
    validateOutcomeProjection(outcomeReadState.value, outcomeReadState.metadata.versionId ?? "unknown");
  }
  return outcomeReadState;
}

function validateMesaOutcomeProjection(value: OutcomeSnapshot, version: string): void {
  if (!Array.isArray(value.sittings) || !Array.isArray(value.tenants)) {
    throw new Error(`Mesa minutes outcome projection ${version} is malformed.`);
  }
  if (mesaMinutesOutcomeScopeIssue(value) !== null) {
    throw new Error(`Mesa minutes outcome projection ${version} crosses its tenant or meeting-id scope.`);
  }
}

/** Read Mesa's exact GOOD pointer. Its own scope; never Pima's. */
export async function readMesaOutcomeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  const read = await readPromotedCivicData<OutcomeSnapshot>(MESA.recordClass, MESA.scope, options);
  if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
    validateMesaOutcomeProjection(read.value, read.metadata.versionId ?? "unknown");
  }
  mesaReadState = read;
  return read;
}

/**
 * Read both pointers. Returns Pima's version, as it always has (the reader
 * proof and its callers key on it); Mesa's read is settled beside it and a
 * Mesa store failure is recorded in its own state rather than thrown, so it
 * can never cost a reader Pima's answers.
 */
export async function refreshOutcomeSnapshotFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const [pima] = await Promise.all([
    readOutcomeProjection(options),
    readDoorOutcomeProjections(options),
    readMesaOutcomeProjection(options).catch((error: unknown) => {
      mesaReadState = civicDataReadNotInitialized(MESA.recordClass, MESA.scope, `The Mesa minutes outcome read failed: ${error instanceof Error ? error.message : String(error)}`);
      return mesaReadState;
    }),
  ]);
  return promotedVersionOrThrow(pima);
}

/**
 * Read every door's exact GOOD pointer into its own state. A read that fails is recorded in that door's state and is
 * never thrown: one door's store failure cannot cost a reader Pima's, Mesa's or another door's answers.
 */
async function readOneDoorOutcome(pointer: DoorOutcomePointer, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  const read = await readPromotedCivicData<OutcomeSnapshot>(pointer.recordClass, pointer.scope, options);
  if (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP") {
    const issue = !Array.isArray(read.value.sittings) || !Array.isArray(read.value.tenants)
      ? `${pointer.contractId} is malformed.`
      : doorOutcomeScopeIssue(pointer, read.value);
    if (issue !== null) throw new Error(`Door outcome projection ${read.metadata.versionId ?? "unknown"}: ${issue}`);
  }
  return read;
}

/** One door's exact GOOD pointer by scope, for its own reader verification and proof. */
export async function readDoorOutcomeProjection(
  scope: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  const pointer = DOOR_OUTCOME_POINTERS.find((candidate) => candidate.scope === scope);
  if (pointer === undefined) throw new Error(`DOOR_OUTCOME_POINTER_UNKNOWN:${scope}`);
  return readOneDoorOutcome(pointer, options);
}

export async function readDoorOutcomeProjections(options: PromotedCivicDataReadOptions = {}): Promise<void> {
  const pointers = [...DOOR_OUTCOME_POINTERS];
  for (const key of [...doorReadStates.keys()]) if (!pointers.some((pointer) => pointer.contractId === key)) doorReadStates.delete(key);
  await Promise.all(pointers.map(async (pointer) => {
    try {
      doorReadStates.set(pointer.contractId, { pointer, state: await readOneDoorOutcome(pointer, options) });
    } catch (error) {
      doorReadStates.set(pointer.contractId, {
        pointer,
        state: civicDataReadNotInitialized(pointer.recordClass, pointer.scope, `The ${pointer.contractId} outcome read failed: ${error instanceof Error ? error.message : String(error)}`),
      });
    }
  }));
}

/** The doors whose read failed (neither promoted nor honestly not recorded yet); a publisher leaves these out whole. */
export function doorOutcomesUnreadable(): readonly string[] {
  return [...doorReadStates.values()]
    .filter(({ state }) => state.kind !== "PROMOTED" && state.kind !== "NOT_RECORDED" && state.kind !== "BOOTSTRAP")
    .map(({ pointer }) => pointer.contractId);
}

/** Each door's promoted part, for the combined view and the edge publisher. */
export function doorOutcomeParts(): readonly { readonly pointer: DoorOutcomePointer; readonly value: OutcomeSnapshot; readonly versionId: string }[] {
  return [...doorReadStates.values()].flatMap(({ pointer, state }) =>
    (state.kind === "PROMOTED" || state.kind === "BOOTSTRAP") && state.metadata.versionId
      ? [{ pointer, value: state.value, versionId: state.metadata.versionId }]
      : []);
}

/** Mesa's version alone, for its own reader verification and proof. */
export async function refreshMesaOutcomeSnapshotFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readMesaOutcomeProjection(options));
}

export const outcomeProjectionReadState = (): CivicDataReadResult<OutcomeSnapshot> => outcomeReadState;
export const mesaOutcomeProjectionReadState = (): CivicDataReadResult<OutcomeSnapshot> => mesaReadState;

function edgeMetadata(contract: { readonly recordClass: typeof PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass; readonly scope: string; readonly sourceId: string }, versionId: string) {
  return {
    recordClass: contract.recordClass,
    scope: contract.scope,
    sourceId: contract.sourceId,
    version: null,
    versionId,
    lastKnownGoodVersionId: versionId,
    sourceThrough: null,
    retrievedAt: null,
    promotedAt: null,
    stale: "CURRENT" as const,
    staleAt: null,
  };
}

/** One tenant's part of a combined snapshot. */
function tenantPart(value: OutcomeSnapshot, tenant: string, meetingPrefix: string): OutcomeSnapshot {
  return {
    generatedOn: value.generatedOn,
    generatedAt: value.generatedAt,
    tenants: value.tenants.filter((slug) => slug === tenant),
    sittings: value.sittings.filter((sitting) => sitting.slug === tenant && sitting.meetingId.startsWith(meetingPrefix)),
  };
}

/** What an edge artifact carries beyond Pima's and Mesa's: every door's sittings, still named by their pointers. */
function doorPartOf(value: OutcomeSnapshot): { readonly value: OutcomeSnapshot; readonly pointers: readonly OutcomePointerRef[] } | null {
  const named = new Set<string>([PIMA_LEGISTAR_OUTCOMES_CONTRACT.contractId, MESA.contractId]);
  const pointers = (value.pointers ?? []).filter((pointer) => !named.has(pointer.contractId));
  if (pointers.length === 0) return null;
  const sittings = value.sittings.filter((sitting) =>
    !sitting.meetingId.startsWith("legistar:pima:") && !sitting.meetingId.startsWith(`legistar-insite:${MESA.slug}:`));
  return {
    value: {
      generatedOn: value.generatedOn,
      generatedAt: value.generatedAt,
      tenants: [...new Set(sittings.map((sitting) => sitting.slug))].sort(),
      sittings,
    },
    pointers,
  };
}

/**
 * The version string of the COMBINED edge artifact: Pima's version alone while
 * Mesa has no pointer (so the artifact carried before this change stays
 * current), and both, named, once it does.
 */
export function combinedOutcomeVersionId(
  pimaVersionId: string | null,
  mesaVersionId: string | null,
  doors: readonly { readonly contractId: string; readonly versionId: string }[] = [],
): string | null {
  if (mesaVersionId === null && doors.length === 0) return pimaVersionId;
  const named = [...doors].sort((a, b) => a.contractId.localeCompare(b.contractId)).map((door) => `${door.contractId}=${door.versionId}`);
  const parts = [pimaVersionId, mesaVersionId === null ? null : `${MESA.contractId}=${mesaVersionId}`, ...named].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join("|");
}

/**
 * Combine the tenants' promoted projections into the one snapshot the Reader
 * reads and the edge serves. Each sitting keeps its own tenant, publisher and
 * provenance; `pointers` names the promoted version each tenant came from.
 */
export function combineOutcomeProjections(
  pima: { readonly value: OutcomeSnapshot; readonly versionId: string } | null,
  mesa: { readonly value: OutcomeSnapshot; readonly versionId: string } | null,
  doors: readonly DoorOutcomePart[] = [],
): { readonly value: OutcomeSnapshot; readonly versionId: string } | null {
  const versionId = combinedOutcomeVersionId(pima?.versionId ?? null, mesa?.versionId ?? null, doors.flatMap((door) => door.pointers));
  if (versionId === null) return null;
  if (mesa === null && doors.length === 0) return { value: pima!.value, versionId };
  const parts: { readonly value: OutcomeSnapshot }[] = [...(pima ? [pima] : []), ...(mesa ? [mesa] : []), ...doors];
  const stamp = (key: "generatedOn" | "generatedAt") =>
    parts.map(({ value }) => value[key]).filter((stamped) => stamped !== "UNKNOWN").sort().at(-1) ?? "UNKNOWN";
  return {
    versionId,
    value: {
      generatedOn: stamp("generatedOn"),
      generatedAt: stamp("generatedAt"),
      tenants: [...new Set(parts.flatMap(({ value }) => value.tenants))].sort(),
      sittings: parts.flatMap(({ value }) => value.sittings).sort((a, b) => a.meetingId.localeCompare(b.meetingId)),
      pointers: [
        ...(pima ? [{ contractId: PIMA_LEGISTAR_OUTCOMES_CONTRACT.contractId, tenant: "pima", versionId: pima.versionId }] : []),
        ...(mesa ? [{ contractId: MESA.contractId, tenant: MESA.slug, versionId: mesa.versionId }] : []),
        ...doors.flatMap((door) => door.pointers).sort((a, b) => a.contractId.localeCompare(b.contractId)),
      ],
    },
  };
}

/**
 * Prime the outcome projection from a validated EDGE serving artifact, with no
 * database read (C20, 2026-09-24). BOOTSTRAP kind, as the registry's and the
 * curated projections' edge primes are: the serving copy carries the validated
 * value and its version, not the promotion receipt, which stays on the
 * authoritative database path the runner reads.
 *
 * The artifact is either Pima's projection alone (no `pointers`) or the
 * combined Pima + Mesa view (NH332); each tenant's part is validated against
 * its own scope and primed into its own state.
 */
export function primeOutcomeProjection(value: OutcomeSnapshot, versionId: string): void {
  const pointers = value.pointers;
  const pimaPointer = pointers?.find((pointer) => pointer.contractId === PIMA_LEGISTAR_OUTCOMES_CONTRACT.contractId) ?? null;
  const mesaPointer = pointers?.find((pointer) => pointer.contractId === MESA.contractId) ?? null;
  const pimaValue = pointers ? tenantPart(value, "pima", "legistar:pima:") : value;
  const pimaVersion = pointers ? pimaPointer?.versionId ?? null : versionId;
  if (pimaVersion !== null) {
    validateOutcomeProjection(pimaValue, pimaVersion);
    outcomeReadState = {
      kind: "BOOTSTRAP",
      value: pimaValue,
      metadata: edgeMetadata(PIMA_LEGISTAR_OUTCOMES_CONTRACT, pimaVersion),
      detail: `Served from the meeting-outcomes edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
    };
  } else {
    outcomeReadState = {
      kind: "NOT_RECORDED",
      value: null,
      metadata: { ...edgeMetadata(PIMA_LEGISTAR_OUTCOMES_CONTRACT, ""), versionId: null, lastKnownGoodVersionId: null, stale: "UNKNOWN" },
      detail: `The meeting-outcomes edge artifact (version ${versionId}) carries no Pima pointer.`,
    };
  }
  if (mesaPointer !== null) {
    const mesaValue = tenantPart(value, MESA.slug, `legistar-insite:${MESA.slug}:`);
    validateMesaOutcomeProjection(mesaValue, mesaPointer.versionId);
    mesaReadState = {
      kind: "BOOTSTRAP",
      value: mesaValue,
      metadata: edgeMetadata(MESA, mesaPointer.versionId),
      detail: `Served from the meeting-outcomes edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
    };
  } else {
    // The publisher combines every promoted tenant; an artifact without Mesa
    // is one published while Mesa had no promoted pointer.
    mesaReadState = {
      kind: "NOT_RECORDED",
      value: null,
      metadata: { ...edgeMetadata(MESA, ""), versionId: null, lastKnownGoodVersionId: null, stale: "UNKNOWN" },
      detail: `The meeting-outcomes edge artifact (version ${versionId}) carries no Mesa pointer.`,
    };
  }
  edgeDoorPart = doorPartOf(value);
  edgePrimedVersion = versionId;
}

/**
 * **Edge first, database second.** (C20, 2026-09-24.) A reader request that
 * entered the reader authority edge serves the recorded outcomes from its
 * meeting-outcomes artifact without Neon: from the database this read was the
 * pole of a cold Ask, 2.0–2.3 s. The standing runner and the workers never
 * enter an edge, so they read the authoritative pointer as before. An
 * edge-only context (the keep-warm call, C21) refuses instead of reading it.
 * The one edge-first implementation is `settleEdgeFirst` (R24).
 */
export const settleOutcomeRead = (): Promise<void> =>
  settleEdgeFirst(currentMeetingOutcomesEdge, primeOutcomeProjection, refreshOutcomeSnapshotFromPromoted, "The recorded outcomes");

function pimaSnapshot(): OutcomeSnapshot {
  if (outcomeReadState.kind === "PROMOTED" || outcomeReadState.kind === "BOOTSTRAP") return outcomeReadState.value;
  return outcomeReadState.kind === "STORE_UNREACHABLE" && outcomeReadState.code === "READ_NOT_INITIALIZED"
    ? testSeed() ?? EMPTY
    : EMPTY;
}

let combinedMemo: { pima: OutcomeSnapshot; mesa: OutcomeSnapshot | null; doors: readonly OutcomeSnapshot[]; value: OutcomeSnapshot } | null = null;

/** The doors' parts in force: the ones this process read, else what the edge artifact carried. */
function doorPartsInForce(): readonly DoorOutcomePart[] {
  const read = doorOutcomeParts();
  if (read.length > 0) {
    return read.map((part) => ({ value: part.value, pointers: [{ contractId: part.pointer.contractId, tenant: part.pointer.slug, versionId: part.versionId }] }));
  }
  return edgeDoorPart === null ? [] : [edgeDoorPart];
}

/**
 * The snapshot every Reader consumer reads: Pima's projection, plus Mesa's and each door's once they have one. Pima
 * alone is returned as the very object it was read as.
 */
export function getOutcomeSnapshot(): OutcomeSnapshot {
  if (injected !== null) return injected;
  const pima = pimaSnapshot();
  const mesaRead = mesaReadState.kind === "PROMOTED" || mesaReadState.kind === "BOOTSTRAP" ? mesaReadState.value : null;
  const mesa = mesaRead !== null && mesaRead.sittings.length > 0 ? mesaRead : null;
  const doors = doorPartsInForce().filter((part) => part.value.sittings.length > 0);
  if (mesa === null && doors.length === 0) return pima;
  if (combinedMemo?.pima === pima && combinedMemo.mesa === mesa && combinedMemo.doors.length === doors.length &&
      combinedMemo.doors.every((part, at) => part === doors[at].value)) return combinedMemo.value;
  const pimaVersion = outcomeReadState.metadata.versionId;
  const combined = combineOutcomeProjections(
    pima.sittings.length > 0 || pimaVersion ? { value: pima, versionId: pimaVersion ?? "unversioned" } : null,
    mesa === null ? null : { value: mesa, versionId: mesaReadState.metadata.versionId ?? "unversioned" },
    doors,
  )!.value;
  combinedMemo = { pima, mesa, doors: doors.map((part) => part.value), value: combined };
  return combined;
}

/** Drop the process cache. For tests and for a run that has just written. */
export function resetOutcomeSnapshotCache(): void {
  edgePrimedVersion = null;
  outcomeReadState = civicDataReadNotInitialized(
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
    "The Pima Legistar outcome pointer has not been read for this process.",
  );
  mesaReadState = mesaNotInitialized();
  doorReadStates.clear();
  edgeDoorPart = null;
  combinedMemo = null;
}

/** Did a real file back the current snapshot, or is this the empty store? */
export function loadedFrom(): "DATA_PLANE" | "TEST_FIXTURE" | "EMPTY_STORE" {
  if (injected !== null) return injected.sittings.length === 0 && injected.generatedAt === "UNKNOWN" ? "EMPTY_STORE" : "TEST_FIXTURE";
  if (outcomeReadState.kind === "PROMOTED" || mesaReadState.kind === "PROMOTED" || doorOutcomeParts().length > 0) return "DATA_PLANE";
  // An edge-primed state is the promoted data plane's own validated value.
  if ((outcomeReadState.kind === "BOOTSTRAP" || mesaReadState.kind === "BOOTSTRAP") && edgePrimedVersion !== null) return "DATA_PLANE";
  if (outcomeReadState.kind === "BOOTSTRAP" || mesaReadState.kind === "BOOTSTRAP") return "TEST_FIXTURE";
  const snapshot = getOutcomeSnapshot();
  return snapshot.sittings.length === 0 && snapshot.generatedAt === "UNKNOWN"
    ? "EMPTY_STORE"
    : "TEST_FIXTURE";
}

/**
 * The named states this store can be in for one question.
 *
 * Six of them where a naive store has two ("some records" / "no records"), and
 * every extra one is a distinction the constitution requires be visible.
 */
export type OutcomeEvidenceState =
  | "HELD"
  | "NO_SITTING_HELD"
  | "NOT_YET_INGESTED"
  | "EXTRACTION_FAILED"
  | "NO_ACTION_RECORDED"
  | "ACTION_WITHOUT_ROLL_CALL"
  /**
   * The sitting concluded and its publisher has not published minutes for it
   * yet (NH332). THEIRS, and never "no decision": the decisions exist and are
   * not yet in the public record we read.
   */
  | "MINUTES_NOT_YET_PUBLISHED";

/**
 * **The states that are facts about a GOVERNMENT, as data rather than prose.**
 *
 * The table at the top of this file already said which two these are. A table
 * is not readable by a consumer, so the consumer restates the mapping — and a
 * restated mapping is one edit away from calling `NOT_YET_INGESTED` a fact
 * about a clerk, which is the precise defect repaired across this codebase on
 * 2026-08-29.
 *
 * Both members are earned by MEASUREMENT of the publisher's own records: the
 * ingest succeeded, the sitting's items were read, and the publisher recorded
 * no action (or recorded one and published no per-person roll). Everything
 * else in the union is a fact about us.
 */
export const OUTCOME_STATES_ABOUT_THEM: readonly OutcomeEvidenceState[] = [
  "NO_ACTION_RECORDED",
  "ACTION_WITHOUT_ROLL_CALL",
  // Read off the publisher's own minutes cell ("Not available"), with the instant it was read.
  "MINUTES_NOT_YET_PUBLISHED",
];

/**
 * A sitting the InSite minutes route wrote (its id is the portal's, as only
 * that route writes into this store): its records come from minutes, never an
 * agenda, and its tabulations are text, never a per-person roll.
 */
export function isMinutesRouteSitting(sitting: Pick<PersistedSittingOutcomes, "meetingId">): boolean {
  return sitting.meetingId.startsWith("legistar-insite:");
}

/** Whose gap a state names. Derived from the list above, never restated. */
export function outcomeGapWhose(state: OutcomeEvidenceState): "OURS" | "THEIRS" {
  return OUTCOME_STATES_ABOUT_THEM.includes(state) ? "THEIRS" : "OURS";
}

export interface OutcomeQuery {
  /** `ocd-division/...#governing`. Exact string equality, never a name match. */
  readonly bodyId?: string | null;
  /** `legistar:pima:1825`. Narrows to one sitting when the caller has it. */
  readonly meetingId?: string | null;
  /** Which question is being asked. Drives the record-class filter. */
  readonly questionClass: QuestionClass;
  /** ISO instant. Only sittings at or before it — "the last meeting". */
  readonly onOrBefore?: string | null;
  /** How many sittings back to consider. Default 1: the most recent. */
  readonly sittings?: number;
}

/**
 * Any record class this store holds.
 *
 * The union is discriminated by `recordClass`, which is the same field
 * `evidenceRecordsFor` filters on — so narrowing in a consumer and admission in
 * the filter are decided by one field rather than by two that could drift.
 */
export type OutcomeEvidenceRecord =
  | LegistarAgendaRecord
  | LegistarOutcomeRecord
  | LegistarRollCallRecord;

/** A record that was held and refused, with the sentence saying why. */
export interface RefusedRecord {
  readonly recordClass: RecordClass | string;
  readonly reason: string;
  readonly count: number;
}

export interface OutcomeEvidence {
  readonly state: OutcomeEvidenceState;
  /** True only for `HELD`. Derived, never asserted by a caller. */
  readonly answerable: boolean;
  /**
   * The records that ANSWER the question asked, already class-filtered.
   * Empty on every non-`HELD` state.
   *
   * Typed as the concrete union rather than as `ClassedRecord`, so a consumer
   * reads `tallyText` or `votes` off a narrowed record instead of casting. A
   * cast at this boundary would be the one place the class filter could be
   * undone by a caller in a hurry.
   */
  readonly records: readonly OutcomeEvidenceRecord[];
  /** The sittings consulted, newest first. Present on every state but the first. */
  readonly sittings: readonly PersistedSittingOutcomes[];
  /**
   * Classes we held and could not use. Carried so a caller can say *"we hold 135
   * agenda records and no outcome record"* rather than quietly answering from
   * the agendas — the failure `lib/ask/outcome-question.ts` was written for.
   */
  readonly refused: readonly RefusedRecord[];
  /**
   * The named gap, or null when `state` is `HELD`.
   *
   * Always says whose gap it is. `lib/ask/` owns the reader's wording; this is
   * the honest statement the wording must not contradict.
   */
  readonly gap: string | null;
  /**
   * Retrieval failures that are still OPEN — a failed extraction or a votes
   * request that threw. Never converted into an absence, and surfaced so a
   * refresh can retry them.
   */
  readonly openFailures: readonly string[];
}

/** Sittings for one body, newest first, honouring the query's window. */
function selectSittings(
  query: OutcomeQuery,
  snapshot: OutcomeSnapshot,
): PersistedSittingOutcomes[] {
  const wanted = snapshot.sittings.filter((sitting) => {
    if (query.meetingId && sitting.meetingId !== query.meetingId) return false;
    if (query.bodyId && sitting.bodyId !== query.bodyId) return false;
    if (query.onOrBefore && sitting.startsAt !== null) {
      if (sitting.startsAt > query.onOrBefore) return false;
    }
    return true;
  });

  wanted.sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
  const limit = query.meetingId ? wanted.length : Math.max(1, query.sittings ?? 1);
  return wanted.slice(0, limit);
}

/**
 * **THE HANDOFF. Outcome evidence for one question about one body.**
 *
 * Pure over the committed store: no network, no clock, no database. Everything
 * it returns is either a persisted record or a state derived from persisted
 * records, so the same query gives the same answer for a given store — which is
 * what makes it testable against a fixture and what makes a wrong answer
 * attributable to data rather than to timing.
 *
 * The class filter runs through `evidenceRecordsFor`, so AGENDA records are not
 * merely deprioritised for `WHAT_WAS_DECIDED` — they are absent from `records`
 * and present in `refused` with the sentence explaining the refusal.
 */
export function outcomeEvidenceFor(
  query: OutcomeQuery,
): OutcomeEvidence {
  const snapshot = getOutcomeSnapshot();
  const sittings = selectSittings(query, snapshot);

  if (sittings.length === 0) {
    return {
      state: "NO_SITTING_HELD",
      answerable: false,
      records: [],
      sittings: [],
      refused: [],
      gap:
        "We hold no sitting of that body in the outcome store, so we have not " +
        "recorded what it decided. That is a gap in what we have collected and " +
        "not a statement about what the body has published.",
      openFailures: [],
    };
  }

  /*
   * Minutes not yet published is the publisher's state, not a failure of
   * ours, and it is never "no decision" (NH332). Named before the failure
   * checks so it cannot be read as a failed extraction or as an empty sitting.
   */
  if (sittings.every((sitting) => sitting.extraction === "NOT_YET_PUBLISHED")) {
    return {
      state: "MINUTES_NOT_YET_PUBLISHED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        sittings[0]!.extractionNote ??
        "The body has not published minutes for that sitting yet, so its decisions are not yet in " +
          "the public record we read. That is not a record that nothing was decided.",
      openFailures: [],
    };
  }

  const openFailures: string[] = [];
  for (const sitting of sittings) {
    if (sitting.extraction !== "RETRIEVED" && sitting.extraction !== "NOT_YET_PUBLISHED") {
      openFailures.push(
        `${sitting.meetingId}: ${sitting.extraction} — ${sitting.extractionNote ?? "no reason recorded"}`,
      );
    }
    for (const failure of sitting.voteRequestFailures) {
      openFailures.push(
        `${sitting.meetingId} item ${failure.eventItemId}: votes request failed — ${failure.reason}`,
      );
    }
    for (const itemId of sitting.failedRollCallExtractions) {
      openFailures.push(
        `${sitting.meetingId} item ${itemId}: the item's own record asserts a roll call ` +
          "and the votes route returned zero rows — a FAILED extraction, not an empty roll",
      );
    }
  }

  /*
   * A zero-row extraction is a FAILED extraction, never an empty document
   * (RULING 100). Checked BEFORE the record counts, because a failed sitting
   * has zero outcome records and would otherwise be indistinguishable from a
   * sitting where the body genuinely acted on nothing.
   */
  const allFailed = sittings.every((s) => s.extraction !== "RETRIEVED" && s.extraction !== "NOT_YET_PUBLISHED");
  if (allFailed) {
    return {
      state: "EXTRACTION_FAILED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      /*
       * A minutes read held as a failed extraction (2026-09-25) is ours in its
       * own words: the minutes were read and we could not find the decisions in
       * them, and they are read again when the document or our reading changes.
       */
      gap: sittings.every((s) => isMinutesRouteSitting(s) && s.failedMinutesRead !== undefined)
        ? "We read that sitting's minutes and could not find in them what was decided. That is a " +
          "failed reading on our side, not a meeting where nothing was decided. We read the minutes " +
          "again when the document changes or our reading of it improves."
        : "Our retrieval of that sitting's agenda items returned nothing, which is a " +
          "failed retrieval on our side and not a meeting with nothing on it. It is " +
          "retryable and it has not been retried yet.",
      openFailures,
    };
  }

  /*
   * Typed as the concrete union so `evidenceRecordsFor`'s generic carries it
   * through to `admitted`. Widening to `ClassedRecord` here would erase the
   * fields at exactly the point the consumer needs them.
   */
  const held: OutcomeEvidenceRecord[] = [];
  for (const sitting of sittings) {
    held.push(...sitting.agenda, ...sitting.outcomes, ...sitting.rollCalls);
  }

  /*
   * Minutes read, and they record no motion because — in their own words — no
   * formal action was taken (a study or strategic planning session). That is a
   * fact about the body, read off its record; any other empty minutes read
   * reaches this store only as a held failed extraction (`ZERO_ROWS_FAILED`),
   * answered above, never as RETRIEVED.
   */
  if (
    held.length === 0 &&
    sittings.some((s) => s.extraction === "RETRIEVED" && isMinutesRouteSitting(s)) &&
    sittings.every((s) => !isMinutesRouteSitting(s) || s.extraction !== "RETRIEVED" || s.outcomes.length === 0)
  ) {
    return {
      state: "NO_ACTION_RECORDED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "We read that sitting's minutes. They record no motion or vote, and say that no formal action " +
        "was taken. That is what the body's own record says, not a gap in our retrieval of it.",
      openFailures,
    };
  }

  if (held.length === 0) {
    return {
      state: "NOT_YET_INGESTED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "We hold that sitting but have not recorded any of its agenda, actions or " +
        "roll calls yet. That is a gap in our collection.",
      openFailures,
    };
  }

  const { admitted, refused } = evidenceRecordsFor(query.questionClass, held);

  const refusedSummary: RefusedRecord[] = [];
  const ruling = ruleOnQuestion(
    query.questionClass,
    [...new Set(refused.map((r) => r.record.recordClass))],
  );
  for (const substitution of ruling.refusedSubstitutions) {
    refusedSummary.push({
      recordClass: substitution.held,
      reason: substitution.reason,
      count: refused.filter((r) => r.record.recordClass === substitution.held).length,
    });
  }

  if (admitted.length > 0) {
    return {
      state: "HELD",
      answerable: true,
      records: admitted,
      sittings,
      refused: refusedSummary,
      gap: null,
      openFailures,
    };
  }

  /*
   * Nothing admitted, and the extraction SUCCEEDED. So this is a fact about the
   * publisher, and the two publisher-facts are not the same fact.
   *
   * A body that acted and whose clerk recorded no per-person roll is a real,
   * documented decision with no roll call — 108 acted Pima items in four
   * months. Reporting that as "no records" would describe a decision that
   * demonstrably happened as an absence, which is the exact inversion of the
   * transparency mandate.
   */
  const anyOutcome = sittings.some((s) => s.outcomes.length > 0);
  /*
   * Minutes that list the ayes and nays by surname are NOT a record without a
   * roll call (NH332). We carry that tabulation as text and have not turned it
   * into per-member records, which is OUR gap — never "the body did not record
   * how its members voted".
   */
  if (
    anyOutcome &&
    query.questionClass === "HOW_DID_THEY_VOTE" &&
    sittings.every((s) => isMinutesRouteSitting(s)) &&
    sittings.some((s) => s.outcomes.some((record) => record.tallyText !== null))
  ) {
    return {
      state: "NOT_YET_INGESTED",
      answerable: false,
      records: [],
      sittings,
      refused: refusedSummary,
      gap:
        "The body's minutes for this sitting list how its members voted, by surname, and we carry " +
        "that tabulation only as the clerk's text. We have not turned it into per-member vote " +
        "records yet. That is a gap in our collection, not in the body's record.",
      openFailures,
    };
  }
  if (anyOutcome && query.questionClass === "HOW_DID_THEY_VOTE") {
    return {
      state: "ACTION_WITHOUT_ROLL_CALL",
      answerable: false,
      records: [],
      sittings,
      refused: refusedSummary,
      gap:
        "That body's own record of this sitting states the actions it took and does " +
        "not record how each member voted on them. The action is published; a " +
        "per-person roll call for it is not.",
      openFailures,
    };
  }

  return {
    state: "NO_ACTION_RECORDED",
    answerable: false,
    records: [],
    sittings,
    refused: refusedSummary,
    gap:
      "We read that sitting's agenda items and the body's own record shows no action " +
      "recorded against them. That is what the publisher's record says, not a gap in " +
      "our retrieval of it.",
    openFailures,
  };
}

/**
 * Sittings held for one body, newest first. For coverage reporting.
 *
 * Separate from {@link outcomeEvidenceFor} because a coverage question — *how
 * many of this body's sittings can we answer an outcome question about* — is not
 * a reader question and must not be answered through a reader accessor that
 * filters by record class.
 */
export function sittingsForBody(
  bodyId: string,
): readonly PersistedSittingOutcomes[] {
  return getOutcomeSnapshot()
    .sittings.filter((sitting) => sitting.bodyId === bodyId)
    .sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
}

/**
 * **THE SECOND HANDOFF — what the publisher said about one sitting's agenda.**
 *
 * Every reading held for that sitting, reconciled without a winner being
 * picked. The observations satisfy `PublisherAgendaObservation` in
 * `lib/ask/agenda-publication.ts` field for field, so the integration owner can
 * pass `reconciled.observations` straight to `classifyAgendaPublication`.
 *
 * **`actionable` is null on a DISAGREE**, and a caller must not fall back to
 * "whichever one is there" when it is. Two of this publisher's own surfaces
 * saying different things is a real state with a real cause — the Web API omits
 * sittings whose detail page is not publicly viewable, and a document published
 * between two reads lands on one surface first — and a caller that resolves it
 * by preference has converted a known uncertainty into a confident sentence.
 */
export function publicationObservationsFor(
  meetingId: string,
): ReconciledPublication {
  const sitting = getOutcomeSnapshot().sittings.find(
    (row) => row.meetingId === meetingId,
  );
  return reconcilePublicationObservations(
    meetingId,
    sitting?.publicationObservations ?? [],
  );
}

/** Every meeting id the store holds outcome records for. */
export function answerableMeetingIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const sitting of getOutcomeSnapshot().sittings) {
    if (sitting.extraction === "RETRIEVED" && sitting.outcomes.length > 0) {
      ids.add(sitting.meetingId);
    }
  }
  return ids;
}
