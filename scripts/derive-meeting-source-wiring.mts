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
 *   to its exact body (`lib/civic-data/meeting-body-crosswalk.ts`);
 * - each covered state's promoted registration: which division a government is;
 * - the discovery walk's newest attempt for each crosswalked government, from
 *   the control plane's attempt log (read only);
 * - the evidence vault, read only (`lib/control-plane/evidence/read-only-vault.ts`):
 *   the calendar bytes a walk confirmed, and the page naming each body.
 *
 * Each row is decided by `deriveWiringDecisions` (the four review triggers, and
 * every outage held as it is), planned by `planDerivedVersion`, and promoted
 * through `processRegisteredRoutineCandidate`, whose door checks every
 * promoted input against the store. Anything it cannot read refuses the
 * candidate by name and leaves the last known good wiring live.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { planDerivedVersion, type AdapterVerification, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  bodySourceWiringFor,
  DERIVED_WIRING_SOURCE_NAMES,
  derivedWiringCandidate,
  derivedWiringEntries,
  derivedWiringFailedCandidate,
  readDerivedMeetingWiring,
  type DerivedWiringKind,
  type DerivedWiringRow,
} from "../lib/civic-data/derived-meeting-wiring.ts";
import { crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import {
  deriveWiringDecisions,
  sameRoute,
  wiringRowFor,
  type WiringVerification,
} from "../lib/control-plane/discovery/derived-wiring.ts";
import { crosswalkEvidenceWorkItem, indexVault, readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { digestValueClosure } from "../lib/ops/generator-digest.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { CONCLUDED_LOOKBACK_DAYS, UPCOMING_HORIZON_DAYS } from "../lib/meetings/constants.ts";
import { makeIcalSource, parseIcs } from "../lib/sources/ical/index.ts";
import { makeOfficialPageEventsSource } from "../lib/sources/official-page-events/index.ts";
import type { Meeting } from "../lib/sources/types.ts";

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
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

async function finish(candidate: RoutineCandidate): Promise<void> {
  const outcome = await processRegisteredRoutineCandidate(store, CONTRACT_ID, candidate, now);
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: CONTRACT_ID,
    candidateId: candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  if (!outcome.promoted) process.exitCode = 2;
}

function promotedInput(recordClass: string, scope: string, versionId: string | null, value: unknown, promotedAt: string | null): DerivedInputRef | null {
  return versionId === null || promotedAt === null
    ? null
    : { kind: "PROMOTED_VERSION", recordClass, scope, versionId, readModelSha256: sha256(canonicalCivicDataJson(value)), promotedAt };
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

/**
 * The reader adapter's own reading of held bytes with the row's reviewed filter: the same adapter the family runs,
 * served the vaulted bytes for its route and nothing else.
 */
async function readWithAdapter(row: DerivedWiringRow, held: HeldVaultArtifact, others: readonly string[]): Promise<WiringVerification> {
  let text: string;
  try {
    text = new TextDecoder().decode(await readHeldBytes(held));
  } catch (error) {
    return { refused: `the vaulted bytes could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return sameRoute(url, row.route)
      ? new Response(text, { status: 200, headers: { "content-type": held.contentType || "text/html" } })
      : new Response("not held in the vault", { status: 404 });
  }) as typeof fetch;
  let total = 0;
  if (row.kind === "ICAL") {
    if (!/BEGIN:VCALENDAR/i.test(text)) return { changed: `${row.route} no longer reads as an iCal calendar` };
    total = parseIcs(text).length;
    if (total === 0) return { refused: `${row.route} holds no event in this read` };
  }
  let meetings: readonly Meeting[] = [];
  try {
    const wiring = bodySourceWiringFor(row);
    const source = row.kind === "ICAL" ? makeIcalSource([wiring], fetchImpl) : makeOfficialPageEventsSource([wiring], fetchImpl);
    const nowMs = Date.parse(now);
    const raw = await source.fetch({
      lat: 39.5, lng: -98.35, radiusKm: 5000,
      startsAfter: new Date(nowMs - CONCLUDED_LOOKBACK_DAYS * 86_400_000).toISOString(),
      startsBefore: new Date(nowMs + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString(),
    });
    meetings = source.normalizeWithDrops(raw as never[], new Date(nowMs)).meetings;
  } catch (error) {
    /* A read that yields nothing the filter selects is a changed calendar; anything else is ours to fix. */
    const detail = error instanceof Error ? error.message : String(error);
    return total > 0 || row.kind === "OFFICIAL_PAGE_EVENTS"
      ? { changed: `the reviewed filter selects none of ${row.route}'s ${total > 0 ? `${total} ` : ""}event(s): ${detail}` }
      : { refused: detail };
  }
  const own = meetings.filter((m) => m.bodyId === row.bodyId);
  if (own.length === 0) return { changed: `the reviewed filter selects none of ${row.route}'s ${total > 0 ? `${total} ` : ""}event(s)` };
  const name = row.bodyName.toLowerCase();
  const foreign = own.find((m) => !m.title.toLowerCase().includes(name) && others.some((o) => m.title.toLowerCase().includes(o.toLowerCase())));
  if (foreign !== undefined) {
    return { wrongAttribution: `"${foreign.title}" (${foreign.startsAt}) names another reviewed body of ${row.jurisdictionId}, not ${row.bodyName}` };
  }
  const verified: AdapterVerification = {
    adapter: DERIVED_WIRING_SOURCE_NAMES[row.kind],
    closureDigest: adapterDigest(row.kind),
    verifiedAt: now,
    sittings: own.length,
    evidence: { kind: "VAULTED_EVIDENCE", artifactId: held.id, contentHash: held.contentHash, tier: held.tier === "SANITIZED_DERIVED" ? "SANITIZED_DERIVED" : "RAW", retrievedAt: held.retrievedAt ?? now },
  };
  return { verified, selected: own.map((m) => `${m.startsAt}|${m.title}`) };
}

async function main(): Promise<void> {
  const lkg = await readDerivedMeetingWiring({ store, bypassCache: true, now });
  if (lkg.kind === "STORE_UNREACHABLE") {
    await finish(derivedWiringFailedCandidate(now, `The previous wiring version could not be read (${lkg.code}): ${lkg.detail}`));
    return;
  }
  const previous = lkg.kind === "PROMOTED" ? derivedWiringEntries(lkg.value) : [];
  const lkgInput = lkg.kind === "PROMOTED"
    ? promotedInput("CURATED_READER_RECORD", "US:meeting-source-wiring", lkg.metadata.versionId, lkg.value, lkg.metadata.promotedAt)
    : null;

  const crosswalkContract = requiredManualProductionContract("meeting-body-crosswalk");
  const crosswalk = await readCuratedReaderProjection("meeting-body-crosswalk", { store, bypassCache: true, now });
  if (crosswalk.kind !== "PROMOTED") {
    await finish(derivedWiringFailedCandidate(now, crosswalk.kind === "NOT_RECORDED"
      ? "No reviewed meeting-body crosswalk is promoted yet, so no calendar is connected to a body."
      : `The meeting-body crosswalk could not be read (${crosswalk.kind}): ${"detail" in crosswalk ? crosswalk.detail : ""}`));
    return;
  }
  const crosswalkInput = promotedInput(crosswalkContract.recordClass, crosswalkContract.scope, crosswalk.metadata.versionId, crosswalk.value, crosswalk.metadata.promotedAt);
  if (crosswalkInput === null) {
    await finish(derivedWiringFailedCandidate(now, "The promoted crosswalk carries no version id or promotion time."));
    return;
  }
  const rows = (crosswalk.value.records as unknown as MeetingBodyCrosswalkRow[]).filter((row) => crosswalkRowIssue(row) === null);

  /* Registration: which division each crosswalked government is, per covered state. */
  const registrations = new Map<string, { readonly input: DerivedInputRef; readonly bodies: readonly { id: string; ocdId: string; jurisdictionId: string | null }[] } | { readonly unread: string }>();
  for (const state of new Set(rows.map((row) => stateOf(row.ocdId)).filter((s): s is string => s !== null))) {
    const read = await readRegistrationProjection(state, { store, bypassCache: true, now });
    const input = read.kind === "PROMOTED" ? promotedInput("REGISTRATION", read.metadata.scope, read.metadata.versionId, read.value, read.metadata.promotedAt) : null;
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
  const readings = new Map<string, WiringVerification>();
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
      if (held === undefined || held.tier === "RESTRICTED_RAW") continue;
      readings.set(`${reviewed.id}\u0000${artifactId}`, await readWithAdapter(wiringRowFor(reviewed), held, others));
    }
  }

  const decisions = deriveWiringDecisions({
    crosswalk: { input: crosswalkInput, versionId: crosswalk.metadata.versionId ?? "", rows },
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
  await finish(derivedWiringCandidate(plan, [crosswalkInput, ...(lkgInput === null ? [] : [lkgInput])], now));
}

await main();
