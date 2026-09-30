import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../lib/control-plane/ids.ts";
import { readFieldManual, type FieldManualStore } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ModelRequest, ModelResponse, ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MODEL_FOR_CLASS } from "../lib/control-plane/scheduler/model-routing.ts";
import { documentWindows, modelParseReasoner, parseLearningEntries, routeParse } from "../lib/control-plane/workers/model-parser.ts";
import { confirmQuotedRecords, isQuotedExtraction, quotedSourceFindings, quotesHoldAgainst } from "../lib/control-plane/workers/quoted-proof.ts";
import { validateGeneralizedExtraction } from "../lib/control-plane/workers/generalized-validator.ts";
import type { GeneralizedCivicExtractionContract, ParserWorkerInput, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const NOW = "2026-09-29T10:00:00.000Z";
const TEXT = [
  "[Page 1]",
  "CITY OF EXAMPLETON — PLANNING COMMISSION",
  "Regular Meeting: Tuesday, October 14, 2026 at 6:00 PM",
  "Location: Council Chambers, 100 Main Street",
  "[Page 2]",
  "Special Meeting: Thursday, October 23, 2026 at 5:30 PM",
  "Location: Library Annex, 12 Oak Avenue",
].join("\n");

const evidence: WorkerEvidence = {
  artifactId: "art-agenda", contentHash: contentHash(TEXT), text: TEXT, acquiredByAttemptId: "acq-1",
  canonicalUrl: "https://www.exampletonaz.gov/agendas/pc.pdf", retrievedAt: NOW, sourceId: "exampleton", methodRouteId: "route-agenda",
};
const contract: GeneralizedCivicExtractionContract = {
  schemaVersion: 2, recordClass: "PLANNING_MEETING", subjectId: "az:city:exampleton",
  requiredFields: ["title", "when"], identity: { namespace: "az:city:exampleton:planning", keyFields: ["when"] },
  jurisdiction: { country: "US", state: "AZ", canonicalId: "az:city:exampleton" },
  completenessScope: "Meetings listed in this one agenda document.", expectedSourceDate: null, methodVersion: 61,
  sourceScope: { sourceId: "exampleton", publisher: "City of Exampleton", routeIds: ["route-agenda"], canonicalUrls: [evidence.canonicalUrl], observationArtifactIds: ["art-agenda"] },
  extraction: { format: "UNSUPPORTED", mediaType: "application/pdf", fields: {}, reason: "No parsing rule exists for this record type." },
  verification: { required: false, authorities: [] },
};
const input = (): ParserWorkerInput => ({ attemptId: "parse-1", worker: { role: "PARSER", provider: "anthropic", version: "m", instance: "i" }, evidence, contract });

const good = (title: string, when: string, extra: { name: string; value: string; quote: string }[] = []) => ({
  fields: [{ name: "title", value: title, quote: title }, { name: "when", value: when, quote: when }, ...extra],
});
const GOOD_PROPOSAL = [
  good("Regular Meeting", "Tuesday, October 14, 2026 at 6:00 PM", [{ name: "location", value: "Council Chambers", quote: "Location: Council Chambers, 100 Main Street" }]),
  good("Special Meeting", "Thursday, October 23, 2026 at 5:30 PM"),
];

const respond = (model: string, records: unknown): ModelResponse => ({
  model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "record_extraction", input: { records } }],
  usage: { input_tokens: 400, output_tokens: 120 },
});

