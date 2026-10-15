import assert from "node:assert/strict";
import { neonConfig } from "@neondatabase/serverless";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { registryPlaceFixtureResult, type FixtureStatement } from "./helpers/registry-place-fetch.ts";
import test from "./helpers/playbooks.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { decideNamedBody, applyNamedBodyDecision, type BodyConfirmation } from "../lib/ask/body-confirmation.ts";
import { readAskAnswer, type AskAnswerPayload } from "../lib/ask/answer.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { installPromotedValue, installRegistryAuthority, registryTransferImport } from "./helpers/promoted-fixtures.ts";
// The canonical native runner strips TypeScript but does not compile TSX.
// Compile only these actual reader leaves through the existing tsx runtime.
const { AskBodyConfirmation } = await tsImport("../components/ask/body-confirmation.tsx", import.meta.url) as typeof import("../components/ask/body-confirmation.tsx");

// Offline actual handler, with no model, database, acquisition or signal writes.
for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
await installRegistryAuthority();
let vailSnapshot: MeetingsSnapshot;
// Vail's promoted meeting partition: one scheduled sitting a week out whose
// agenda is not yet held, as the Apptegy calendar publishes it.
{
  const partition = MEETING_PARTITION_CONTRACTS.find((p) => p.bodyId === "ocd-division/country:us/state:az/school_district:vail_unified_district#board")!;
  const wiring = partition.wiring!;
  const now = new Date().toISOString();
  const value: MeetingsSnapshot = {
    formatVersion: 1, generatedAt: now, counts: { fresh: 1, carried: 0, total: 1 },
    sources: [{ source: partition.meetingSource, ok: true, error: null, fetched: 1, normalized: 1,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings: [{
      id: `${partition.meetingSource}:vail:test-sitting`, ocdId: partition.ocdId, bodyId: partition.bodyId, bodyName: wiring.publishingOrg,
      title: "Governing Board Meeting", startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), timeZone: wiring.timeZone,
      location: null, agendaUrl: null, jurisdiction: wiring.jurisdiction, status: "SCHEDULED",
      provenance: { sourceUrl: String(wiring.config.apiBase), sourceOrg: wiring.publishingOrg, collectedAt: now, verifiedAt: null },
    }],
    agendaDocuments: [],
  };
  installPromotedValue({ recordClass: "MEETING", scope: partition.scope, sourceId: partition.sourceId, versionId: "test:vail-meetings", retrievedAt: now, value });
  vailSnapshot = value;
}
const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
const nearby = "ocd-division/country:us/state:az/school_district:sunnyside_unified_district";
async function ask(question: string, confirmation?: BodyConfirmation): Promise<AskAnswerPayload> {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "tester-9-4-ask" },
    body: JSON.stringify({ question, confirmation, surface: "MAP", ocdIds: [nearby], today: "2026-09-04" }),
  }));
  assert.equal(response.status, 200);
  const answer = readAskAnswer(await response.json()); assert.ok(answer);
  assert.equal(answer.trace.interpretation.ran, false);
  assert.equal(answer.trace.synthesis.ran, false);
  return answer;
}

test("ASK-26 Vail and its clean canonical name bind outside the reader's nearby coverage", async () => {
  for (const question of ["What's on the Vail school district agenda?", "What's on the Vail Unified District agenda?"]) {
    const answer = await ask(question);
    assert.equal(answer.subject?.id, VAIL);
    assert.equal(answer.confirmation, undefined);
    assert.ok(answer.records.every(record => !record.bodyId || record.bodyId === VAIL));
    assert.equal(answer.agendaLead, true);
  }
});

test("ASK-26 typo and mechanical acronym offer ONE guess, no answer, then bind the original question", async () => {
  for (const question of ["What's on the Vial school district agenda?", "What's on the Vial agenda?", "What's on the VUSD agenda?"]) {
    const pending = await ask(question);
    assert.equal(pending.mode, "CLARIFY");
    assert.equal(pending.subject, null); assert.equal(pending.answer, null);
    assert.deepEqual(pending.records, []); assert.deepEqual(pending.meetings, []);
    assert.equal(pending.candidates, undefined);
    assert.equal(pending.confirmation?.bodyId, VAIL);
    assert.equal(pending.confirmation?.question, question);
    assert.equal(pending.trace.retrieval.recordCount, 0);
    const markup = renderToStaticMarkup(createElement(AskBodyConfirmation, { answer: pending, working: false, onConfirm() {}, onClarify() {} }));
    assert.match(markup, /Did you mean Vail Unified/); assert.match(markup, /Yes, answer for this body/);
    const confirmed = await ask(question, pending.confirmation);
    assert.equal(confirmed.subject?.id, VAIL);
    assert.equal(confirmed.trace.resolution.basis, "READER_CONFIRMATION");
    assert.ok(confirmed.records.length > 0);
    assert.ok(confirmed.records.every(record => !record.bodyId || record.bodyId === VAIL));
    const forged = await ask(question, { ...pending.confirmation!, bodyId: `${nearby}#board` });
    assert.equal(forged.subject, null); assert.equal(forged.mode, "CLARIFY");
    const reused = await ask("What's on the Vial school board agenda?", pending.confirmation);
    assert.equal(reused.subject, null);
  }
});

