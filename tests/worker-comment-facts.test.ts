import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { factDb } from "./helpers/fact-db.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { publishOwedCommentFacts } from "../lib/civic-data/worker-comment-facts.ts";
import { owedFactItems } from "../lib/civic-data/worker-publication-tasks.ts";
import { dispatchWorkerTask, evidenceProjection } from "../lib/control-plane/workers/runtime.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { readFactCommentAccess } from "../lib/facts/comment-read.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";

const RULES = { commentPeriod: "YES", commentPeriodDetail: "Call to the Public is held at every regular meeting.",
  signup: "Complete a speaker card and hand it to the Clerk before the meeting begins.", timeLimit: "3 minutes per speaker" };

/** An owed comment-rule item whose Acquirer saved an official page naming the body in Arizona, and whose Parser read its rules. */
async function owedCommentRules(rules: Record<string, string> = RULES) {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const body = prior.payload.registry.bodies.find(row => row.name && row.ocdId?.includes("/state:az"))!;
  assert.ok(body.ocdId);
  const division = new Map(prior.payload.registry.divisions.map(row => [row.ocdId, row])).get(body.ocdId);
  assert.ok(division, "the selected body has its own registered governing division");
  const text = JSON.stringify({ page: `${body.name}, Arizona: how to address the board`, records: [{ bodyName: body.name, ...rules }] });
  const fields = Object.fromEntries(["bodyName", ...Object.keys(rules)].map(field => [field, { source: `/${field}`, type: "STRING" as const }]));
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text }, plan: plan => ({ ...plan,
    jurisdiction: "AZ", ownerInstructions: ["offline-send"], publication: { contractId: "comment-access", bodyId: body.id },
    sources: plan.sources.map(route => ({ ...route, recordClass: "PUBLIC_COMMENT_RULE" })),
    contract: { ...plan.contract, schemaVersion: 2, recordClass: "PUBLIC_COMMENT_RULE", identity: { namespace: "comment-access", keyFields: ["bodyName"] },
      requiredFields: ["bodyName", "commentPeriod", "commentPeriodDetail"], extraction: { format: "JSON_RECORDS", rowsPointer: "/records", fields } } as never }) });
  for (const role of ["ACQUIRER", "PARSER"]) {
    const next = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    assert.equal((await dispatchWorkerTask(h.runtime, next.task!)).outcome, "WORKED");
  }
  const facts = await factDb();
  await facts.pg.exec(`CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE civic_data_promotions (record_class text,scope text,current_version_id text,payload jsonb,PRIMARY KEY(record_class,scope));`);
  await facts.pg.exec(readFileSync(new URL("../lib/db/migrations/R4_meeting_dependencies.sql", import.meta.url), "utf8"));
  await facts.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRATION','US-AZ:registration:v1',$1,$2::jsonb)",
    [prior.versionId, JSON.stringify({ state: "AZ", bodies: [body], divisions: [division] })]);
  const input = { repos: h.repos, facts, workItemIds: [h.item.id], now: h.now(), readHeld: async () => null,
    readCapture: async (id: string) => {
      const evidence = evidenceProjection(await h.runtime.readEvidence(id));
      return { evidence, observedAt: evidence.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
    } };
  return { h, body, facts, input };
}

/** The job's results as a parser that wrote values the saved page does not hold would have left them. */
function withParserRecords(repos: ControlPlaneRepositories, change: (fields: Record<string, unknown>) => Record<string, unknown>, unquoted: readonly string[]): ControlPlaneRepositories {
  const alter = (row: WorkerResultRecord): WorkerResultRecord => row.result.role !== "PARSER" ? row : { ...row, result: { ...row.result,
    records: row.result.records.map(r => ({ ...r, fields: change(r.fields) as typeof r.fields })), spans: row.result.spans.filter(span => !unquoted.includes(span.field)) } };
  const log = repos.workerResults;
  return { ...repos, workerResults: { ...log, read: async key => (await log.read(key)).map(alter),
    ...(log.readKeys ? { readKeys: async (keys: readonly string[]) => new Map([...(await log.readKeys!(keys))].map(([key, rows]) => [key, rows.map(alter)])) } : {}) } };
}