test("every kept field is a value inside a quote found in the saved document; the PDF page is recorded", () => {
  const out = confirmQuotedRecords({ evidence, contract }, GOOD_PROPOSAL.map((p) => ({ ...p, windowStart: 0 })));
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.rejections, []);
  const spans = new Map(out.spans.map((s) => [s.id, s]));
  for (const record of out.records) for (const id of record.evidenceSpanIds) {
    const span = spans.get(id)!;
    assert.equal(TEXT.slice(span.start, span.end), span.quote);
    assert.equal(span.sourceFormat, "UNSUPPORTED");
  }
  assert.match(out.spans.find((s) => s.field === "when" && s.quote.startsWith("Thursday"))!.jsonPointer, /^\/pages\/2\/quoted\//);
  assert.match(out.spans.find((s) => s.field === "when" && s.quote.startsWith("Tuesday"))!.jsonPointer, /^\/pages\/1\/quoted\//);
  assert.equal(quotesHoldAgainst(out, TEXT).ok, true);
});

test("a quote that is not in the document, or a value not in its quote, never becomes a fact", () => {
  const out = confirmQuotedRecords({ evidence, contract }, [
    { ...good("Regular Meeting", "Tuesday, October 14, 2026 at 6:00 PM", [
      { name: "location", value: "Council Chambers", quote: "Location: The Grand Ballroom" },
      { name: "chair", value: "Mayor Jones", quote: "Regular Meeting" },
    ]), windowStart: 0 },
    // required field made up: the whole record is dropped, nothing is repaired
    { fields: [{ name: "title", value: "Budget Hearing", quote: "Budget Hearing" }, { name: "when", value: "Friday", quote: "Friday, November 1" }], windowStart: 0 },
  ]);
  assert.equal(out.records.length, 1);
  assert.equal("location" in out.records[0]!.fields, false);
  assert.equal("chair" in out.records[0]!.fields, false);
  const codes = out.rejections.map((r) => r.code).sort();
  assert.deepEqual(codes, ["QUOTE_NOT_IN_DOCUMENT", "QUOTE_NOT_IN_DOCUMENT", "QUOTE_NOT_IN_DOCUMENT", "REQUIRED_FIELD_UNCONFIRMED", "REQUIRED_FIELD_UNCONFIRMED", "VALUE_NOT_IN_QUOTE"].sort());
});

test("the same item listed twice by overlapping windows is one record", () => {
  const out = confirmQuotedRecords({ evidence, contract }, [{ ...GOOD_PROPOSAL[0]!, windowStart: 0 }, { ...GOOD_PROPOSAL[0]!, windowStart: 40 }]);
  assert.equal(out.records.length, 1);
});

test("the validator replays a quoted extraction without a rule, and catches a document that no longer says it", () => {
  const out = confirmQuotedRecords({ evidence, contract }, GOOD_PROPOSAL.map((p) => ({ ...p, windowStart: 0 })));
  const candidate = {
    role: "PARSER" as const, attemptId: "parse-1", implementation: "model-quoted-extraction", version: "1.0.0", schemaVersion: 2 as const, recordClass: contract.recordClass,
    contractMetadata: { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: 61 },
    artifactId: evidence.artifactId, contentHash: evidence.contentHash, acquiredByAttemptId: "acq-1", subjectId: contract.subjectId,
    verdict: "EXTRACTED" as const, records: out.records, spans: out.spans, warnings: [], declaredRowCount: null, sourceRowCount: 2, actualRowCount: 2,
  };
  assert.equal(isQuotedExtraction(contract, candidate), true);
  assert.deepEqual(quotedSourceFindings(candidate, contract, evidence), []);
  const validation = validateGeneralizedExtraction({ attemptId: "val-1", worker: { role: "VALIDATOR", provider: "we-the-people", version: "v", instance: "val" },
    producer: { role: "PARSER", provider: "anthropic", version: "m", instance: "i" }, producerAttemptId: "parse-1", evidence, contract, candidate }, contract);
  assert.equal(validation.verdict, "PASS");
  assert.equal(validation.validatedRecordCount, 2);

  const changed = { ...evidence, text: TEXT.replace("6:00 PM", "7:00 PM"), contentHash: contentHash(TEXT.replace("6:00 PM", "7:00 PM")) };
  assert.ok(quotedSourceFindings(candidate, contract, changed).some((f) => f.code === "QUOTE_NOT_IN_DOCUMENT" || f.code === "SPAN_ARTIFACT_MISMATCH"));
});

test("windows cover the whole document with overlap, and a very long document is read in part and says so", () => {
  const long = Array.from({ length: 4000 }, (_, i) => `line ${i} of the agenda`).join("\n");
  const { windows, unreadFrom } = documentWindows(long, 5000, 200, 3);
  assert.equal(windows.length, 3);
  assert.ok(unreadFrom !== null && unreadFrom < long.length);
  assert.ok(windows[1]!.start < windows[0]!.end, "windows overlap");
  const whole = documentWindows("short", 5000, 200, 3);
  assert.deepEqual(whole, { windows: [{ start: 0, end: 5 }], unreadFrom: null });
});

test("the manual routes the parse: nothing recorded starts cheapest; a tier that failed here is skipped", () => {
  let store = readEmpty();
  assert.equal(routeParse(store, { recordClass: "PLANNING_MEETING", host: "www.exampletonaz.gov" }).tier, "haiku");
  store = learn(store, { tier: "haiku", confirmed: 0 });
  const route = routeParse(store, { recordClass: "PLANNING_MEETING", host: "www.exampletonaz.gov" });
  assert.equal(route.tier, "sonnet");
  assert.match(route.reason, /haiku failed to confirm quotes on www\.exampletonaz\.gov/);
  assert.equal(route.inheritedEntryIds.length, 1);
  // another publisher of the same record class where haiku failed and nothing yielded: skipped there too
  assert.equal(routeParse(store, { recordClass: "PLANNING_MEETING", host: "www.other.gov" }).tier, "sonnet");
  // once haiku yields on this publisher, it is the start again
  store = learn(store, { tier: "haiku", confirmed: 3 });
  assert.equal(routeParse(store, { recordClass: "PLANNING_MEETING", host: "www.exampletonaz.gov" }).tier, "haiku");
});
function readEmpty(): FieldManualStore { return { formatVersion: 1, updatedOn: null, entries: [] }; }
function learn(store: FieldManualStore, o: { tier: "haiku" | "sonnet"; confirmed: number }) {
  const entries = parseLearningEntries(store, { recordClass: "PLANNING_MEETING", host: "www.exampletonaz.gov", state: "AZ", tier: o.tier, proposed: 3, confirmed: o.confirmed,
    rejected: 3 - o.confirmed, fieldNames: o.confirmed ? ["title", "when"] : [], samples: [], observedAt: NOW });
  const byId = new Map(store.entries.map((e) => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  return { formatVersion: 1 as const, updatedOn: NOW, entries: [...byId.values()] };
}

test("a parse with no rule: cheapest tier is asked, escalates once when no quote confirms, and the next parse starts where the last one succeeded", async () => {
  const repos = createMemoryRepositories();
  const seen: string[] = [];
  const transport: ModelTransport = async (request: ModelRequest) => {
    seen.push(request.model);
    // Haiku invents its quotes; Sonnet copies them from the document.
    if (request.model === MODEL_FOR_CLASS.haiku) return respond(request.model, [good("Regular Meeting", "Tuesday 10/14 at six", [])].map((r) => ({ fields: r.fields.map((f) => ({ ...f, quote: `invented ${f.quote}` })) })));
    return respond(request.model, GOOD_PROPOSAL);
  };
  const parser = modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 });
  const first = await parser.parse(input(), input().worker);
  assert.deepEqual(seen, [MODEL_FOR_CLASS.haiku, MODEL_FOR_CLASS.sonnet], "haiku first, one step up when nothing confirmed");
  assert.equal(first.result.verdict, "EXTRACTED");
  assert.equal(first.result.actualRowCount, 2);
  assert.equal(first.review.escalation?.from, "haiku");
  assert.equal(first.review.escalation?.to, "sonnet");
  assert.equal(quotesHoldAgainst(first.result, TEXT).ok, true);
  assert.ok(first.usd !== null && first.usd > 0, "both calls are costed");

  // What that parse learned is in the manual...
  const manual = await readFieldManual(repos, { role: "PARSER", state: "az", recordClass: "PLANNING_MEETING" });
  assert.ok(manual.projection.lines.some((l) => /PARSE_OUTCOME FAILED/.test(l) && /haiku/.test(l)));
  assert.ok(manual.projection.lines.some((l) => /PARSE_OUTCOME YIELDED/.test(l) && /sonnet/.test(l)));
  assert.ok(manual.projection.lines.some((l) => /PARSE_FIELDS/.test(l) && /location, title, when/.test(l)));

  // ...so the next agent to parse this record type routes differently.
  seen.length = 0;
  const second = await modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 }).parse({ ...input(), attemptId: "parse-2" }, input().worker);
  assert.deepEqual(seen, [MODEL_FOR_CLASS.sonnet], "the second parse skips the tier that failed here before");
  assert.equal(second.result.verdict, "EXTRACTED");
  assert.match(second.review.route.reason, /haiku failed to confirm quotes on www\.exampletonaz\.gov/);
  assert.ok(second.review.route.inheritedEntryIds.length >= 1);
  assert.equal(second.review.escalation, undefined);
});

