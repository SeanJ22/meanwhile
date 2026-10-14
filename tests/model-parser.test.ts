import assert from "node:assert/strict";
import test from "node:test";
import { contentHash } from "../lib/control-plane/ids.ts";
import { readFieldManual, writeFieldManual, type FieldManualStore } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import type { ModelRequest, ModelResponse, ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MODEL_FOR_CLASS } from "../lib/control-plane/scheduler/model-routing.ts";
import { documentWindows, modelParseReasoner, ModelParseFailure, parseLearningEntries, routeParse } from "../lib/control-plane/workers/model-parser.ts";
import { auditLearningEntries } from "../lib/control-plane/workers/audit-sampling.ts";
import { confirmQuotedRecords, isQuotedExtraction, quotedSourceFindings, quotesHoldAgainst } from "../lib/control-plane/workers/quoted-proof.ts";
import { validateGeneralizedExtraction } from "../lib/control-plane/workers/generalized-validator.ts";
import { outsideRecordBlockBriefs } from "../lib/control-plane/workers/record-block.ts";
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
function readEmpty(): FieldManualStore { return { entries: [] }; }
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
  assert.deepEqual(first.review.byModel?.map(s=>s.tier), ["haiku", "sonnet"]);
  assert.equal(first.review.byModel?.reduce((n,s)=>n+(s.usd??0),0),first.usd);
  assert.equal(first.review.byModel?.reduce((n,s)=>n+s.requestCount,0),2);

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

test("a failed window waits for answered windows and preserves their paid tier shares without retrying", async () => {
  let calls = 0;
  const longInput = input();
  const text = TEXT + "\n" + "x".repeat(25_000);
  const evidence = { ...longInput.evidence, text, contentHash: contentHash(text) };
  const parser = modelParseReasoner(createMemoryRepositories(), async request => {
    calls++;
    if (calls === 1) throw new Error("HTTP 503");
    await new Promise(resolve => setTimeout(resolve, 10));
    return respond(request.model, GOOD_PROPOSAL);
  }, () => NOW, { ceilingUsd: 100 });
  await assert.rejects(parser.parse({ ...longInput, evidence }, longInput.worker), (error: unknown) => {
    assert.ok(error instanceof ModelParseFailure);
    assert.equal(error.accounting.byModel.length, 2);
    assert.ok(error.accounting.byModel.some(share => share.tier === "haiku" && share.usd !== null && share.usd > 0));
    assert.ok(error.accounting.byModel.some(share => share.requestCount === 1 && share.usd === null));
    assert.equal(error.accounting.usd, null, "unanswered usage remains unknown alongside known paid shares");
    return true;
  });
  assert.equal(calls, 2, "the same failed request is never resent or escalated");
});

test("an audit that breaks a model-parsed publisher sends the next parse one tier up", async () => {
  const repos = createMemoryRepositories();
  const seen: string[] = [];
  const transport: ModelTransport = async (request: ModelRequest) => { seen.push(request.model); return respond(request.model, GOOD_PROPOSAL); };
  const first = await modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 }).parse(input(), input().worker);
  assert.equal(first.review.tier, "haiku");
  assert.deepEqual(seen, [MODEL_FOR_CLASS.haiku]);

  // A sampled audit finds a record the saved document does not support.
  const broke = { role: "ADVERSARIAL_AUDITOR" as const, attemptId: "a", producerAttemptId: "p", validatorAttemptId: "v", verdict: "BROKE" as const, startedFrom: [], attacks: [],
    findings: [{ code: "QUOTE_NOT_IN_DOCUMENT", detail: "gone", severity: "BLOCKING" as const, recordId: first.result.records[0]!.id }],
    artifactIds: ["art-agenda"], survivingRecordCount: 1, survivingRecordIds: [first.result.records[1]!.id], brokenRecordIds: [first.result.records[0]!.id], reopenRequired: true };
  const learned = auditLearningEntries({ result: broke, auditResultId: "wr-x", modelReviewed: true, contract, parser: { modelParse: first.review }, observedAt: NOW });
  assert.deepEqual(learned.map((e) => e.kind).sort(), ["AUDIT_STRATUM", "PARSE_OUTCOME"]);
  assert.equal(learned.find((e) => e.kind === "AUDIT_STRATUM")!.outcome, "FAILED");
  await writeFieldManual(repos, learned, NOW);

  seen.length = 0;
  const second = await modelParseReasoner(repos, transport, () => NOW, { ceilingUsd: 100 }).parse({ ...input(), attemptId: "parse-2" }, input().worker);
  assert.deepEqual(seen, [MODEL_FOR_CLASS.sonnet], "the next Parser reads what the Auditor wrote and starts a tier up");
  assert.match(second.review.route.reason, /haiku failed to confirm quotes on www\.exampletonaz\.gov/);
});