test("ASK-26 tie chooses one stable canonical suggestion without treating an ordering as identity proof", () => {
  const bodies: BindableEntity[] = ["second", "first"].map(id => ({ id, name: "Springfield Unified District", nameClass: "body", divisionType: "school_district", level: "BODY" }));
  const question = "What's on the Springfield school district agenda?";
  const decision = decideNamedBody(question, bodies);
  assert.equal(decision.kind, "CONFIRM");
  if (decision.kind !== "CONFIRM") return;
  assert.equal(decision.candidate.id, "first");
  assert.deepEqual(decideNamedBody(question, [...bodies].reverse()), decision);
  const substituted = applyNamedBodyDecision(decision, { binding: { kind: "BOUND", entity: bodies[0], matchedOn: "a model expansion" }, basis: "MODEL_EXPANSION_NARROWED", boundOn: "Springfield" }, question);
  assert.equal(substituted.binding.kind, "UNRESOLVED");
  assert.equal(decideNamedBody(question, bodies, { bodyId: "first", name: bodies[1].name, question }).kind, "BOUND");
  for (const unnamed of ["What's on the agenda?", "What's on my school district agenda?", "What's on the next meeting agenda?"])
    assert.equal(decideNamedBody(unnamed, bodies).kind, "NONE", "An unnamed question retains the existing context default");
});

test("ASK-26 unknown named body gets a plain gap; another nearby body cannot inherit the question", async () => {
  for (const [question, gap] of [
    ["What's on the Fictional Nonexistent school district agenda?", "We don't have Fictional Nonexistent School District's agendas yet."],
    ["When does the Fictional Nonexistent City Council meet next?", "We don't have Fictional Nonexistent City Council's calendar yet."],
  ]) {
    const answer = await ask(question);
    assert.equal(answer.mode, "NO_EVIDENCE");
    assert.equal(answer.answer, gap);
    assert.equal(answer.subject, null); assert.equal(answer.confirmation, undefined); assert.equal(answer.candidates, undefined);
    assert.deepEqual(answer.records, []); assert.deepEqual(answer.meetings, []);
    assert.equal(answer.clarification, undefined);
    assert.doesNotMatch(answer.answer ?? "", /Sunnyside|Vail/i);
  }
  // A bare unknown name still needs identification; never default to a nearby body.
  const unnamed = await ask("What's on the Zzznonexistent agenda?");
  assert.equal(unnamed.mode, "CLARIFY");
  assert.equal(unnamed.subject, null); assert.equal(unnamed.confirmation, undefined); assert.equal(unnamed.candidates, undefined);
  assert.deepEqual(unnamed.records, []); assert.deepEqual(unnamed.meetings, []);
  assert.match(unnamed.clarification ?? "", /Which government/);
});

test("ASK-27 an unavailable agenda remains an OURS holding gap, never an empty docket claim", async () => {
  const answer = await ask("What's on the Vail school district agenda?");
  assert.ok(answer.gaps.some(gap => gap.whose === "OURS" && /agenda|publication/i.test(gap.statement)));
  assert.ok(!answer.gaps.some(gap => gap.whose === "THEIRS" && /no agenda|not published/i.test(gap.statement)));
  assert.ok(!answer.records.some(record => /nothing is on the agenda|no agenda items exist/i.test(record.text)));
});

test("named Vail lookup reads only its exact canonical body and requested divisions at the accepted registry version", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vail-identity-"));
  const originalFetch = globalThis.fetch;
  const originalNeonFetch = neonConfig.fetchFunction;
  const priorDirectory = process.env.WTP_READER_EDGE_DIR;
  const priorDatabase = process.env.DATABASE_URL;
  const registry = registryTransferImport().projection.payload;
  const version = "test:vail-canonical-registry";
  const queries: { divisions: string[]; targets: string[] }[] = [];
  const array = (value: unknown): string[] => Array.isArray(value) ? value : JSON.parse(`[${String(value).slice(1, -1)}]`);
  try {
    const published = await publishReaderEdgeArtifacts(vailSnapshot, {
      sourceThrough: vailSnapshot.generatedAt, retrievedAt: vailSnapshot.generatedAt, promotedThrough: vailSnapshot.generatedAt,
    }, { store: new LocalFileArtifactStore(directory),
      authority: { "registry-runtime": { value: registry, versionId: version } } });
    assert.equal(published.status, "PUBLISHED");
    process.env.WTP_READER_EDGE_DIR = directory;
    process.env.DATABASE_URL = "postgresql://fixture:fixture@ep-vail-fixture.vail-fixture.invalid/test?sslmode=require";
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.ok(url.includes("vail-fixture.invalid/"), `unexpected network read: ${url}`);
      const request = JSON.parse(String(init?.body)) as FixtureStatement & { queries?: FixtureStatement[] };
      const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
      const results = (request.queries ?? [request]).map(statement => {
        const selected = registryPlaceFixtureResult(statement, registry, version);
        if (selected) queries.push({ divisions: array(statement.params?.[2]), targets: array(statement.params?.[4]) });
        return selected ?? empty;
      });
      return Response.json(request.queries ? { results } : results[0]);
    }) as typeof fetch;
    neonConfig.fetchFunction = globalThis.fetch;
    const answer = await ask("What's on the Vail school district agenda?");
    assert.equal(answer.subject?.id, VAIL);
    assert.deepEqual(queries, [
      { divisions: ["ocd-division/country:us/state:az", nearby], targets: [] },
      { divisions: ["ocd-division/country:us/state:az", nearby, VAIL.split("#")[0]], targets: [VAIL] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    neonConfig.fetchFunction = originalNeonFetch;
    if (priorDirectory === undefined) delete process.env.WTP_READER_EDGE_DIR;
    else process.env.WTP_READER_EDGE_DIR = priorDirectory;
    if (priorDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