test("an owed comment-rule extraction publishes each rule as a live fact citing its saved page, and a rerun reuses the receipt", async () => {
  const { h, body, facts, input } = await owedCommentRules();
  const results = await h.repos.workerResults.read(h.item.id);
  let identityReads = 0;
  const scoped = { ...input, facts: { ...facts, query: async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("civic_meeting_dependencies")) {
      identityReads++;
      assert.deepEqual(params, [body.id]);
      assert.doesNotMatch(sql, /jsonb_array_elements|civic_data_payload_parts/);
    }
    return facts.query(sql, params);
  } } };
  const [published] = await publishOwedCommentFacts(scoped);
  assert.equal(identityReads, 1, "state registration alone supplies this body's current identity");
  assert.equal(published!.outcome.status, "PUBLISHED", JSON.stringify(published));
  assert.equal(published!.outcome.code, "VERIFIED_RESULT_PUBLISHED");
  assert.deepEqual(published!.outcome.records, { added: 4, changed: 0, reused: 0 });
  const parser = results.find(row => row.result.role === "PARSER")!.result as { readonly artifactId: string };
  assert.equal(published!.outcome.sourceArtifactId, parser.artifactId, "the outcome names the saved page it was read from");
  assert.deepEqual((await h.repos.workItems.mustRead(h.item.id)).value.publicationOutcome, published!.outcome, "Admin sees the same outcome");
  const [rules] = await readFactCommentAccess(facts.query, [body.id]);
  assert.ok(rules, "readers see the body's comment rules");
  assert.deepEqual([rules.bodyId, rules.commentPeriod, rules.commentPeriodDetail, rules.signup, rules.timeLimit, rules.writtenComment, rules.attend],
    [body.id, "YES", RULES.commentPeriodDetail, RULES.signup, RULES.timeLimit, null, null]);
  assert.equal(rules.sourceUrl, FIXTURE_URL);
  assert.deepEqual(Object.keys(rules.fieldSources!).sort(), ["commentPeriod", "commentPeriodDetail", "signup", "timeLimit"]);
  for (const [field, source] of Object.entries(rules.fieldSources!)) {
    assert.equal(source!.sourceUrl, FIXTURE_URL, `${field} cites the saved page`);
    assert.ok(source!.quote, `${field} carries the page's own words`);
  }
  assert.match(rules.fieldSources!.timeLimit!.quote!, /3 minutes per speaker/);
  assert.deepEqual(await facts.query("SELECT entity_id, field, reason FROM blank"), []);
  const count = async () => Number((await facts.query("SELECT count(*)::int AS n FROM fact"))[0]!.n);
  assert.equal(await count(), 4);
  assert.deepEqual(await publishOwedCommentFacts(scoped), [published], "a restart reuses the durable publication outcome");
  assert.equal(identityReads, 1, "reusing the saved outcome does not reread registry identities");
  assert.equal(await count(), 4, "no duplicate facts");
});

test("the runner's normal pass offers an owed comment-rule extraction once, and not again after it publishes", async () => {
  const { h, input } = await owedCommentRules();
  const owed = async () => owedFactItems([(await h.repos.workItems.mustRead(h.item.id)).value], await h.repos.workerResults.read(h.item.id), h.now());
  assert.deepEqual(await owed(), { rosters: [], comments: [h.item.id] });
  await publishOwedCommentFacts(input);
  assert.deepEqual(await owed(), { rosters: [], comments: [] });
});

test("a rule whose words are not on the saved page stays a blank with its reason, and the rest still publish", async () => {
  const { h, body, facts, input } = await owedCommentRules();
  const repos = withParserRecords(h.repos, fields => ({ ...fields, writtenComment: "Email the board at any time." }), ["writtenComment"]);
  const [published] = await publishOwedCommentFacts({ ...input, repos });
  assert.equal(published!.outcome.status, "PARTIALLY_PUBLISHED", JSON.stringify(published));
  assert.match(published!.outcome.detail, /1 stay open as blanks with their reasons/);
  assert.deepEqual(await facts.query("SELECT entity_id, field, stage, reason FROM blank"),
    [{ entity_id: body.id, field: "comment:written", stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
  const [rules] = await readFactCommentAccess(facts.query, [body.id]);
  assert.equal(rules!.writtenComment, null, "readers never see the unproved rule");
  assert.equal(rules!.timeLimit, RULES.timeLimit);
});

test("an extraction none of whose rules are on the saved page is held, every rule left a blank", async () => {
  const { h, body, facts, input } = await owedCommentRules();
  const unquoted = ["commentPeriod", "commentPeriodDetail", "signup", "timeLimit"];
  const repos = withParserRecords(h.repos, fields => ({ ...fields, commentPeriodDetail: "The board welcomes comment.", signup: "Sign in at the door.", timeLimit: "Five minutes" }), unquoted);
  const [held] = await publishOwedCommentFacts({ ...input, repos });
  assert.deepEqual([held!.outcome.status, held!.outcome.code, held!.outcome.recovery], ["HELD", "COMMENT_FACTS_BLANK", "WORKER"]);
  assert.deepEqual(held!.outcome.records, { added: 0, changed: 0, reused: 0 });
  const blanks = await facts.query("SELECT field, stage, reason FROM blank ORDER BY field");
  assert.deepEqual(blanks.map(row => row.field), ["comment:detail", "comment:period", "comment:signup", "comment:time_limit"]);
  assert.ok(blanks.every(row => row.stage === "CHECK" && row.reason === "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY"));
  assert.deepEqual(await readFactCommentAccess(facts.query, [body.id]), []);
});
