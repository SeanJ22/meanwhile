import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { SOURCE_AUTHORITIES } from "../lib/civic-data/source-authority.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { notModifiedIssue, validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { acquireRegistrationSource, type RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { escapedJsonBytes, registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";
import {
  REGISTRATION_MAX_CANDIDATE_BYTES,
  REGISTRATION_SOURCE_BYTES,
  REGISTRATION_SOURCE_LAST_MODIFIED,
  REGISTRATION_SOURCE_SHA256,
  REGISTRATION_SOURCE_URL,
  REGISTRATION_TARGETS,
  registrationTarget,
} from "../lib/registration/publication.ts";
import { composeRegistration } from "../lib/registration/compose.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";

/**
 * Every state registers from data through one contract per FIPS state: its candidate promotes through the
 * ordinary engine and reads back through its typed reader; an unchanged month confirms UNCHANGED without a
 * new candidate; source holdings survive reviewed-registry changes while reviewed records win in
 * composition; and changed Census bytes are refused.
 */

const ROOT = join(import.meta.dirname, "..");
const RECEIPT: RegistrationSourceReceipt = {
  requestedUrl: REGISTRATION_SOURCE_URL,
  finalUrl: REGISTRATION_SOURCE_URL,
  httpStatus: 200,
  // Anchored to the real clock: the engine refuses an event dated in the future.
  retrievedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  sha256: REGISTRATION_SOURCE_SHA256,
  bytes: REGISTRATION_SOURCE_BYTES,
  confirmedBy: "BYTES_HASHED",
};

/** The reviewed registry's ids, from its committed first seed (the promoted projection's shape). */
function reviewedFromFirstSeed(): ReviewedRegistryIds {
  const registry = JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as {
    divisions: { ocdId: string }[];
    bodies: { id: string; ocdId: string | null }[];
  };
  return {
    versionId: "cv-reviewed-first-seed",
    divisionIds: new Set(registry.divisions.map((d) => d.ocdId)),
    bodyIds: new Set(registry.bodies.map((b) => b.id)),
    bodyDivisionIds: new Set(registry.bodies.map((b) => b.ocdId).filter((id): id is string => typeof id === "string")),
  };
}

test("one registration contract per state, DC and territory in the FIPS table, each its own scope, command and state", () => {
  const contracts = ROUTINE_SOURCE_CONTRACTS.filter((c) => c.recordClass === "REGISTRATION");
  assert.equal(contracts.length, 56);
  assert.deepEqual(contracts.map((c) => c.id), REGISTRATION_TARGETS.map((t) => t.contractId));
  assert.equal(new Set(contracts.map((c) => c.scope)).size, 56);
  assert.equal(new Set(contracts.map((c) => c.acquisitionAdapter.command.join(" "))).size, 56, "the firewall's full command lines are unique");
  assert.equal(new Set(contracts.map((c) => c.acquisitionFailureDomain)).size, 1, "one Census download at a time: the runner takes one state per pass");
  for (const c of contracts) {
    assert.equal(c.acquisitionAdapter.authorityMode, "SINGLE_ROUTE");
    assert.equal(c.acquisitionAdapter.requestedUrl, REGISTRATION_SOURCE_URL);
    assert.equal(c.cadence.defaultEveryMs, 90 * 24 * 60 * 60 * 1000, "a five-yearly Census file is confirmed every 90 days");
    assert.ok(c.readerProjection?.consumers.includes("lib/registration/reader.ts"));
  }
  assert.ok(existsSync(join(ROOT, "scripts", "registration-refresh.mts")));
  const authority = SOURCE_AUTHORITIES["census-governments-registration"];
  assert.deepEqual([...authority.jurisdictions].sort(), REGISTRATION_TARGETS.map((t) => t.jurisdiction).sort(), "every state's jurisdiction is inside the authority");
  assert.equal(authority.routineAutoPromotion, true);
  assert.ok(authority.routePrefixes.every((p) => new URL(p).hostname === "www2.census.gov"));
  const index = JSON.parse(readFileSync(join(ROOT, "data", "derived", "registration", "index.json"), "utf8")) as { states: Record<string, unknown> };
  assert.deepEqual(Object.keys(index.states).sort(), REGISTRATION_TARGETS.map((t) => t.state.toLowerCase()).sort(), "the reference carries exactly the FIPS table's states");
});

