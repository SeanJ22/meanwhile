import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { runHeldTextTranslations, type TranslationAttempt } from "../lib/translate/standing.ts";
import { runTextTranslation } from "../lib/translate/text-runtime.ts";
import { readTranslations } from "../lib/translate/publication.ts";
import { readBodyTranslations, readOfficeTranslation, readMeetingTranslation } from "../lib/translate/reader.ts";
import { translationHash, type TextTranslation } from "../lib/translate/records.ts";

const now = "2026-10-05T18:00:00Z", stateDivision = "ocd-division/country:us/state:mi";
const division = `${stateDivision}/county:birch`, bodyId = `${division}#library`;
const specs = [
  { kind: "BODY_CLASS", subjectId: "body_class:MI:library", ocdId: stateDivision, label: "Library board", text: "A library board is a body created by state law." },
  { kind: "BODY", subjectId: `body:${bodyId}`, ocdId: division, label: "Birch Library Board", text: "This board sets the library's operating budget." },
  { kind: "OFFICE", subjectId: "office:MI:library-trustee", ocdId: stateDivision, label: "Library trustee", text: "A trustee votes on the library budget." },
  { kind: "AGENDA", subjectId: "agenda:library-meeting", ocdId: division, label: "Library meeting", text: "The board will discuss a proposed new branch." },
  { kind: "MINUTES", subjectId: "minutes:library-meeting", ocdId: division, label: "Library meeting", text: "The board deferred a vote on the proposed branch." },
] satisfies { kind: TextTranslation["kind"]; subjectId: string; ocdId: string; label: string; text: string }[];
function capture(spec: typeof specs[number], extra = "") {
  const text = `${spec.label}\n${spec.text}${extra}`;
  return { evidence: { artifactId: spec.subjectId, acquiredByAttemptId: "held-source", sourceId: "Birch government",
    methodRouteId: "official-document", canonicalUrl: `https://birch.mi.gov/${spec.kind.toLowerCase()}`,
    retrievedAt: now, contentHash: `sha256-${translationHash(text)}`, text },
    observedAt: now, httpStatus: 200, partial: false, transport: "REACHABLE" as const };
}
function response(request: ModelRequest, input: unknown): ModelResponse {
  return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "translation", name: request.tools[0].name, input }],
    usage: { input_tokens: 100, output_tokens: 100 } };
}
function subject(spec: typeof specs[number], primary = capture(spec)) {
  return { ...spec, state: "MI", ...(spec.kind === "AGENDA" || spec.kind === "MINUTES" ? {
    meeting: { id: "library-meeting", bodyId, documentUrl: primary.evidence.canonicalUrl,
      documentHash: primary.evidence.contentHash.replace(/^sha256-/, "") } } : {}) };
}

test("legal class, exact body, state office, agenda and minutes publish independently through Slide and exact typed readers", async () => {
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  const attempts: TranslationAttempt[] = []; let calls = 0;
  for (const spec of specs) {
    const primary = capture(spec), sentences = [{ field: "text", text: spec.text, quote: spec.text }];
    const run = () => runHeldTextTranslations({ repos, store, now, divisions: [stateDivision, division],
      subjects: [{ subject: subject(spec, primary), sourceUrl: primary.evidence.canonicalUrl }], captures: [primary],
      attempts, saveAttempt: async row => { attempts.push(row); }, transportFor: () => async request => {
        calls++; return response(request, request.tools[0].name === "write_text_translation"
          ? { text: spec.text, sentences } : { checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) });
      } });
    const first = await run(); assert.equal(first.outcomes[0]?.status, "PUBLISHED", JSON.stringify(first));
    assert.equal(first.outcomes[0]?.usage.length, 2);
    assert.equal((await run()).outcomes[0]?.status, "REUSED");
  }
  assert.equal(calls, 10);
  const body = await readBodyTranslations({ ocdId: division, bodyId, classKey: "library" }, { store, now, bypassCache: true });
  assert.equal(body.classDefinition?.text, specs[0].text); assert.equal(body.bodyDefinition?.text, specs[1].text);
  const other = await readBodyTranslations({ ocdId: division, bodyId: "another-body", classKey: "library" }, { store, now, bypassCache: true });
  assert.equal(other.bodyDefinition, null); assert.equal(other.classDefinition?.text, specs[0].text);
  assert.equal((await readOfficeTranslation({ state: "MI", officeKey: "library-trustee" }, { store, now, bypassCache: true }))?.text, specs[2].text);
  assert.equal(await readOfficeTranslation({ state: "NH", officeKey: "library-trustee" }, { store, now, bypassCache: true }), null);
  const agenda = capture(specs[3]);
  const document = { kind: "AGENDA" as const, meetingId: "library-meeting", ocdId: division,
    documentUrl: agenda.evidence.canonicalUrl, contentHash: agenda.evidence.contentHash };
  assert.equal((await readMeetingTranslation(document, { store, now, bypassCache: true }))?.text, specs[3].text);
  assert.equal(await readMeetingTranslation({ ...document, contentHash: translationHash("revised") }, { store, now, bypassCache: true }), null);
  assert.equal(await readMeetingTranslation({ ...document, meetingId: "other-meeting" }, { store, now, bypassCache: true }), null);
  assert.equal((await readTranslations([division, stateDivision], { store, now, bypassCache: true })).length, 5);
});

