import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bodyRenderProof } from "./reader-body-render-proof.ts";
import { floored } from "../../lib/ops/denominator-floor.ts";
import { readReaderEvidence, readerSourceFingerprint, sourceRenewalCaseProblems, inspectReaderMarkup,
  packReaderEvidence, sha256, type ReaderCensus, type ReaderClosureReceipt, type ReaderComponentCase, type ReaderSourceHash } from "../../lib/holdings/reader-census.ts";
import type { EvidenceRecord } from "../../lib/ask/evidence.ts";
import type { BodyConfirmation } from "../../lib/ask/body-confirmation.ts";
import { readAskAnswer, type AskAnswerPayload } from "../../lib/ask/answer.ts";
import {
  readSnapshot,
  type ReaderProofMeetingsExpectedAuthority,
} from "../../lib/meetings/snapshot.ts";
import { canonicalBodyIdentity, type CanonicalBodyIdentity } from "../../lib/ask/body-identity.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import type { AgendaDocument } from "../../lib/meetings/agenda-documents.ts";
import { nameAReaderCanSay } from "../../lib/routing/named-entity.ts";
import { classifyAgendaPublication } from "../../lib/ask/agenda-publication.ts";

/** Scoped current-source execution, consumed by the existing finalizer. No
 * census, acquisition, model, worker or production-control-plane operation. */