test("a state's registration promotes through the engine, reads back through its typed reader, and an unchanged month confirms its live version", async () => {
  const target = registrationTarget("NH");
  const reviewed = reviewedFromFirstSeed();
  const reference = loadRegistrationReference(ROOT, "NH");
  const store = new MemoryRoutineDataStore();

  const first = registrationCandidate({ target, reference, receipt: RECEIPT, reviewed });
  assert.deepEqual(first.semantics.violations, []);
  const promoted = await processRegisteredRoutineCandidate(store, target.contractId, first, RECEIPT.retrievedAt);
  assert.equal(promoted.promoted?.versionId, first.id, `NH promoted: ${promoted.candidate.failureCode ?? ""} ${promoted.candidate.failureDetail ?? ""}`);
  const read = await readRegistrationProjection("NH", { store, now: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, first.id);
  const model = read.value as RegistrationReadModel;
  assert.ok(model.bodies.length > 0 && model.divisions.length > 0);

  const later = { ...RECEIPT, retrievedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  const second = registrationCandidate({ target, reference, receipt: later, reviewed });
  const again = await processRegisteredRoutineCandidate(store, target.contractId, second, later.retrievedAt);
  // Unchanged payloads are not stored anew.
  assert.equal(again.promoted?.versionId, first.id);
  assert.equal(again.confirmed?.recheck.changeSet?.outcome, "UNCHANGED", "the same Census bytes, reference and reviewed registry change nothing");
  assert.equal(await store.readCandidate(second.id), null, "the recheck is not a new stored candidate");
  assert.equal((await store.readPromotion("REGISTRATION", target.scope))?.versionId, first.id);
});

test("sourced registration survives reviewed changes, and composition still prefers the current reviewed body", () => {
  const reviewed = reviewedFromFirstSeed();
  for (const state of ["NH", "NJ", "AZ", "TN"]) {
    const input = { target: registrationTarget(state), reference: loadRegistrationReference(ROOT, state), receipt: RECEIPT };
    const model = registrationCandidate({ ...input, reviewed }).readModel as RegistrationReadModel;
    const empty = registrationCandidate(input).readModel as RegistrationReadModel;
    assert.deepEqual(model, empty, state + ": sourced holdings do not depend on reviewed ownership or version");
    assert.equal(model.reviewedRegistryVersionId, null);
    const claimed = { versionId: "fixture:reviewed-new-edition", divisionIds: new Set(model.divisions.map(d => d.ocdId)),
      bodyIds: new Set(model.bodies.map(b => b.id)), bodyDivisionIds: new Set(model.bodies.map(b => b.ocdId)) };
    assert.deepEqual(registrationCandidate({ ...input, reviewed: claimed }).readModel, model,
      state + ": a reviewed edition owning every id cannot erase the source registration");
    const body = model.bodies.find(b => b.jurisdictionId !== null)!;
    assert.ok(body, state + ": a source-backed government has a body");
    assert.equal(composeRegistration({ divisions: [], bodies: [body] }, model, "fixture:registration").bodies.some(b => b.id === body.id), false);
    assert.equal(composeRegistration({ divisions: [], bodies: [] }, model, "fixture:registration").bodies.some(b => b.id === body.id), true,
      state + ": if the reviewed edition no longer holds it, the same registration still supplies it");
  }
  const nh = registrationCandidate({ target: registrationTarget("NH"), reference: loadRegistrationReference(ROOT, "NH"), receipt: RECEIPT }).readModel as RegistrationReadModel;
  const alternate = nh.bodies.find(b => b.alsoServesOcdIds?.length)!;
  assert.ok(alternate, "the sourced primary/alternate government pairing is retained");
  const other = alternate.alsoServesOcdIds![0];
  const reviewedAlternate = { id: other + "#governing", ocdId: other };
  assert.equal(composeRegistration({ divisions: [], bodies: [reviewedAlternate] }, nh, "fixture:registration").bodies.some(b => b.id === alternate.id), false,
    "a reviewed body on the exact alternate still takes precedence");
});

test("the largest state stays well inside the response bound, and a state with no government is a named violation", () => {
  const reviewed = reviewedFromFirstSeed();
  const il = registrationCandidate({ target: registrationTarget("IL"), reference: loadRegistrationReference(ROOT, "IL"), receipt: RECEIPT, reviewed });
  const bytes = escapedJsonBytes(il) + escapedJsonBytes({ divisions: (il.readModel as RegistrationReadModel).divisions, bodies: (il.readModel as RegistrationReadModel).bodies });
  assert.ok(bytes < REGISTRATION_MAX_CANDIDATE_BYTES / 2, `Illinois measures ${bytes} escaped bytes`);
  assert.deepEqual(il.semantics.violations, []);

  const empty = loadRegistrationReference(ROOT, "NH");
  const hollow = registrationCandidate({
    target: registrationTarget("NH"),
    reference: { ...empty, reference: { ...empty.reference, governments: empty.reference.governments.filter((g) => g[3] === "STATE") } },
    receipt: RECEIPT,
    reviewed,
  });
  assert.match(hollow.semantics.violations.join(" "), /lists no government in NH: a failed extraction/);
});

test("only the pinned Census bytes from census.gov over HTTPS are accepted; anything else is refused by name", async () => {
  const signal = new AbortController().signal;
  const serve = (body: Uint8Array<ArrayBuffer>, init: { status?: number; url?: string } = {}): typeof fetch =>
    (async () => {
      const response = new Response(body, { status: init.status ?? 200, headers: { "content-length": String(body.byteLength) } });
      Object.defineProperty(response, "url", { value: init.url ?? REGISTRATION_SOURCE_URL });
      return response;
    }) as typeof fetch;
  const refusal = async (fetchImpl: typeof fetch) => {
    try {
      await acquireRegistrationSource({ signal, fetchImpl });
    } catch (error) {
      assert.ok(isSourceAcquisitionFailure(error), String(error));
      return (error as { code: string }).code;
    }
    return "ACCEPTED";
  };
  assert.equal(await refusal(serve(new Uint8Array(REGISTRATION_SOURCE_BYTES))), "PUBLISHER_DOCUMENT_INVALID", "the right size with the wrong bytes is a different file");
  assert.equal(await refusal(serve(new Uint8Array(1024))), "PUBLISHER_DOCUMENT_INVALID");
  assert.equal(await refusal(serve(new Uint8Array(1024), { url: "https://example.org/govt_units_2022.ZIP" })), "PUBLISHER_RESPONSE_REFUSED");
  assert.equal(await refusal(serve(new Uint8Array(1024), { status: 503 })), "PUBLISHER_RESPONSE_REFUSED");
});

test("census.gov is asked conditionally: a 304 confirms the pinned file with no body, and a changed date is refused before its body is read", async () => {
  const signal = new AbortController().signal;
  const sent: Headers[] = [];
  let pulled = false;
  const answer = (status: number, headers: Record<string, string> = {}): typeof fetch =>
    (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(new Headers(init?.headers));
      // A zero high-water mark: the stream is pulled only when something reads it, never to fill its own queue.
      const body = status === 304 ? null : new ReadableStream<Uint8Array>({ pull(controller) { pulled = true; controller.enqueue(new Uint8Array(1024)); controller.close(); } }, { highWaterMark: 0 });
      const response = new Response(body, { status, headers });
      Object.defineProperty(response, "url", { value: REGISTRATION_SOURCE_URL });
      return response;
    }) as typeof fetch;

  const confirmed = await acquireRegistrationSource({ signal, fetchImpl: answer(304) });
  assert.equal(sent[0].get("if-modified-since"), REGISTRATION_SOURCE_LAST_MODIFIED, "every check is conditional on the pinned Last-Modified");
  assert.deepEqual(
    { status: confirmed.httpStatus, sha256: confirmed.sha256, bytes: confirmed.bytes, confirmedBy: confirmed.confirmedBy },
    { status: 304, sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "NOT_MODIFIED_SINCE_PIN" },
  );

  pulled = false;
  await assert.rejects(
    acquireRegistrationSource({ signal, fetchImpl: answer(200, { "last-modified": "Tue, 01 Jun 2027 00:00:00 GMT" }) }),
    (error: unknown) => isSourceAcquisitionFailure(error) && (error as { code: string }).code === "PUBLISHER_DOCUMENT_INVALID" && /its body was not read/.test(String((error as Error).message)),
  );
  assert.equal(pulled, false, "a new vintage costs no download");

  // A server that ignored the condition answers 200 with the pinned date: its body is read and held to the pinned hash.
  pulled = false;
  await assert.rejects(
    acquireRegistrationSource({ signal, fetchImpl: answer(200, { "last-modified": REGISTRATION_SOURCE_LAST_MODIFIED }) }),
    (error: unknown) => isSourceAcquisitionFailure(error) && /not the pinned 11459763 bytes/.test(String((error as Error).message)),
  );
  assert.equal(pulled, true, "the probe sees a read, so its silence above is a real no-download");
});

test("a 304 is authentic only as registration's pinned file; any other 304 is refused by name", async () => {
  const target = registrationTarget("NH");
  const reviewed = reviewedFromFirstSeed();
  const reference = loadRegistrationReference(ROOT, "NH");
  const store = new MemoryRoutineDataStore();

  // First the hashed read, then a later 304: the bound pairing promotes, and nothing changed.
  const first = registrationCandidate({ target, reference, receipt: RECEIPT, reviewed });
  assert.equal((await processRegisteredRoutineCandidate(store, target.contractId, first, RECEIPT.retrievedAt)).promoted?.versionId, first.id);
  const notModified: RegistrationSourceReceipt = { ...RECEIPT, httpStatus: 304, confirmedBy: "NOT_MODIFIED_SINCE_PIN", retrievedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  const second = registrationCandidate({ target, reference, receipt: notModified, reviewed });
  assert.equal(notModifiedIssue(second), null);
  const again = await processRegisteredRoutineCandidate(store, target.contractId, second, notModified.retrievedAt);
  assert.equal(again.promoted?.versionId, second.id, `${again.candidate.failureCode ?? ""} ${again.candidate.failureDetail ?? ""}`);
  assert.equal(again.candidate.candidate.changeSet?.outcome, "UNCHANGED", "a 304 is the validated no-change receipt");
  assert.match(JSON.stringify(again.candidate.receipt), /304 Not Modified against the pinned Last-Modified/);

  // A 304 naming some other bytes is refused.
  const otherBytes = registrationCandidate({ target, reference, receipt: { ...notModified, sha256: "0".repeat(64) }, reviewed });
  const refusedOther = validateRoutineCandidate(otherBytes, null, notModified.retrievedAt);
  const authenticity = refusedOther.receipt.checks.find((c) => c.check === "SOURCE_AUTHENTICITY");
  assert.equal(authenticity?.verdict, "FAIL");
  assert.equal(authenticity?.code, "NOT_MODIFIED_WITHOUT_BOUND_PIN");

  // A 304 whose raw hash is not built from the pinned bytes is refused.
  const forged = { ...second, retrieval: { ...second.retrieval, rawHash: "f".repeat(64) } };
  assert.match(notModifiedIssue(forged) ?? "", /raw hash is not the one registration builds/);

  // A 304 for a class that pins no bytes to a Last-Modified is refused: nothing was acquired.
  assert.match(notModifiedIssue({ ...second, recordClass: "MEETING" }) ?? "", /pins no bytes to a Last-Modified/);
});

test("registration emits the registry's own shapes, so the reader composes it without translation", () => {
  const oh = registrationCandidate({ target: registrationTarget("OH"), reference: loadRegistrationReference(ROOT, "OH"), receipt: RECEIPT, reviewed: reviewedFromFirstSeed() }).readModel as RegistrationReadModel;
  // The registry holds no state division; the state is the scope.
  assert.ok(oh.divisions.length > 0 && oh.divisions.every((d) => d.divisionType !== ("state" as string)), "no state division is registered");
  for (const d of oh.divisions) {
    assert.equal(d.sourceDataset, "TIGER_CB2023");
    assert.match(d.provenance.sourceUrl ?? "", /^https:\/\/www2\.census\.gov\/geo\/tiger\/GENZ2023\/shp\/cb_2023_us_(county|place|cousub|unsd|elsd|scsd)_500k\.zip$/);
    assert.deepEqual([d.lsad, d.funcstat, d.classfp, d.canonicalOcdId, d.canonicalMatch, d.canonicalGap], [null, null, null, null, "none", "UNDETERMINED"], "no canonical match is claimed");
  }
  for (const b of oh.bodies) {
    assert.equal(b.name, null, "a name is null until sourced");
    assert.equal(b.coverageStatus, "NOT_ATTEMPTED");
    if (b.bodyOrigin === "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS") {
      assert.equal(b.sourceDataset, "COG_2022");
      assert.equal(b.provenance.sourceUrl, REGISTRATION_SOURCE_URL);
      assert.ok(typeof b.censusId === "string" && typeof b.censusUnitType === "string");
    } else {
      assert.equal(b.bodyOrigin, "DERIVED_FROM_DIVISION_TYPE");
      assert.equal(b.sourceDataset, "TIGER_CB2023");
      assert.equal(b.censusId, undefined, "a school district no listed government claimed carries no Census id");
    }
  }
});

test("the reader composes a state's registration beside the reviewed registry it holds now, and reviewed still wins", () => {
  const reviewed = JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as {
    divisions: { ocdId: string }[];
    bodies: { id: string; ocdId: string | null; alsoServesOcdIds?: string[]; censusId?: string }[];
  };
  const oh = registrationCandidate({ target: registrationTarget("OH"), reference: loadRegistrationReference(ROOT, "OH"), receipt: RECEIPT, reviewed: reviewedFromFirstSeed() }).readModel as RegistrationReadModel;
  const composed = composeRegistration(reviewed, oh, "cv-oh");
  assert.equal(composed.state, "OH");
  assert.equal(composed.divisions.length, oh.divisions.length, "the reviewed registry holds nothing in Ohio yet");
  assert.equal(composed.bodies.length, oh.bodies.length);

  // The reviewed registry moves after Ohio registered: it now holds one of Ohio's divisions, keys a body on
  // another, and lists a third government by its Census id. None of those is composed from registration.
  const [heldDivision, keyedBody, censusBody] = [oh.divisions[0], oh.bodies[0], oh.bodies.find((b) => b.censusId !== undefined && b !== oh.bodies[0])!];
  const later = {
    divisions: [...reviewed.divisions, { ocdId: heldDivision.ocdId }],
    bodies: [
      ...reviewed.bodies,
      { id: "reviewed-body-on-a-registered-division", ocdId: keyedBody.ocdId },
      { id: "reviewed-body-for-the-same-government", ocdId: null, censusId: censusBody.censusId },
    ],
  };
  const after = composeRegistration(later, oh, "cv-oh");
  assert.equal(after.divisions.some((d) => d.ocdId === heldDivision.ocdId), false, "a division the reviewed registry holds now");
  assert.equal(after.bodies.some((b) => b.id === keyedBody.id), false, "a division the reviewed registry now keys a body on");
  assert.equal(after.bodies.some((b) => b.id === censusBody.id), false, "a government the reviewed registry now lists by its Census id");
  assert.equal(after.bodies.length, oh.bodies.length - 2);
});

test("a territory registers a body only where TIGER/Line records a governing status, never from geography", async () => {
  const reviewed = reviewedFromFirstSeed();
  const target = registrationTarget("PR");
  const reference = loadRegistrationReference(ROOT, "PR");
  const pr = registrationCandidate({ target, reference, receipt: RECEIPT, reviewed });
  assert.deepEqual(pr.semantics.violations, [], "Puerto Rico registers: the Census of Governments' silence is no longer read as its only word");
  const model = pr.readModel as RegistrationReadModel;
  assert.equal(model.vintage.governments, "2023 TIGER/Line functional status");
  assert.equal(model.bodies.length, 78, "the 78 municipios, FUNCSTAT A");
  const municipios = new Set(model.divisions.filter((d) => d.divisionType === "county").map((d) => d.ocdId));
  for (const b of model.bodies) {
    assert.ok(municipios.has(b.ocdId) && b.id === `${b.ocdId}#governing`, `${b.id} is a municipio's government`);
    assert.equal(b.bodyOrigin, "REGISTERED_FROM_TIGER_FUNCSTAT");
    assert.equal(b.sourceDataset, "TIGER_LINE2023");
    assert.equal(b.provenance.sourceUrl, "https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip");
    assert.equal(b.censusId, undefined, "no Census of Governments id is claimed for it");
    assert.match(b.jurisdictionId ?? "", /^pr:county:[a-z0-9-]+$/);
  }
  // The barrios (N), the zonas urbanas (S), the Department of Education's school district and the territory itself: geography only.
  assert.equal(model.bodies.some((b) => b.ocdId === "ocd-division/country:us/territory:pr" || b.id.endsWith("#board")), false);
  const barrio = model.divisions.find((d) => d.ocdId === "ocd-division/country:us/territory:pr/county:adjuntas_municipio/place:adjuntas_barrio_pueblo")!;
  assert.deepEqual([barrio.lsad, barrio.funcstat, barrio.classfp], ["41", "N", "Z1"], "the division records its Census status");
  assert.deepEqual(model.functionalStatus?.divisionsByStatus, { A: 78, N: 901, S: 292 });
  assert.equal(model.functionalStatus?.noLocalGovernment, null);
  const promoted = await processRegisteredRoutineCandidate(new MemoryRoutineDataStore(), target.contractId, pr, RECEIPT.retrievedAt);
  assert.equal(promoted.promoted?.versionId, pr.id, `PR promoted: ${promoted.candidate.failureCode ?? ""} ${promoted.candidate.failureDetail ?? ""}`);

  // A government row that claims a status its division does not carry mints nothing, and says so.
  const forged = { ...reference.reference, governments: [...reference.reference.governments, ["cousub:7200100401", "pr:city:forged", "Adjuntas barrio-pueblo", "COUNTY SUBDIVISION GOVERNMENT", reference.reference.divisions.findIndex((d) => d[0] === barrio.ocdId), "TIGER_FUNCSTAT", -1] as const] };
  const refused = registrationCandidate({ target, reference: { ...reference, reference: forged }, receipt: RECEIPT, reviewed });
  assert.equal((refused.readModel as RegistrationReadModel).bodies.some((b) => b.ocdId === barrio.ocdId), false);
  assert.match(refused.semantics.violations.join(" "), /carries N status: no government is minted from geography/);

  const as = registrationCandidate({ target: registrationTarget("AS"), reference: loadRegistrationReference(ROOT, "AS"), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
  const mp = registrationCandidate({ target: registrationTarget("MP"), reference: loadRegistrationReference(ROOT, "MP"), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
  assert.deepEqual([as.bodies.length, mp.bodies.length], [94, 4], "American Samoa's districts, counties and villages (A); the Northern Marianas' four municipalities (A, B)");
});

test("Guam and the Virgin Islands register with the Census's own record of no local government; a state with none is still a failed extraction", async () => {
  const reviewed = reviewedFromFirstSeed();
  for (const [state, name, divisions] of [["GU", "Guam", 77], ["VI", "U.S. Virgin Islands", 33]] as const) {
    const target = registrationTarget(state);
    const candidate = registrationCandidate({ target, reference: loadRegistrationReference(ROOT, state), receipt: RECEIPT, reviewed });
    const model = candidate.readModel as RegistrationReadModel;
    assert.deepEqual(candidate.semantics.violations, [], `${state} is not refused`);
    assert.equal(model.bodies.length, 0, `${state}: no body, not even its department of education's`);
    assert.match(model.functionalStatus?.noLocalGovernment ?? "", new RegExp(`^No local government recorded by the Census for ${name}: none of its ${divisions} county`));
    assert.equal(candidate.dependentChecks[0].passed, true);
    const promoted = await processRegisteredRoutineCandidate(new MemoryRoutineDataStore(), target.contractId, candidate, RECEIPT.retrievedAt);
    assert.equal(promoted.promoted?.versionId, candidate.id, `${state} promoted: ${promoted.candidate.failureCode ?? ""} ${promoted.candidate.failureDetail ?? ""}`);
  }
  // Without its statuses, the same territory's silence is a failed extraction again: zero is never evidence by itself.
  const gu = loadRegistrationReference(ROOT, "GU");
  const unstated = registrationCandidate({
    target: registrationTarget("GU"),
    reference: { ...gu, reference: { ...gu.reference, divisions: gu.reference.divisions.map((d) => [d[0], d[1], d[2], d[3]] as const) } },
    receipt: RECEIPT,
    reviewed,
  });
  assert.match(unstated.semantics.violations.join(" "), /carry no TIGER\/Line functional status/);
  assert.match(unstated.semantics.violations.join(" "), /lists no government in GU, and its TIGER\/Line functional status does not show that none governs/);
  // A state keeps the Census of Governments rule exactly: its statuses are never read, so zero is always a failure.
  const oh = loadRegistrationReference(ROOT, "OH");
  const hollow = registrationCandidate({ target: registrationTarget("OH"), reference: { ...oh, reference: { ...oh.reference, governments: oh.reference.governments.filter((g) => g[3] === "STATE") } }, receipt: RECEIPT, reviewed });
  assert.match(hollow.semantics.violations.join(" "), /lists no government in OH: a failed extraction, never a state with no government/);
});

test("every county subdivision's parent is its county, read off its GEOID, and no committed id moves", () => {
  const reviewed = reviewedFromFirstSeed();
  let cousubs = 0;
  for (const target of REGISTRATION_TARGETS) {
    const reference = loadRegistrationReference(ROOT, target.state);
    const ids = new Set(reference.reference.divisions.map((d) => d[0]));
    const model = registrationCandidate({ target, reference, receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
    // The reference's ids are the registration's ids, unchanged: parents are resolved, never rewritten into the ids.
    assert.ok(model.divisions.every((d) => ids.has(d.ocdId)), `${target.state}: every registered id is the reference's`);
    const dangling = model.divisions.filter((d) => d.parentOcdId !== null && !ids.has(d.parentOcdId));
    assert.deepEqual(dangling.map((d) => d.ocdId).slice(0, 3), [], `${target.state}: every parent is a division of the state`);
    for (const d of model.divisions) {
      if (!/\/county:[^/]+\/place:[^/]+$/.test(d.ocdId)) continue;
      cousubs++;
      const county = reference.reference.divisions.find((c) => c[1] === "county" && c[2] === d.geoid!.slice(0, 5));
      assert.equal(d.parentOcdId, county?.[0], `${d.ocdId} sits in the county its GEOID names`);
    }
  }
  assert.ok(cousubs > 30_000, `${cousubs} county subdivisions checked`);
  const pr = registrationCandidate({ target: registrationTarget("PR"), reference: loadRegistrationReference(ROOT, "PR"), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
  assert.equal(
    pr.divisions.find((d) => d.ocdId === "ocd-division/country:us/territory:pr/county:adjuntas_municipio/place:adjuntas_barrio_pueblo")?.parentOcdId,
    "ocd-division/country:us/territory:pr/county:adjuntas",
    "the barrio keeps its committed id and resolves to the municipio's",
  );
});

test("registration never mints a body on a Census placeholder division, in any state; the division stays as geography", async () => {
  const { isCensusPlaceholderDivision } = await import("../lib/registry/census-placeholders.ts");
  const reviewed = reviewedFromFirstSeed();
  let placeholderDivisions = 0;
  for (const target of REGISTRATION_TARGETS) {
    const model = registrationCandidate({ target, reference: loadRegistrationReference(ROOT, target.state), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
    const placeholders = new Set(model.divisions.filter((d) => isCensusPlaceholderDivision(d)).map((d) => d.ocdId));
    placeholderDivisions += placeholders.size;
    assert.equal(model.bodies.filter((b) => placeholders.has(b.ocdId)).length, 0, `${target.state}: no body on a placeholder`);
  }
  assert.ok(placeholderDivisions > 0, "some state registers a placeholder division, so the rule is exercised");
});