for (const [shape, text] of Object.entries({
  table: '<table><tr><td>Alice Adams</td><td>Clerk</td><td>alice@example.test</td></tr><tr><td>Bob Brown</td><td>Treasurer</td><td>bob@example.test</td></tr></table>',
  columns: '<div class="roster"><div class="person-card"><p>Alice Adams</p><p>Clerk</p><p>alice@example.test</p></div><div class="person-card"><p>Bob Brown</p><p>Treasurer</p><p>bob@example.test</p></div></div>',
  nestedCards: '<div class="person-card"><div class="person-name">Alice Adams</div><p>Clerk</p><p>alice@example.test</p></div><div class="person-card"><div class="person-name">Bob Brown</div><p>Treasurer</p><p>bob@example.test</p></div>',
  tableColumns: '<table><tr><td>Alice Adams<br>Clerk<br>alice@example.test</td><td>Bob Brown<br>Treasurer<br>bob@example.test</td></tr></table>',
  paragraphs: 'Alice Adams, Clerk, alice@example.test\n\nBob Brown, Treasurer, bob@example.test',
  list: '<ul><li>Alice Adams, Clerk, alice@example.test</li><li>Bob Brown, Treasurer, bob@example.test</li></ul>',
})) {
  test(`CP-19: ${shape} fields belong to the named person during extraction and replay`, () => {
    const source = { ...evidence, text, contentHash: contentHash(text) };
    const roster = { ...contract, recordClass: "OFFICIAL_ROSTER", requiredFields: ["name", "office"], identity: { namespace: "test:roster", keyFields: ["name"] } };
    const field = (name: string, value: string) => ({ name, value, quote: value });
    const proposals = [{ windowStart: 0, fields: [field("email", "bob@example.test"), field("name", "Alice Adams"), field("office", "Clerk")] },
      { windowStart: 0, fields: [field("name", "Bob Brown"), field("office", "Treasurer"), field("email", "bob@example.test")] }];
    const result = confirmQuotedRecords({ evidence: source, contract: roster }, proposals);
    assert.equal(result.records.length, 2, "the minimum facts still publish for both people");
    assert.equal(result.records[0].fields.email, undefined, "Alice never acquires Bob's email");
    assert.equal(result.records[1].fields.email, "bob@example.test");
    assert.ok(result.rejections.some(item => item.code === "FIELD_OUTSIDE_RECORD_BLOCK" && item.field === "email"));
    assert.ok(result.warnings.some(item => item.detail.includes(source.artifactId) && item.detail.includes("bob@example.test")), "retain the quoted finding for investigation");
    assert.equal(quotesHoldAgainst(result, text).ok, true);
    const bobEmail = result.spans.find(span => span.field === "email")!;
    const forged = { records: [{ ...result.records[0], fields: { ...result.records[0].fields, email: "bob@example.test" }, evidenceSpanIds: [...result.records[0].evidenceSpanIds, bobEmail.id] }], spans: result.spans };
    assert.ok(quotesHoldAgainst(forged, text).failures.some(failure => failure.field === "email"), "replay rejects the old parser's cross-row result");
    const brief = outsideRecordBlockBriefs(result.warnings);
    assert.equal(brief.length, 1, "the dropped field goes to a detective as one finding (DP-03)");
    assert.match(brief[0], /Field email for "Alice Adams" was dropped because the value "bob@example\.test" sits outside that person's own record/);
    assert.ok(brief[0].includes(source.canonicalUrl), "the detective is told which page to reread");
  });
}

test("CP-19: only dropped cross-row fields make a brief line, and the brief stays bounded", () => {
  assert.deepEqual(outsideRecordBlockBriefs([{ code: "DUPLICATE_SOURCE_RECORD_ID", detail: "x" }]), []);
  assert.match(outsideRecordBlockBriefs([{ code: "FIELD_OUTSIDE_RECORD_BLOCK", detail: "not json", field: "phone" }])[0], /^Field phone was dropped because its value/);
  const many = Array.from({ length: 30 }, (_, i) => ({ code: "FIELD_OUTSIDE_RECORD_BLOCK", detail: JSON.stringify({ name: `Person ${i}`, value: `v${i}` }), field: "email" }));
  assert.equal(outsideRecordBlockBriefs(many).length, 20, "the brief stays bounded");
});


test("CP-19: a wrapped name retains the same record's fields and exact source offsets", () => {
  const text = "Alice\nAdams, Clerk, alice@example.test\n\nBob Brown, Treasurer, bob@example.test";
  const source = { ...evidence, text, contentHash: contentHash(text) };
  const roster = { ...contract, recordClass: "OFFICIAL_ROSTER", requiredFields: ["name", "office"], identity: { namespace: "test:roster", keyFields: ["name"] } };
  const result = confirmQuotedRecords({ evidence: source, contract: roster }, [{ windowStart: 0, fields: [
    { name: "name", value: "Alice Adams", quote: "Alice\nAdams" },
    { name: "office", value: "Clerk", quote: "Clerk" },
    { name: "email", value: "alice@example.test", quote: "alice@example.test" },
  ] }]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].fields.email, "alice@example.test");
  assert.equal(quotesHoldAgainst(result, text).ok, true);
});
