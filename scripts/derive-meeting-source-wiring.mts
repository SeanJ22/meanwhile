/**
 * **THE MEETING-SOURCE WIRING, RECOMPUTED BY THE STANDING RUNNER FROM WHAT IS
 * ALREADY PROMOTED OR VAULTED.** (C16, 2026-09-24. RULING 282/283: the one door.)
 *
 *   node --experimental-strip-types scripts/derive-meeting-source-wiring.mts --promote
 *
 * The standing runner's child for the `meeting-source-wiring` routine contract.
 * It fetches nothing from any publisher. It reads:
 *
 * - the promoted wiring version it succeeds (its rows, suspensions and all);
 * - the promoted meeting-body crosswalk: the reviewed rows connecting a calendar
 *   to its exact body (`lib/civic-data/meeting-body-crosswalk.ts`), composed
 *   with the rows the runner's own reviewer accepted
 *   (`lib/civic-data/derived-crosswalk.ts`), the reviewed rows winning;
 * - each covered state's promoted registration: which division a government is;
 * - the discovery walk's newest attempt for each crosswalked government, from
 *   the control plane's attempt log (read only);
 * - the evidence vault, read only (`lib/control-plane/evidence/read-only-vault.ts`):
 *   the calendar bytes a walk confirmed, and the page naming each body;
 * - the venue resolutions the reader adapters resolve each sitting through, read
 *   before any adapter reading (`lib/control-plane/discovery/derived-wiring-reading.ts`).
 *
 * Each row is decided by `deriveWiringDecisions` (the four review triggers, and
 * every outage held as it is), planned by `planDerivedVersion`, and promoted
 * through `processRegisteredRoutineCandidate`, whose door checks every
 * promoted input against the store. Anything it cannot read refuses the
 * candidate by name and leaves the last known good wiring live.
 */
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import {
  DERIVED_CROSSWALK_RECORD_CLASS,
  DERIVED_CROSSWALK_SCOPE,
  composeCrosswalk,
  readDerivedMeetingBodyCrosswalk,
} from "../lib/civic-data/derived-crosswalk.ts";
import { planDerivedVersion, promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  DERIVED_WIRING_SOURCE_NAMES,
  derivedWiringCandidate,
  derivedWiringEntries,
  derivedWiringFailedCandidate,
  readDerivedMeetingWiring,
  type DerivedWiringKind,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { promoteDerivedCandidate } from "../lib/civic-data/derived-child-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { deriveWiringDecisions, sameRoute, wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import { readHeldCalendars, type HeldCalendarReading } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import { crosswalkEvidenceWorkItem, indexVault, readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { digestValueClosure } from "../lib/ops/generator-digest.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

const CONTRACT_ID = "meeting-source-wiring";

if (!process.argv.includes("--promote")) {
  throw new Error("usage: scripts/derive-meeting-source-wiring.mts --promote (the standing runner's child; there is no dry mode against production)");
}
installNeonRequestDeadline();
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();

async function finish(candidate: RoutineCandidate): Promise<void> {
  // An unchanged wiring re-check is receipted on the pointed version instead of
  // re-promoted (R23); the receipt then names that version, never the unwritten
  // re-check candidate.
  await promoteDerivedCandidate(store, CONTRACT_ID, candidate, now);
}

const stateOf = (ocdId: string): string | null => /\/state:([a-z]{2})(\/|$)/.exec(ocdId)?.[1]?.toUpperCase() ?? null;
const ADAPTER_ENTRY: Readonly<Record<DerivedWiringKind, string>> = {
  ICAL: "lib/sources/ical/index.ts",
  OFFICIAL_PAGE_EVENTS: "lib/sources/official-page-events/index.ts",
};
const digests = new Map<DerivedWiringKind, string>();
const adapterDigest = (kind: DerivedWiringKind): string => {
  const known = digests.get(kind);
  if (known) return known;
  const digest = `${DERIVED_WIRING_SOURCE_NAMES[kind]}@${digestValueClosure(process.cwd(), ADAPTER_ENTRY[kind]).digest.slice(0, 12)}`;
  digests.set(kind, digest);
  return digest;
};

/** The held bytes as text, or why they could not be read: the adapter reading refuses an unreadable body by name. */
async function heldText(held: HeldVaultArtifact): Promise<HeldCalendarReading["held"]> {
  try {
    return { text: new TextDecoder().decode(await readHeldBytes(held)), contentType: held.contentType };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const lkg = await readDerivedMeetingWiring({ store, bypassCache: true, now });
  if (lkg.kind === "STORE_UNREACHABLE") {
    await finish(derivedWiringFailedCandidate(now, `The previous wiring version could not be read (${lkg.code}): ${lkg.detail}`));
    return;
  }
  const previous = lkg.kind === "PROMOTED" ? derivedWiringEntries(lkg.value) : [];
  const lkgInput = lkg.kind === "PROMOTED"
    ? promotedInputRef("CURATED_READER_RECORD", "US:meeting-source-wiring", lkg.metadata.versionId, lkg.value, lkg.metadata.promotedAt)
    : null;

  /*
   * Two crosswalks, composed (C16 option A, 2026-09-25): the reviewed manual one and the rows the runner's own
   * reviewer accepted (meeting-body-crosswalk-derived). A reviewed row wins over an automatic one for the same body,
   * and either alone connects calendars. An unreadable one refuses the pass; neither promoted is no connection yet.
   */
  const crosswalkContract = requiredManualProductionContract("meeting-body-crosswalk");
  const crosswalk = await readCuratedReaderProjection("meeting-body-crosswalk", { store, bypassCache: true, now });
  const automaticRead = await readDerivedMeetingBodyCrosswalk({ store, bypassCache: true, now });
  for (const read of [crosswalk, automaticRead]) {
    if (read.kind !== "PROMOTED" && read.kind !== "NOT_RECORDED") {
      await finish(derivedWiringFailedCandidate(now, `A meeting-body crosswalk could not be read (${read.kind}): ${"detail" in read ? read.detail : ""}`));
      return;
    }
  }
  if (crosswalk.kind !== "PROMOTED" && automaticRead.kind !== "PROMOTED") {
    await finish(derivedWiringFailedCandidate(now, "No reviewed or automatic meeting-body crosswalk is promoted yet, so no calendar is connected to a body."));
    return;
  }
  const manualInput = crosswalk.kind === "PROMOTED"
    ? promotedInputRef(crosswalkContract.recordClass, crosswalkContract.scope, crosswalk.metadata.versionId, crosswalk.value, crosswalk.metadata.promotedAt)
    : null;
  const automaticInput = automaticRead.kind === "PROMOTED"
    ? promotedInputRef(DERIVED_CROSSWALK_RECORD_CLASS, DERIVED_CROSSWALK_SCOPE, automaticRead.metadata.versionId, automaticRead.value, automaticRead.metadata.promotedAt)
    : null;
  if ((crosswalk.kind === "PROMOTED" && manualInput === null) || (automaticRead.kind === "PROMOTED" && automaticInput === null)) {
    await finish(derivedWiringFailedCandidate(now, "A promoted crosswalk carries no version id or promotion time."));
    return;
  }
  const composed = composeCrosswalk(
    crosswalk.kind === "PROMOTED" ? crosswalk.value.records as unknown as MeetingBodyCrosswalkRow[] : null,
    automaticRead.kind === "PROMOTED" ? automaticRead.value.records : null,
  );
  for (const s of composed.shadowed) console.log(`  automatic row ${s.id} not used: ${s.why}`);
  const crosswalkInput = (manualInput ?? automaticInput)!;
  const automatic = automaticInput === null
    ? undefined
    : { input: automaticInput, versionId: automaticRead.metadata.versionId ?? "", rowIds: composed.automaticIds };
  const rows = composed.rows.filter((row) => crosswalkRowIssue(row) === null);

  /* Registration: which division each crosswalked government is, per covered state. */
  const registrations = new Map<string, { readonly input: DerivedInputRef; readonly bodies: readonly { id: string; ocdId: string; jurisdictionId: string | null }[] } | { readonly unread: string }>();
  for (const state of new Set(rows.map((row) => stateOf(row.ocdId)).filter((s): s is string => s !== null))) {
    const read = await readRegistrationProjection(state, { store, bypassCache: true, now });
    const input = read.kind === "PROMOTED" ? promotedInputRef("REGISTRATION", read.metadata.scope, read.metadata.versionId, read.value, read.metadata.promotedAt) : null;
    registrations.set(state, read.kind === "PROMOTED" && input !== null
      ? { input, bodies: read.value.bodies.map((b) => ({ id: b.id, ocdId: b.ocdId, jurisdictionId: b.jurisdictionId })) }
      : { unread: `${state} registration is ${read.kind}` });
  }

  /* The newest walk of each crosswalked government, read only. */
  const controlPlane = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!controlPlane) {
    await finish(derivedWiringFailedCandidate(now, "The control plane's attempt log is not configured (WTP_CONTROL_PLANE_DATABASE_URL), so no walk can be read."));
    return;
  }
  const jurisdictions = [...new Set(rows.map((row) => row.jurisdictionId))];
  let attempts: { attempt: MeetingsDiscoveryAttempt; recordId: string; recordedAt: string }[];
  try {
    const sql = neon(controlPlane);
    const found = jurisdictions.length === 0 ? [] : await sql.query(
      "SELECT DISTINCT ON (log_key) log_key AS id, position, record AS value FROM cp_log_discovery_attempts WHERE log_key = ANY($1::text[]) ORDER BY log_key, record->>'startedAt' DESC, position DESC",
      [jurisdictions],
    ) as { id: string; position: number | string; value: MeetingsDiscoveryAttempt }[];
    attempts = found.map((row) => ({ attempt: row.value, recordId: String(row.position), recordedAt: row.value.finishedAt }));
  } catch (error) {
    await finish(derivedWiringFailedCandidate(now, `The discovery-attempt log could not be read: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  /* The vault, read only, and the adapter's reading of every held route byte the walks cite. */
  const vault = await indexVault(join(process.cwd(), "data", "control-plane", "vault"));
  const refOf = (held: HeldVaultArtifact | undefined) =>
    held === undefined || held.tier === "RESTRICTED_RAW"
      ? null
      : ({ kind: "VAULTED_EVIDENCE" as const, artifactId: held.id, contentHash: held.contentHash, tier: held.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" as const : "RAW" as const, retrievedAt: held.retrievedAt ?? now });
  const pending: HeldCalendarReading[] = [];
  for (const reviewed of rows.filter((row) => row.status === "ACTIVE")) {
    const walk = attempts.find((a) => a.attempt.jurisdictionId === reviewed.jurisdictionId)?.attempt;
    if (walk === undefined) continue;
    const others = rows.filter((r) => r.jurisdictionId === reviewed.jurisdictionId && r.bodyId !== reviewed.bodyId && r.status === "ACTIVE").map((r) => r.bodyName);
    const cited = [
      ...walk.found.filter((f) => sameRoute(f.url, reviewed.route)).map((f) => f.artifactId),
      ...walk.steps.filter((s) => sameRoute(s.url, reviewed.route)).map((s) => s.artifactId),
    ].filter((id): id is string => id !== null);
    for (const artifactId of new Set(cited)) {
      const held = vault.byId.get(artifactId);
      const evidence = refOf(held);
      if (held === undefined || evidence === null) continue;
      pending.push({ key: `${reviewed.id}\u0000${artifactId}`, row: wiringRowFor(reviewed), held: await heldText(held), evidence, others });
    }
  }
  /* The Reader projections the adapters resolve through are read before any reading; an unreadable one refuses the pass. */
  const read = await readHeldCalendars({ options: { store, bypassCache: true, now }, now, adapterDigest, readings: pending });
  if (read.kind === "UNREADABLE") {
    await finish(derivedWiringFailedCandidate(now, read.detail));
    return;
  }
  const readings = read.verifications;

  const decisions = deriveWiringDecisions({
    crosswalk: {
      input: crosswalkInput,
      versionId: (crosswalk.kind === "PROMOTED" ? crosswalk.metadata.versionId : automaticRead.metadata.versionId) ?? "",
      rows,
      ...(automatic === undefined ? {} : { automatic }),
    },
    registration: (row) => {
      const state = stateOf(row.ocdId);
      const reg = state === null ? undefined : registrations.get(state);
      if (reg === undefined || "unread" in reg) return { notRegistered: reg !== undefined && "unread" in reg ? reg.unread : `no covered state in ${row.ocdId}` };
      const body = reg.bodies.find((b) => b.jurisdictionId === row.jurisdictionId);
      if (body === undefined) return { notRegistered: `registration pairs ${row.jurisdictionId} with no body` };
      if (body.ocdId !== row.ocdId) return { notRegistered: `registration pairs ${row.jurisdictionId} with ${body.ocdId}, not ${row.ocdId}` };
      if (row.bodyRole !== "SUB_BODY" && body.id !== row.bodyId) return { notRegistered: `registration's body is ${body.id}, not ${row.bodyId}` };
      return { input: reg.input };
    },
    attempts,
    handWired: (bodyId) => SOURCE_WIRING.some((wiring) => wiring.bodyId === bodyId),
    vaulted: (artifactId) => refOf(vault.byId.get(artifactId)),
    /* A credential-bearing page is held as its sanitized derivative, filed under the raw page's sha256 (vault-crosswalk-evidence). */
    vaultedBytes: (hex) => refOf(vault.byHash.get(hex)) ??
      refOf(vault.byWorkItem.get(crosswalkEvidenceWorkItem(hex))?.find((held) => held.tier === "SANITIZED_DERIVED")),
    verify: (row, _binding, evidence) =>
      readings.get(`${row.crosswalkRowId}\u0000${evidence.artifactId}`) ?? { refused: `no adapter reading of ${evidence.artifactId} was made this pass` },
    adapterDigest,
    previous,
    now,
  });
  const plan = planDerivedVersion(previous, decisions);
  for (const d of decisions) {
    console.log(`  ${d.key}: ${d.disposition === "HOLD" ? `HOLD ${d.reason}: ${d.detail}` : d.disposition === "SUSPEND" ? `SUSPEND ${d.trigger}: ${d.detail}` : d.disposition}`);
  }
  for (const r of plan.refusals) console.error(`  refused ${r.key}: ${r.code}: ${r.detail}`);
  console.log(floorLine(floored(
    "derived wiring rows promoted",
    "the calendar-to-body rows decided this pass",
    decisions.length,
    decisions.filter((d) => d.disposition === "PROMOTE").length,
    decisions.length === 0 ? "no calendar-to-body row reached the derive this pass" : undefined,
  )));
  await finish(derivedWiringCandidate(plan, [...new Set([manualInput, automaticInput, lkgInput])].filter((i): i is DerivedInputRef => i !== null), now));
}

await main();