export async function executeV94ReaderSourceProof(options: {
  root: string; exactHead: string; output: string; preparedCensusPath: string; visualPath: string;
  meetingAuthority: ReaderProofMeetingsExpectedAuthority;
}) {
  const { root, exactHead } = options;
  const census = JSON.parse(readFileSync(options.preparedCensusPath, "utf8")) as ReaderCensus;
  const receipt = JSON.parse(readReaderEvidence(root, "docs/evidence/reader-last-mile-final-closure-receipt.json").toString("utf8")) as ReaderClosureReceipt;
  assert.equal(census.holdingsDigest, receipt.holdingsDigest);
  assert.equal(census.registrySha256, receipt.registrySha256);
  const sourceHashes = readerSourceFingerprint(root);
  const current = new Map(sourceHashes.map(source => [source.path, source.sha256]));
  const prior = new Map(receipt.sourceHashes.map(source => [source.path, source.sha256]));
  for (const equivalent of receipt.sourceEolEquivalences ?? []) prior.set(equivalent.path, equivalent.canonicalLfSha256);
  const removedSourceHashes = [...prior].filter(([path]) => !current.has(path)).map(([path, sha256]) => ({ path, sha256 }));
  const inputs: ReaderSourceHash[] = [];
  const input = <T>(path: string): T => {
    const bytes = readReaderEvidence(root, path);
    inputs.push({ path, sha256: sha256(bytes) });
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  assert.equal(sha256(readReaderEvidence(root, receipt.censusPath)), receipt.censusSha256);
  const closedCensus = input<ReaderCensus>(receipt.censusPath);
  const visual = input<{ exactHead: string; sourceHashes: ReaderSourceHash[]; buildId?: string; results: unknown[]; failures: string[] }>(options.visualPath);
  assert.equal(visual.exactHead, exactHead, "Visual observations must name this committed execution head");
  assert.deepEqual(visual.sourceHashes, sourceHashes, "Visual observations must bind the complete current reader graph");
  assert.deepEqual(visual.failures, []);
  assert.ok(visual.results.length, "A current compact browser proof is required");
  if (visual.buildId) assert.equal(visual.buildId, readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim());

  // SSR checks civic content, not CSS paint. Mapbox-free actual leaves load
  // module class keys here; actual style/geometry is proved by the browser input.
  const moduleApi = await import("node:module") as unknown as {
    registerHooks: (hooks: { load: (url: string, context: unknown, next: (url: string, context: unknown) => unknown) => unknown }) => { deregister: () => void };
  };
  moduleApi.registerHooks({ load(url, context, next) {
    if (!url.endsWith(".module.css")) return next(url, context);
    const css = readFileSync(fileURLToPath(url), "utf8");
    const names = [...new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(match => match[1]))];
    return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(Object.fromEntries(names.map(name => [name, name])))};` };
  } });

  const registry = input<{ divisions: { ocdId: string; divisionType: string; state: string }[] }>("lib/registry/registry.json");
  input("data/meetings-snapshot.json");
  const divisions = new Map(registry.divisions.map(division => [division.ocdId, division]));
  const seen = new Set<string>();
  const holdingValues = new Map<string, unknown>();
  const selected = census.records.filter(record => {
    if (record.family !== "registry" || record.unit !== "divisions" || record.eligibility.state !== "READER_ELIGIBLE") return false;
    if (!holdingValues.has(record.holdingPath)) holdingValues.set(record.holdingPath, JSON.parse(readFileSync(join(root, record.holdingPath), "utf8")));
    let raw = holdingValues.get(record.holdingPath);
    for (const key of record.pointer.split("/").slice(1)) raw = (raw as Record<string, unknown> | undefined)?.[key.replaceAll("~1", "/").replaceAll("~0", "~")];
    if ((raw as { officeholderId?: string } | undefined)?.officeholderId) return false;
    const division = record.canonicalIdentity.map(id => divisions.get(id)).find(Boolean);
    if (!division || !["cd", "sldu", "sldl", "county", "place", "school_district"].includes(division.divisionType)) return false;
    const key = `${division.state}:${division.divisionType}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  assert.ok(selected.length);
  const bodies = await bodyRenderProof(root, { ...census, records: selected }, options.meetingAuthority);
  assert.deepEqual(bodies.failures, []); assert.deepEqual(bodies.unsupported, []);
  const cases: ReaderComponentCase[] = [...bodies.cases];
  const { AskAnswerRecords } = await import("../../components/ask/answer-records.tsx");
  const { AskBodyConfirmation } = await import("../../components/ask/body-confirmation.tsx");
  const { PopupCard } = await import("../../components/map/popup/popup-card.tsx");
  const add = (auditId: string, component: string, payload: unknown, identities: string[], markup: string, expectedFragments: string[], rowCounts: ReaderComponentCase["rowCounts"]) => {
    cases.push({ auditId, component, componentSha256: sha256(readFileSync(join(root, component))),
      selector: "V94 unchanged canonical holding → current actual reader execution", actualCanonicalIdentities: identities,
      payloadSha256: sha256(JSON.stringify(payload)), markup, markupSha256: sha256(markup), expectedFragments,
      forbiddenFragments: [], rowCounts, failures: inspectReaderMarkup(markup, expectedFragments, [], rowCounts) });
  };

  // Generic record rendering did not change retrieval for other question
  // classes. Re-render one previously proved native record per kind and every
  // already-held measure summary, preserving that independent corpus proof.
  const byKind = new Map<string, EvidenceRecord>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(collect); return; }
    const row = value as Record<string, unknown>;
    if (Array.isArray(row.returnedRecords)) for (const record of row.returnedRecords as EvidenceRecord[]) {
      if (record.kind === "CONTACT" || !record.id || typeof record.text !== "string") continue;
      const key = record.kind === "MEASURE_SUMMARY" ? `${record.kind}:${record.id}` : record.kind;
      if (!byKind.has(key)) byKind.set(key, record);
    }
    Object.values(row).forEach(collect);
  };
  for (const entry of receipt.evidenceHashes.filter(entry => /ask.*\.json$/.test(entry.path))) {
    assert.equal(sha256(readReaderEvidence(root, entry.path)), entry.sha256);
    collect(input(entry.path));
  }
  assert.ok(byKind.size && [...byKind.values()].some(record => record.kind === "MEASURE_SUMMARY"));
  const recordsBefore = cases.length;
  for (const [key, record] of byKind) for (const initiallyOpen of [true, false]) {
    const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records: [record], initiallyOpen }));
    add(`v94:record:${key}:${initiallyOpen}`, "components/ask/answer-records.tsx", record, [record.id], markup,
      [record.id, record.text, ...(record.sourceUrl ? [record.sourceUrl] : []), ...(record.sourceOrg ? [record.sourceOrg] : [])], { records: { expected: 1, actual: [...markup.matchAll(/data-ask-record-id=/g)].length } });
  }
  const mixed = [...byKind.values()];
  for (const initiallyOpen of [true, false]) {
    const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records: mixed, initiallyOpen }));
    if (initiallyOpen) {
      assert.ok(markup.indexOf("data-ask-measure-summary") < markup.indexOf("<details"));
      assert.ok(!markup.includes('open=""'));
    }
    add(`v94:record:all-classes:${initiallyOpen}`, "components/ask/answer-records.tsx", mixed, mixed.map(record => record.id), markup,
      mixed.flatMap(record => [record.id, record.text]), { records: { expected: mixed.length, actual: [...markup.matchAll(/data-ask-record-id=/g)].length } });
  }
  const inheritedRecordCases = cases.length - recordsBefore;

  // Changed naming/agenda paths execute the current POST handler with every
  // network call forbidden. Questions use canonical held records, not a model.
  for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const routeChecks: { question: string; payload: AskAnswerPayload }[] = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("V94 reader source proof forbids network access"); };
  try {
    const ask = async (question: string, confirmation?: BodyConfirmation) => {
      resetGroundedState();
      const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST",
        headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "v94-source-renewal" },
        body: JSON.stringify({ question, confirmation, surface: "MAP", ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/school_district:sunnyside_unified_district"] }) }));
      assert.equal(response.status, 200);
      const payload = readAskAnswer(await response.json()); assert.ok(payload);
      assert.equal(payload.trace.interpretation.ran, false); assert.equal(payload.trace.synthesis.ran, false);
      routeChecks.push({ question, payload });
      if (payload.confirmation) {
        assert.equal(payload.subject, null); assert.equal(payload.answer, null);
        assert.equal(payload.records.length, 0); assert.equal(payload.candidates, undefined);
        const markup = renderToStaticMarkup(createElement(AskBodyConfirmation, { answer: payload, working: false, onConfirm() {}, onClarify() {} }));
        add(`v94:confirmation:${routeChecks.length}`, "components/ask/body-confirmation.tsx", payload,
          [payload.confirmation.bodyId], markup, [`Did you mean ${payload.confirmation.name}?`], { suggestion: { expected: 1, actual: [...markup.matchAll(/data-ask-body-confirmation=/g)].length } });
      } else if (payload.records.some(record => record.kind !== "CONTACT")) {
        const records = payload.records.filter(record => record.kind !== "CONTACT");
        for (const initiallyOpen of [true, false]) {
          const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records: payload.records, initiallyOpen, agendaLead: payload.agendaLead, prose: payload.agendaLead ? "Optional explanation follows held agenda records." : null }));
          if (payload.agendaLead) assert.ok(markup.indexOf("data-ask-agenda-lead") < markup.indexOf("Optional explanation"));
          add(`v94:route:${routeChecks.length}:${initiallyOpen}`, "components/ask/answer-records.tsx", payload,
            records.map(record => record.id), markup, records.flatMap(record => [record.id, record.text]),
            { records: { expected: records.length, actual: [...markup.matchAll(/data-ask-record-id=/g)].length } });
        }
      }
      return payload;
    };
    const vail = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
    for (const question of ["What's on the Vail school district agenda?", "What's on the Vail Unified District agenda?"]) assert.equal((await ask(question)).subject?.id, vail);
    for (const question of ["What's on the Vial school district agenda?", "What's on the VUSD agenda?"]) {
      const pending = await ask(question); assert.equal(pending.confirmation?.bodyId, vail);
      const confirmed = await ask(question, pending.confirmation);
      assert.equal(confirmed.subject?.id, vail); assert.equal(confirmed.trace.resolution.basis, "READER_CONFIRMATION");
      assert.ok(confirmed.records.every(record => !record.bodyId || record.bodyId === vail));
      assert.equal((await ask(question, { ...pending.confirmation!, bodyId: "unrelated:nearby" })).subject, null);
    }
    const unknown = await ask("What's on the Fictional Nonexistent school district agenda?");
    assert.equal(unknown.mode, "CLARIFY"); assert.equal(unknown.subject, null); assert.equal(unknown.records.length, 0); assert.ok(unknown.clarification);
    const snapshot = readSnapshot(); assert.ok(snapshot);
    for (const divisionType of ["school_district", "county"]) {
      const meeting: Meeting | undefined = snapshot.meetings.find(meeting => canonicalBodyIdentity(meeting.bodyId ?? "")?.divisionType === divisionType && classifyAgendaPublication({ bodyName: meeting.bodyName, meetingId: meeting.id,
        documentsForMeeting: snapshot.agendaDocuments.filter(document => document.meetingId === meeting.id), documentsAcrossCorpus: snapshot.agendaDocuments, meetingsAcrossCorpus: snapshot.meetings, now: Date.now() }).acquisition === "ITEMS_READER_READY");
      assert.ok(meeting);
      const body: CanonicalBodyIdentity = canonicalBodyIdentity(meeting.bodyId!)!;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: meeting.timeZone ?? "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(meeting.startsAt));
      const answer = await ask(`What's on the ${nameAReaderCanSay(body.name, body.divisionLabel)} agenda on ${day}?`);
      assert.equal(answer.subject?.id, body.bodyId); assert.equal(answer.agendaLead, true);
      assert.ok(answer.records.every(record => !record.bodyId || record.bodyId === body.bodyId));
      const held: AgendaDocument[] = snapshot.agendaDocuments.filter(document => document.meetingId === meeting.id);
      assert.deepEqual(answer.records.filter(record => record.kind === "AGENDA_DOCUMENT" && record.meetingId === meeting.id).map(record => record.documentId).sort(), held.map(document => document.id).sort());
    }
    assert.match((await ask("Explain Prop 141 to me")).subject?.name ?? "", /141/);
    assert.match((await ask("What did Katie Hobbs do for Arizona in the last 12 months?")).subject?.name ?? "", /Katie Hobbs/);
  } finally { globalThis.fetch = savedFetch; }

  const record = [...byKind.values()][0];
  for (const tier of ["local", "state", "national"] as const) for (const minimize of [false, true]) {
    const props = { tier, type: "Government", title: record.id, onClose() {}, ...(minimize ? { onMinimize() {} } : {}), children: createElement("p", null, record.text) };
    const markup = renderToStaticMarkup(createElement(PopupCard, props));
    assert.equal(markup.includes("popup-minimize-btn"), minimize);
    add(`v94:popup:${tier}:${minimize}`, "components/map/popup/popup-card.tsx", record, [record.id], markup, [record.id, record.text], { content: { expected: 1, actual: [...markup.matchAll(/<p>/g)].length } });
  }
  const failures = sourceRenewalCaseProblems(cases);
  assert.deepEqual(failures, []);
  assert.deepEqual(readerSourceFingerprint(root), sourceHashes, "Reader source changed during execution");
  const counts = { district: bodies.cases.length, inheritedRecordCases, freshAskRequests: routeChecks.length,
    freshAskRenderCases: cases.length - bodies.cases.length - inheritedRecordCases - 6, popup: 6,
    currentVisualObservations: visual.results.length, inheritedCanonicalRows: closedCensus.rows.length,
    inheritedRenderedRows: closedCensus.rows.filter(row => row.deliveryState === "RENDERED").length,
    removedDependencies: removedSourceHashes.length };
  const denominator = floored("V94 source renewal cases", "affected district and popup classes, preserved record classes and fresh Ask routing/agenda renders", cases.length, cases.length);
  writeFileSync(options.output, `${JSON.stringify({ exactHead, sourceHashes, removedSourceHashes, inputs, cases, failures, denominator, counts, routeChecks,
    scope: "Current product SSR plus independently bound actual browser visual observations; unchanged canonical rows and unrelated ballot DOM proof inherited. CSS module keys in SSR are not a CSS rendering assertion." }, null, 2)}\n`);
  packReaderEvidence(root, options.output);
  return { output: options.output, cases: cases.length, ...counts };
}
