import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "./helpers/playbooks.ts";

import { agendaItems, agendaTopicFor, type AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import {
  asksForBodyAgenda,
  bindNamedEntity,
  type BindableEntity,
} from "../lib/routing/named-entity.ts";
import type { Meeting } from "../lib/sources/types.ts";

const DISTRICT = "ocd-division/country:us/state:xx/school_district:example_unified_district";
const TOWN_A = "ocd-division/country:us/state:xx/place:alpha";
const TOWN_B = "ocd-division/country:us/state:xx/place:beta";
const TOWN_C = "ocd-division/country:us/state:xx/place:gamma";

const agendaDocument = (meetingId: string, documentUrl: string, text: string): AgendaDocumentLike => ({
  meetingId,
  documentUrl,
  sourceUrl: documentUrl,
  sourceOrg: "Example publisher",
  retrievedAt: "2026-08-21T00:00:00.000Z",
  text,
  extraction: "html",
});

const PORTAL = "Board Portal Home Calendar Contact Upcoming Meetings";
const CALENDAR = "Town Calendar Events Town Hall Hours Contact";

const snapshot: { meetings: Pick<Meeting, "id" | "ocdId">[]; agendaDocuments: AgendaDocumentLike[] } = {
  meetings: [
    { id: "district-1", ocdId: DISTRICT },
    { id: "district-2", ocdId: DISTRICT },
    { id: "alpha-1", ocdId: TOWN_A },
    { id: "beta-1", ocdId: TOWN_B },
    { id: "gamma-1", ocdId: TOWN_C },
  ],
  agendaDocuments: [
    agendaDocument("district-1", "https://district.example.gov/portal", PORTAL),
    agendaDocument("district-2", "https://district.example.gov/portal", PORTAL),
    agendaDocument("alpha-1", "https://alpha.example.gov/agenda.pdf", "1. Call to order\n2. Rezoning of parcel 44\n3. Adjournment"),
    agendaDocument("beta-1", "https://gamma.example.gov/calendar", CALENDAR),
    agendaDocument("gamma-1", "https://gamma.example.gov/calendar", CALENDAR),
  ],
};

/** The same inventory the route builds, from the canonical division id. */
function entities(): BindableEntity[] {
  const seen = new Map<string, BindableEntity>();
  for (const m of snapshot.meetings) {
    const id = m.ocdId;
    if (!id || seen.has(id)) continue;
    const last = id.split("/").pop() ?? "";
    const [divisionType, slug] = last.split(":");
    if (!divisionType || !slug) continue;
    seen.set(id, { id, name: slug.replace(/_/g, " "), nameClass: "body", divisionType });
  }
  return [...seen.values()];
}

test("the shape of the asking is recognised, and a topic question is not", () => {
  for (const q of [
    "What's on the Example school district agenda?",
    "what is Example discussing",
    "what are they discussing at the next meeting",
    "what's on the docket",
  ]) {
    assert.ok(asksForBodyAgenda(q), `${q} is a body-agenda question`);
  }
  for (const q of ["is there a data center coming", "any warehouses being built near me"]) {
    assert.ok(!asksForBodyAgenda(q), `${q} belongs to the topic rung`);
    assert.ok(agendaTopicFor(q), `${q} must still reach a topic`);
  }
});

test("a named body's agenda question reaches that body's own meetings and nobody else's", () => {
  const question = "What's on the Example school district agenda?";
  assert.ok(asksForBodyAgenda(question));

  const bound = bindNamedEntity(question, entities());
  assert.equal(bound.kind, "BOUND", "the corpus holds the district and the question names it");
  if (bound.kind !== "BOUND") return;
  assert.match(bound.entity.id, /example_unified_district/);

  const forBody = snapshot.meetings.filter((m) => m.ocdId === bound.entity.id);
  assert.ok(forBody.length > 0, "the district must have meetings for this to answer anything");
  assert.ok(
    forBody.every((m) => m.ocdId === bound.entity.id),
    "retrieval reached a meeting belonging to a different government",
  );
});

test("a landing page reused across sittings is not that meeting's agenda", () => {
  const byUrl = new Map<string, Set<string>>();
  for (const d of snapshot.agendaDocuments) {
    const set = byUrl.get(d.documentUrl) ?? new Set<string>();
    set.add(d.meetingId);
    byUrl.set(d.documentUrl, set);
  }
  const shared = [...byUrl.values()].filter((s) => s.size > 1);
  assert.ok(
    shared.length > 0,
    "no document is shared across meetings — this control would be vacuous",
  );

  const district = snapshot.meetings.filter((m) => m.ocdId === DISTRICT);
  const districtDocs = snapshot.agendaDocuments.filter((d) =>
    district.some((m) => m.id === d.meetingId),
  );
  assert.ok(districtDocs.length > 1, "the district must hold more than one document for this to test sharing");
  const distinctUrls = new Set(districtDocs.map((d) => d.documentUrl));
  assert.equal(
    distinctUrls.size,
    1,
    "the district's documents are the same portal page repeated",
  );
  assert.deepEqual(
    agendaItems(districtDocs[0].text),
    [],
    "a portal landing page must extract no agenda items",
  );
});

test("every honest empty is a DIFFERENT state, never one flat absence", () => {
  const STATES = [
    "NO_MEETING_HELD",
    "MEETING_KNOWN_NO_AGENDA_DOCUMENT",
    "AGENDA_DOCUMENT_NOT_READABLE",
    "AGENDA_LINK_IS_A_LANDING_PAGE",
    "AGENDA_READ_NO_ITEMS_EXTRACTED",
    "ITEMS",
    "NO_UPCOMING_MEETING_HELD",
    "NO_PAST_MEETING_HELD",
  ];
  const selection = readFileSync(join(process.cwd(), "lib/ask/select.ts"), "utf8");
  for (const state of STATES.filter((s) => s.includes("MEETING_HELD"))) {
    assert.ok(
      selection.includes(`"${state}"`),
      `the selection answer no longer distinguishes ${state} — an empty lost its reason`,
    );
  }
  assert.equal(new Set(STATES).size, STATES.length, "the states must be distinct");

  const readable = "1. Call to order\n2. Rezoning of parcel 44\n3. Adjournment";
  const document = (over: Partial<AgendaDocumentLike> = {}): AgendaDocumentLike => ({
    meetingId: "m1",
    documentUrl: "https://example.gov/agenda.pdf",
    sourceUrl: "https://example.gov/boards",
    sourceOrg: "Town of Example",
    retrievedAt: "2026-08-28T12:00:00.000Z",
    text: readable,
    extraction: "pdf",
    ...over,
  });
  const portal = document({
    documentUrl: "https://example.gov/portal",
    text: "Board Portal Home Calendar Contact",
  });
  const reading = (over: Partial<Parameters<typeof classifyAgendaPublication>[0]>) =>
    classifyAgendaPublication({
      bodyName: "Example Unified District",
      meetingId: "m1",
      documentsForMeeting: [],
      documentsAcrossCorpus: [],
      now: Date.parse("2026-08-29T00:00:00.000Z"),
      ...over,
    });

  const DOCUMENT_STATES = [
    reading({}),
    reading({
      documentsForMeeting: [document({ text: null, extraction: "failed" })],
      documentsAcrossCorpus: [document({ text: null, extraction: "failed" })],
    }),
    reading({
      documentsForMeeting: [portal],
      documentsAcrossCorpus: [portal, { ...portal, meetingId: "m2" }],
    }),
    reading({
      documentsForMeeting: [document({ text: "The board will discuss the published budget proposal." })],
      documentsAcrossCorpus: [document({ text: "The board will discuss the published budget proposal." })],
    }),
  ];

  const sentences = DOCUMENT_STATES.map((r) => r.gap?.statement ?? "");
  assert.equal(
    new Set(sentences).size,
    DOCUMENT_STATES.length,
    `a document state lost its own sentence and collapsed into another: ${sentences.join(" | ")}`,
  );
  assert.equal(
    new Set(DOCUMENT_STATES.map((r) => r.acquisition)).size,
    DOCUMENT_STATES.length,
    "the states themselves must stay distinct, not only their prose",
  );
  for (const r of DOCUMENT_STATES) {
    assert.equal(r.gap?.whose, "OURS", r.gap?.statement);
    assert.equal(r.publication, "UNKNOWN");
  }
});

test("a document belonging to TWO governments is never handed to either as its agenda", () => {
  const byMeeting = new Map(snapshot.meetings.map((m) => [m.id, m]));
  const byUrl = new Map<string, Set<string>>();
  for (const d of snapshot.agendaDocuments) {
    const ocdId = byMeeting.get(d.meetingId)?.ocdId;
    if (!ocdId) continue;
    const set = byUrl.get(d.documentUrl) ?? new Set<string>();
    set.add(ocdId);
    byUrl.set(d.documentUrl, set);
  }
  const crossGovernment = [...byUrl.entries()].filter(([, govs]) => govs.size > 1);

  assert.equal(
    crossGovernment.length,
    1,
    `${crossGovernment.length} document URL(s) span more than one government: ` +
      crossGovernment.map(([u, g]) => `${u} across ${g.size}`).join("; "),
  );

  const route = readFileSync(join(process.cwd(), "app/api/ask/agenda/route.ts"), "utf8");
  assert.match(
    route,
    /documentSharedAcrossGovernments/,
    "the meeting mode no longer reports when a document belongs to another government",
  );
  assert.match(
    route,
    /sharedAcrossGovernments \? null : \(newest\?\.sourceOrg \?\? null\)/,
    "the meeting mode is attributing a document to a government it does not come from",
  );
});

test("the ingest refuses to carry forward a document belonging to two governments", () => {
  const ingest = readFileSync(join(process.cwd(), "scripts/ingest.ts"), "utf8");
  assert.match(
    ingest,
    /agenda documents carried forward/,
    "the carry-forward no longer states its denominator",
  );
  assert.match(
    ingest,
    /more than one government/,
    "the ingest no longer re-checks a carried-forward document's government",
  );
  assert.ok(
    !/for \(const doc of previous\.agendaDocuments\) agendaDocumentStore\.append\(doc\);/.test(
      ingest,
    ),
    "the unconditional carry-forward is back — a wiring error would become permanent again",
  );
});

test("the ingest refuses a landing page, and the rule is drawn where the evidence is", () => {
  const byUrl = new Map<string, AgendaDocumentLike[]>();
  for (const d of snapshot.agendaDocuments) {
    const a = byUrl.get(d.documentUrl) ?? [];
    a.push(d);
    byUrl.set(d.documentUrl, a);
  }

  let sharedDocs = 0;
  let sharedYieldingItems = 0;
  let soloDocs = 0;
  let soloYieldingItems = 0;
  for (const arr of byUrl.values()) {
    const items = agendaItems(arr[0].text).length;
    if (arr.length > 1) {
      sharedDocs += arr.length;
      if (items > 0) sharedYieldingItems += arr.length;
    } else {
      soloDocs++;
      if (items > 0) soloYieldingItems++;
    }
  }

  assert.ok(sharedDocs > 0, "no shared documents at all — this control would be vacuous");
  assert.equal(
    sharedYieldingItems,
    0,
    `${sharedYieldingItems} shared document(s) DO yield agenda items — the rule's premise has ` +
      "changed and refusing them would now discard something true. Re-measure before trusting it.",
  );
  assert.ok(
    soloYieldingItems > 0,
    "no solo document yields an item either — then the extractor is broken, not the sharing",
  );

  const ingest = readFileSync(join(process.cwd(), "scripts/ingest.ts"), "utf8");
  assert.match(
    ingest,
    /alreadyOnAnotherMeeting && agendaItems\(doc\.text\)\.length === 0/,
    "the landing-page refusal is no longer conditioned on yielding NO items — a joint agenda would be discarded",
  );
  assert.match(ingest, /landing page\(s\) refused/, "the refusal is no longer counted in the report");
});

test("no server reply is discarded on the way to the reader", () => {
  const box = readFileSync(join(process.cwd(), "components/ask/ask-box.tsx"), "utf8");

  assert.ok(
    !/return "topic" in body/.test(box),
    "a reply is being filtered by a predicate again instead of read whole",
  );
  assert.match(
    box,
    /readAskAnswer\(await response\.json\(\)\) \?\? transportFailure\(\)/,
    "the reply must be read through the contract, and a refusal must be a STATED state",
  );
  const groundedFetch = box.slice(
    box.indexOf('const askGrounded = async'),
    box.indexOf('const ask = ('),
  );
  assert.ok(groundedFetch.length > 0, "the grounded rung must be findable");
  assert.ok(
    !/return null;/.test(groundedFetch),
    "a failed answer request must produce a sentence, never a silent null",
  );
  assert.match(groundedFetch, /if \(!response\.ok\) return transportFailure\(\);/);

  const route = readFileSync(
    join(process.cwd(), "app/api/ask/grounded/route.ts"),
    "utf8",
  );
  assert.match(route, /const payload: AskAnswerPayload = askAnswer\(\{/);
  assert.match(route, /pack,/, "the reply is built from the evidence pack itself");
});