test("no proposed field confirming is a failed extraction, never an empty document", async () => {
  const repos = createMemoryRepositories();
  const transport: ModelTransport = async (request) => respond(request.model, []);
  const out = await modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 }).parse(input(), input().worker);
  assert.equal(out.result.verdict, "FAILED");
  assert.equal(out.result.warnings[0]!.code, "ZERO_ROW_EXTRACTION");
  assert.equal(out.result.warnings[0]!.severity, "BLOCKING");
  assert.equal(out.result.actualRowCount, 0);
});

test("a response without the record_extraction call is refused, not read as prose", async () => {
  const repos = createMemoryRepositories();
  const transport: ModelTransport = async (request) => ({ model: request.model, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ records: GOOD_PROPOSAL }) }], usage: { input_tokens: 10, output_tokens: 10 } });
  const out = await modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 }).parse(input(), input().worker);
  assert.equal(out.result.verdict, "FAILED");
  assert.match(out.review.validationError ?? "", /PARSE_MODEL_NO_TOOL_CALL/);
});

test("the lane refuses a contract that already has a parsing rule", async () => {
  const withRule = { ...contract, extraction: { format: "JSON_RECORDS", rowsPointer: "/rows", fields: {} } } as GeneralizedCivicExtractionContract;
  await assert.rejects(modelParseReasoner(createMemoryRepositories(), async (r) => respond(r.model, []), () => NOW, { ceilingUsd: 100 }).parse({ ...input(), contract: withRule }, input().worker), /PARSE_MODEL_LANE_NOT_APPLICABLE/);
});
