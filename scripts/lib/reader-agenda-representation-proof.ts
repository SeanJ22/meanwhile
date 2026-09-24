import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgendaDocuments } from "../../components/map/popup/agenda-section.tsx";
import { readSnapshot } from "../../lib/meetings/snapshot.ts";
import { agendaDocumentRepresentation, classifyAgendaPublication, readerAgendaDocuments, type ReaderAgendaDocumentProjection } from "../../lib/ask/agenda-publication.ts";
import type { AgendaDocument } from "../../lib/meetings/agenda-documents.ts";
import { agendaTopicEvidence } from "../../lib/ask/agenda-topic.ts";
import { AGENDA_TOPICS, agendaItems } from "../../lib/routing/agenda-search.ts";
import type { AskAnswerPayload } from "../../lib/ask/answer.ts";
import { meetingListingKnowledgeFor } from "../../lib/ask/meeting-knowledge.ts";
import type { MeetingListingIdentityReadback } from "../../lib/meetings/listing-identity.ts";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function agendaRepresentationProof() {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
  const { GET } = await import("../../app/api/agenda/route.ts");
  const { POST: meetingPOST } = await import("../../app/api/ask/agenda/route.ts");
  const { POST, resetGroundedState } = await import("../../app/api/ask/grounded/route.ts");
  const snapshot = readSnapshot(); assert.ok(snapshot);
  const documents = snapshot.agendaDocuments ?? [];
  const headers = { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-agenda-representation" };
  const representations = [];
  for (const meetingId of new Set(documents.map(row => row.meetingId))) {
    const held = documents.filter(row => row.meetingId === meetingId).sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt));
    // What the reader is shown: one document per distinct content, and no
    // publication-index page once the sitting's own document is held.
    const shown: ReaderAgendaDocumentProjection<AgendaDocument> = readerAgendaDocuments(held, { documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings });
    const expected: readonly AgendaDocument[] = shown.documents;
    const latest = expected[0];
    const response = await GET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(meetingId)}`));
    const raw = await response.text();
    const payload = JSON.parse(raw);
    if (latest === undefined) {
      // D1: every row held for this sitting is another body's notice page (the
      // Town of Bradford's calendar under Newbury sittings). The reader is shown
      // none of them, and the route says how many were set aside.
      assert.equal(response.status, 200);
      assert.equal(shown.anotherBodysPagesSetAside, held.length, meetingId);
      assert.equal(payload.documentCount, 0, meetingId);
      assert.deepEqual(payload.documents, [], meetingId);
      assert.deepEqual(payload.documentAccounting, {
        heldRows: held.length,
        shown: 0,
        identicalContentRows: shown.identicalContentRows,
        publicationIndexRowsSetAside: shown.publicationIndexRowsSetAside,
        anotherBodysPagesSetAside: shown.anotherBodysPagesSetAside,
        sittingSpecific: shown.sittingSpecific,
      }, meetingId);
      const listingIdentity: MeetingListingIdentityReadback = meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).readback;
      assert.deepEqual(payload.listingIdentity, listingIdentity);
      representations.push({ meetingId, heldNativeIds: held.map(row => row.id), nativeIds: [], documents: [],
        accounting: payload.documentAccounting, representation: null, setAside: "ANOTHER_BODYS_PAGES",
        acquisition: payload.publication?.acquisition ?? null, publication: payload.publication, listingIdentity,
        payloadSha256: hash(raw), returnedIds: [], countAgrees: payload.documentCount === 0, status: "PROVEN" });
      continue;
    }
    const markup = renderToStaticMarkup(createElement(AgendaDocuments, { documents: payload.documents, meetingId, agendaUrl: latest.documentUrl, agendaSentence: "", publication: payload.publication }));
    const reading = classifyAgendaPublication({ meetingId, bodyName: latest.sourceOrg, documentsForMeeting: held, documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings, now: Date.now() });
    const isPortal = reading.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX";
    const unreadable = reading.acquisition === "ACQUIRED_NOT_READABLE";
    assert.equal(response.status, 200);
    assert.equal(payload.publication.acquisition, reading.acquisition);
    assert.equal(payload.publication.revised, reading.revised);
    assert.equal(payload.documentCount, expected.length);
    assert.equal(payload.documentCount, payload.documents.length);
    assert.equal(shown.heldRows, expected.length + shown.identicalContentRows + shown.publicationIndexRowsSetAside + shown.anotherBodysPagesSetAside, meetingId);
    assert.deepEqual(payload.documentAccounting, {
      heldRows: held.length,
      shown: expected.length,
      identicalContentRows: shown.identicalContentRows,
      publicationIndexRowsSetAside: shown.publicationIndexRowsSetAside,
      anotherBodysPagesSetAside: shown.anotherBodysPagesSetAside,
      sittingSpecific: shown.sittingSpecific,
    }, meetingId);
    // Every document the route returns is reachable from what the reader sees.
    for (const document of payload.documents as { documentUrl: string }[]) {
      assert.ok(markup.includes(`href="${document.documentUrl.replaceAll("&", "&amp;")}"`), `${meetingId}: ${document.documentUrl} is returned but not linked`);
    }
    // The revision claim needs two or more distinct contents of the sitting's own document.
    assert.equal(markup.includes("a revised agenda is itself news"), reading.revised && !isPortal, meetingId);
    const listingIdentity: MeetingListingIdentityReadback = meetingListingKnowledgeFor(snapshot.meetings, [meetingId]).readback;
    assert.deepEqual(payload.listingIdentity, listingIdentity);
    assert.deepEqual(payload.documents.map((row: { contentHash: string; text: string | null }) => [row.contentHash, row.text]), expected.map(row => [row.contentHash, row.text]));
    if (isPortal || unreadable) {
      assert.equal(reading.gap?.whose, "OURS");
      assert.equal(reading.items.length, 0);
      assert.ok(!markup.includes("whitespace-pre-line"), meetingId);
      assert.ok(!markup.includes("On the docket"), meetingId);
      assert.ok(markup.includes(latest.documentUrl.replaceAll("&", "&amp;")), meetingId);
      assert.ok(markup.includes("read "), meetingId);
    }
    const legacy = await meetingPOST(new Request("https://wtp.test/api/ask/agenda", { method: "POST", headers, body: JSON.stringify({ meetingId }) }));
    const legacyPayload = await legacy.json();
    assert.equal(legacy.status, 200);
    assert.equal(legacyPayload.publication.acquisition, reading.acquisition);
    assert.deepEqual(legacyPayload.listingIdentity, listingIdentity);
    assert.deepEqual(legacyPayload.items, legacyPayload.documentSharedAcrossGovernments ? [] : reading.items);
    if (reading.documentSharedAcrossGovernments) {
      assert.equal(legacyPayload.sourceOrg, null);
      assert.ok(markup.includes("Unresolved source link"));
      assert.ok(markup.includes("not been verified as this body"));
      assert.ok(!markup.includes(`From ${latest.sourceOrg}`));
    }
    representations.push({ meetingId, heldNativeIds: held.map(row => row.id), nativeIds: expected.map(row => row.id), documents: expected,
      accounting: payload.documentAccounting,
      representation: agendaDocumentRepresentation(latest), acquisition: reading.acquisition,
      publication: payload.publication, listingIdentity, markupSha256: hash(markup), actualMarkup: markup,
      payloadSha256: hash(raw), returnedIds: payload.documents.map((row: { id: string }) => row.id),
      legacyPayload, countAgrees: payload.documentCount === expected.length, status: "PROVEN" });
  }
  const topics = [];
  for (const topic of AGENDA_TOPICS) {
    const question = `What do held meeting agendas say about ${topic.phrases[0]}?`;
    const request = { question, surface: "MAP", ocdIds: [] };
    const expected = agendaTopicEvidence({ question, documents, meetings: snapshot.meetings, scopeLabel: "the areas we cover" });
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers, body: JSON.stringify(request) }));
    const raw = await response.text();
    const payload = JSON.parse(raw) as AskAnswerPayload;
    const returned = payload.records.filter(row => row.kind === "AGENDA_MENTION");
    assert.equal(response.status, 200);
    assert.equal(payload.answer, null);
    assert.deepEqual(returned, expected.records, topic.id);
    assert.equal(payload.denominators.agendaMentionsShown, returned.length);
    assert.equal(payload.denominators.agendaMentionsFound, returned.length);
    assert.equal(payload.trace.retrieval.recordCount, payload.records.length);
    topics.push({ topic: topic.id, request, expectedRecords: expected.records, returnedRecords: returned,
      gaps: payload.gaps, denominators: payload.denominators, payloadSha256: hash(raw),
      countAgrees: true, modelAnswer: payload.answer, status: "PROVEN" });
  }
  // Source-independent negatives: a numbered menu on the same portal may not
  // become a civic item, and a real linked HTML agenda remains readable.
  const portal = documents.find(row => row.meetingId === "diligent:newburynh:3367")!;
  assert.ok(portal);
  const planted = { ...portal, text: `${portal.text}\n1. Rezoning menu navigation.\n2. Housing development search menu.` };
  const plantedReading = classifyAgendaPublication({ meetingId: planted.meetingId, bodyName: planted.sourceOrg, documentsForMeeting: [planted], documentsAcrossCorpus: [planted], now: Date.now() });
  assert.deepEqual(plantedReading.items, []);
  assert.equal(plantedReading.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
  const plantedTopic = agendaTopicEvidence({ question: "rezoning", documents: [planted], meetings: [], scopeLabel: "this body" });
  assert.deepEqual(plantedTopic.records, []);
  assert.equal(plantedTopic.denominators.agendaPortalRepresentationsHeld, 1);
  const realAgenda = { ...portal, documentUrl: "https://publisher.example/documents/agenda.html", text: "1. Public hearing on a rezoning.\n2. Adjournment." };
  assert.equal(agendaDocumentRepresentation(realAgenda), "TEXT");
  assert.ok(agendaItems(realAgenda.text).length > 0);
  for (const id of ["schedulepage:newbury-planning-board:2026-07-21", "schedulepage:newbury-planning-board:2026-08-18", "schedulepage:newbury-zoning-board-of-adjustment:2026-08-13"]) {
    const found = representations.find(candidate => candidate.meetingId === id);
    assert.ok(found && found.setAside === undefined, `${id} is a shown sitting`);
    const row = found as unknown as { representation: string; actualMarkup: string };
    assert.equal(row.representation, "TEXT");
    assert.ok(row.actualMarkup.includes("whitespace-pre-line"), id);
    assert.ok(row.actualMarkup.includes("Case"), id);
  }
  assert.equal(topics.find(row => row.topic === "rezoning")!.returnedRecords.length, 15);
  assert.equal(topics.find(row => row.topic === "housing-development")!.returnedRecords.length, 23);
  const referencePath = "tests/fixtures/reader-agenda-item-ready.json";
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as { sourceHead: string; sourceArtifactSha256: string; records: { meetingId: string; documentId: string; contentHash: string }[] };
  const heldReference = reference.records.filter(row => documents.some(document => document.meetingId === row.meetingId));
  assert.ok(heldReference.length > 60, "The independent item-ready source reference must remain substantive");
  for (const row of heldReference) {
    // The document the reader is shown first for that sitting.
    const latest: AgendaDocument = readerAgendaDocuments(documents.filter(document => document.meetingId === row.meetingId), { documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings }).documents[0]!;
    assert.equal(latest.id, row.documentId, `${row.meetingId}: changed native document needs source review`);
    assert.equal(latest.contentHash, row.contentHash, `${row.meetingId}: changed content needs source review`);
  }
  assert.deepEqual(representations.filter(row => row.acquisition === "ITEMS_READER_READY").map(row => row.meetingId).sort(), heldReference.map(row => row.meetingId).sort(), "Every still-held reviewed item-ready source must survive; newly eligible versions require an explicit reference update");
  for (const [meetingId, count] of [["legistar:pima:1804", 39], ["legistar:pima:1817", 32], ["legistar:pima:1821", 33], ["legistar:pima:1827", 28], ["schedulepage:mhrd:2026-06-15", 72], ["schedulepage:mhrd:2026-08-17", 38]] as const) {
    const found = representations.find(candidate => candidate.meetingId === meetingId);
    assert.ok(found && found.setAside === undefined, `${meetingId} is a shown sitting`);
    const row = found as unknown as { legacyPayload: { items: string[] }; actualMarkup: string };
    assert.equal(row.legacyPayload.items.length, count, meetingId);
    assert.ok(row.actualMarkup.includes(row.legacyPayload.items.at(-1)!.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;")), `${meetingId}: final item must render`);
  }
  const paths = ["data/meetings-snapshot.json", "lib/ask/agenda-publication.ts", "lib/meetings/agenda-content.ts", "lib/ask/held-agenda.ts", "lib/ask/agenda-topic.ts", "lib/ask/meeting-knowledge.ts", "lib/meetings/listing-identity.ts", "lib/routing/agenda-search.ts", "app/api/ask/grounded/route.ts", "app/api/ask/agenda/route.ts", "app/api/agenda/route.ts", "components/map/popup/agenda-section.tsx", "scripts/lib/reader-agenda-representation-proof.ts", referencePath];
  return { exactHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), executionLevel: "REAL_ROUTE_HANDLER_AND_REAL_COMPONENT_SSR", modelDisabled: true,
    sourceHashes: paths.map(path => ({ path, sha256: hash(readFileSync(path)) })),
    documentDenominator: documents.length,
    readerVisibleDocuments: representations.reduce((n, row) => n + row.nativeIds.length, 0),
    representations, topics,
    itemReadyReference: { sourceHead: reference.sourceHead, sourceArtifactSha256: reference.sourceArtifactSha256, held: heldReference, retired: reference.records.filter(row => !heldReference.includes(row)) },
    negativeControls: { numberedPortalNavigationWithheld: true, portalTopicNavigationWithheld: true, realHtmlAgendaPreserved: true, threeUnnumberedHeldAgendasPreserved: true } };
}