test("failed independent checks retain GOOD text and both calls' charges; unchanged sources reuse and changed sources rewrite", async () => {
  const spec = specs[1], repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  let calls = 0, supported = true;
  const run = (primary = capture(spec)) => runTextTranslation({ repos, store, now,
    subject: subject(spec, primary), primary, captures: [primary], transportFor: () => async request => {
      calls++; return response(request, request.tools[0].name === "write_text_translation"
        ? { text: spec.text, sentences: [{ field: "text", text: spec.text, quote: spec.text }] }
        : { checked: [{ field: "text", text: spec.text, supported }] });
    } });
  const first = await run(); assert.equal(first.status, "PUBLISHED", JSON.stringify(first));
  assert.equal((await run()).status, "REUSED"); assert.equal(calls, 2);
  const revised = capture(spec, " The board cannot set property tax rates."); supported = false;
  const held = await run(revised); assert.equal(held.status, "HELD"); assert.equal(held.usage.length, 2);
  assert.deepEqual((await readTranslations([division], { store, now, bypassCache: true }))[0], first.record);
  supported = true; const rewritten = await run(revised); assert.equal(rewritten.status, "PUBLISHED", JSON.stringify(rewritten));
  assert.notEqual(rewritten.versionId, first.versionId);
});

test("unadmitted, conflicting, stale and partial text captures never spend; attempts persist before model calls and retain retry debt", async () => {
  const spec = specs[3], primary = capture(spec), repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  const attempts: TranslationAttempt[] = []; let calls = 0;
  const input = { repos, store, now, divisions: [division], subjects: [{ subject: subject(spec, primary), sourceUrl: primary.evidence.canonicalUrl }],
    captures: [primary], attempts, saveAttempt: async (row: TranslationAttempt) => { attempts.push(row); },
    transportFor: () => async () => { calls++; throw new Error("existing budget paused"); } };
  assert.equal((await runHeldTextTranslations({ ...input, divisions: [stateDivision] })).outcomes.length, 0);
  assert.equal((await runHeldTextTranslations({ ...input, captures: [{ ...primary, partial: true }] })).deferred.length, 1);
  assert.equal((await runHeldTextTranslations({ ...input, now: "2026-10-06T18:00:00Z" })).deferred.length, 1);
  assert.equal((await runHeldTextTranslations({ ...input, subjects: [...input.subjects, { ...input.subjects[0], sourceUrl: "https://other.mi.gov/agenda" }] })).deferred.length, 1);
  await assert.rejects(runHeldTextTranslations({ ...input, saveAttempt: async () => { throw new Error("cannot save attempt"); } }), /cannot save/);
  assert.equal(calls, 0);
  assert.equal((await runHeldTextTranslations(input)).outcomes[0]?.status, "HELD"); assert.equal(calls, 1);
  assert.equal((await runHeldTextTranslations(input)).deferred.length, 1); assert.equal(calls, 1);
});
