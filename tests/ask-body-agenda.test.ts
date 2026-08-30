import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { agendaItems, agendaTopicFor, type AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import {
  asksForBodyAgenda,
  bindNamedEntity,
  type BindableEntity,
} from "../lib/routing/named-entity.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * **WHAT IS ON A NAMED GOVERNMENT'S OWN DOCKET.** (2026-08-27.)
 *
 * The question that opened this session — *"What's on the Vail school district
 * agenda?"* — had TWO things wrong with it, and only one was the substitution.
 * The other is this: the product could not tell that the reader was asking
 * about a specific government's docket at all. `/api/ask/agenda` answered a
 * TOPIC within a scope, `agendaTopicFor` returns null for this shape, and the
 * question fell through to topic routing — which names bodies rather than
 * agenda items — while the corpus held eleven Vail meetings and nine documents.
 *
 * Run against the committed corpus rather than a fixture, because a hand-written
 * agenda would prove only that the regex matches itself.
 */

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
) as { meetings: Meeting[]; agendaDocuments: AgendaDocumentLike[] };

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
    "What's on the Vail school district agenda?",
    "what is Vail discussing",
    "what are they discussing at the next meeting",
    "what's on the docket",
  ]) {
    assert.ok(asksForBodyAgenda(q), `${q} is a body-agenda question`);
  }
  /* A03's own questions are NOT this rung, and must keep reaching the topic
   * search — a body-agenda rung that swallowed them would be a regression. */
  for (const q of ["is there a data center coming", "any warehouses being built near me"]) {
    assert.ok(!asksForBodyAgenda(q), `${q} belongs to the topic rung`);
    assert.ok(agendaTopicFor(q), `${q} must still reach a topic`);
  }
});

test("the tester's question reaches VAIL's own meetings and nobody else's", () => {
  const question = "What's on the Vail school district agenda?";
  assert.ok(asksForBodyAgenda(question));

  const bound = bindNamedEntity(question, entities());
  assert.equal(bound.kind, "BOUND", "the corpus holds Vail and the question names it");
  if (bound.kind !== "BOUND") return;
  assert.match(bound.entity.id, /vail_unified_district/);

  const forBody = snapshot.meetings.filter((m) => m.ocdId === bound.entity.id);
  assert.ok(forBody.length > 0, "Vail must have meetings for this to answer anything");
  /* The hard constraint: not one meeting from another government. */
  assert.ok(
    forBody.every((m) => m.ocdId === bound.entity.id),
    "retrieval reached a meeting belonging to a different government",
  );
});

test("a landing page reused across sittings is not that meeting's agenda", () => {
  /*
   * **56 OF THE CORPUS'S 198 AGENDA DOCUMENTS SHARE A URL WITH ANOTHER
   * MEETING** — 27 on one New Hampshire town calendar, 14 on another, 9 on
   * Vail's Highbond portal root, 6 on Tucson Unified's board page. One page
   * cannot be the agenda of two different meetings, so a document the same body
   * reuses across sittings is a landing page by construction.
   *
   * Vail's is 1,652 characters of portal navigation and the year's schedule.
   * Reporting "we hold an agenda for this meeting and it has no items" would be
   * a claim about the government built out of a fact about our retrieval.
   */
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

  /* Vail's specifically: shared, and yielding no items. Both halves matter — a
   * shared URL that DID extract items would be a different state. */
  const vail = snapshot.meetings.filter((m) => /vail_unified/.test(m.ocdId ?? ""));
  const vailDocs = snapshot.agendaDocuments.filter((d) =>
    vail.some((m) => m.id === d.meetingId),
  );
  assert.ok(vailDocs.length > 1, "Vail must hold more than one document for this to test sharing");
  const distinctUrls = new Set(vailDocs.map((d) => d.documentUrl));
  assert.equal(
    distinctUrls.size,
    1,
    "Vail's documents are the same portal page repeated; if that changes, re-point this control",
  );
  assert.deepEqual(
    agendaItems(vailDocs[0].text),
    [],
    "a portal landing page must extract no agenda items",
  );
});

test("every honest empty is a DIFFERENT state, never one flat absence", () => {
  /*
   * RULING 100: an operation that can return nothing is asked WHAT it returned.
   * A body with no meeting, a meeting with no document, a document that would
   * not extract, and a landing page are four different facts about US, and
   * collapsing them would assert an absence about a government.
   */
  const STATES = [
    "NO_MEETING_HELD",
    "MEETING_KNOWN_NO_AGENDA_DOCUMENT",
    "AGENDA_DOCUMENT_NOT_READABLE",
    "AGENDA_LINK_IS_A_LANDING_PAGE",
    "AGENDA_READ_NO_ITEMS_EXTRACTED",
    "ITEMS",
    /*
     * ASK02 (2026-08-27) SPLIT THE FIRST OF THESE IN THREE, because the reader's
     * tense became a retrieval instruction. "We hold no meetings at all for this
     * body" is a fact about our collection; "we hold meetings but none in the
     * future", and "none in the past", are facts about the calendar. One flat
     * NO_MEETING_HELD for all three would let a reader read a scheduling gap as
     * a coverage gap.
     */
    "NO_UPCOMING_MEETING_HELD",
    "NO_PAST_MEETING_HELD",
  ];
  /*
   * **THE SELECTION STATES ARE STILL AN ENUM. THE DOCUMENT STATES ARE NOW
   * SENTENCES.** (Updated by ASK-05, 2026-08-28.)
   *
   * `emptySelectionState` in `lib/ask/select.ts` still names the three ways a
   * tensed question can find no sitting, and that is unchanged — it is a
   * decision two callers had to agree on.
   *
   * The four DOCUMENT states used to be an enum too, in the body-agenda branch
   * of `/api/ask/agenda`, which sent a state string for a client to turn into a
   * sentence. That branch is gone: the grounded engine is the one answer to
   * "what is on this body's agenda", and it emits the distinction directly as
   * four different NAMED GAPS. So this guard reads them where they now live,
   * and it asserts what actually matters — that a reader is told four
   * different things, not that four constants exist.
   *
   * Loosening it to three would be the wrong fix and always was: RULING 100
   * says an operation that can return nothing is asked WHAT it returned.
   */
  const selection = readFileSync(join(process.cwd(), "lib/ask/select.ts"), "utf8");
  for (const state of STATES.filter((s) => s.includes("MEETING_HELD"))) {
    assert.ok(
      selection.includes(`"${state}"`),
      `the selection answer no longer distinguishes ${state} — an empty lost its reason`,
    );
  }
  assert.equal(new Set(STATES).size, STATES.length, "the states must be distinct");

  /*
   * **THE DOCUMENT FACTS, AS THE SENTENCES A READER NOW GETS.**
   * (Repaired by ASK-07, 2026-08-29.)
   *
   * This block used to read the route's SOURCE for four regexes, and the first
   * of them was:
   *
   * ```
   * /whose: "THEIRS",\s*\n\s*statement: `No agenda has been published/
   * ```
   *
   * with a comment beside it arguing that "exactly one of them is THEIRS: a
   * district that has not published an agenda yet is a fact about that
   * district". **The comment was right about the principle and wrong about the
   * input.** The branch it pinned fired on `forMeeting.length === 0` — a count
   * of OUR OWN ROWS — so the sentence claimed a district had not published
   * something nobody had ever looked for. This test was therefore protecting
   * the render defect the constitution names, in the name of preventing it.
   *
   * Two things changed. The route delegates to
   * `lib/ask/agenda-publication.ts`, which can only produce `THEIRS` from a
   * first-party observation of that exact sitting; and this guard stopped
   * grepping source. A regex over an implementation pins the implementation —
   * which is precisely how a false sentence became load-bearing — so the four
   * states are now put through the function the handler calls and the four
   * sentences a reader would receive are compared to each other.
   *
   * What survives unchanged is the property that always mattered: FOUR
   * DIFFERENT FACTS GET FOUR DIFFERENT SENTENCES. Loosening it to three would
   * be the wrong fix and always was (RULING 100).
   *
   * The full ASK-07 net — including the red control that a zero-document
   * sitting never becomes a claim about a government, and the green control
   * that real publisher evidence still earns a scoped THEIRS — is
   * `tests/agenda-publication-state.test.ts`.
   */
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
      bodyName: "Vail Unified District",
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
      documentsForMeeting: [document({ text: "   " })],
      documentsAcrossCorpus: [document({ text: "   " })],
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
  /* And with no publisher evidence in any of the four, every one of them is a
     fact about US. The THEIRS branch is not unreachable — it is EARNED, and
     `tests/agenda-publication-state.test.ts` holds the control that earns it. */
  for (const r of DOCUMENT_STATES) {
    assert.equal(r.gap?.whose, "OURS", r.gap?.statement);
    assert.equal(r.publication, "UNKNOWN");
  }
});

test("a document belonging to TWO governments is never handed to either as its agenda", () => {
  /*
   * **THE MISATTRIBUTION CLASS, IN THE LAST PLACE IT WAS STILL OPEN.**
   *
   * One URL in the corpus is attached to 27 meetings across two towns:
   * `bradfordnh.gov/pages/calendar`, on 14 Newbury sittings and 13 Bradford
   * ones. It is Bradford's own calendar — Bradford Town Hall, `bradfordnh.org`
   * addresses, Bradford's board schedules — and it does not mention Newbury
   * anywhere. Some of those rows carry `sourceOrg: "Town of Newbury"`.
   *
   * So a reader opening a Newbury Selectboard meeting was handed another
   * town's calendar attributed to their own town. One page cannot be two
   * GOVERNMENTS' agenda under any circumstances, which makes this a harder
   * fact than the same-body landing page and the easier one to detect.
   *
   * The measurement is asserted rather than described, so the day the ingest
   * defect (NH255) is repaired this test fails and says the number moved.
   */
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
    `${crossGovernment.length} document URL(s) span more than one government — the measurement moved, ` +
      "which is either the NH255 repair landing or a new instance. Re-measure and re-point this control: " +
      crossGovernment.map(([u, g]) => `${u} across ${g.size}`).join("; "),
  );

  /* And the serving path must refuse to attribute it. Pinned on the source
     because the route reads a snapshot and a network fixture would prove less. */
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
  /*
   * **A WIRING ERROR MUST NOT BECOME PERMANENT DATA.**
   *
   * The document store is seeded from the previous snapshot so append-only
   * semantics hold across refreshes — and that also meant a document attached
   * under a wiring error survived every later run. The wiring gets corrected,
   * the ingest never looks again, and the wrong document is carried forever.
   *
   * That is how fourteen Newbury meetings still hold Bradford's town calendar,
   * retrieved 2026-08-21, when Newbury's wiring rows carry no notice URL at all
   * today. The error is already fixed at the source and the data still says
   * otherwise.
   *
   * Pinned on the source because the check runs inside a network ingest that a
   * test may not perform. What is asserted is that the re-check EXISTS and that
   * it drops rather than keeps — an append-only store re-appends anything kept.
   */
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
  /* The seeding must NOT be an unconditional loop again. */
  assert.ok(
    !/for \(const doc of previous\.agendaDocuments\) agendaDocumentStore\.append\(doc\);/.test(
      ingest,
    ),
    "the unconditional carry-forward is back — a wiring error would become permanent again",
  );
});

test("the ingest refuses a landing page, and the rule is drawn where the evidence is", () => {
  /*
   * **56 OF 56 SHARED DOCUMENTS YIELD ZERO AGENDA ITEMS; 47% OF SOLO ONES
   * YIELD SOME.** That is the whole argument for the rule, and it is measured
   * here rather than asserted in prose, so the day the corpus changes the
   * number changes with it.
   */
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

  /* And the rule is BOTH conditions, never sharing alone: a genuine joint
     agenda under one document yields items and must be kept. */
  const ingest = readFileSync(join(process.cwd(), "scripts/ingest.ts"), "utf8");
  assert.match(
    ingest,
    /alreadyOnAnotherMeeting && agendaItems\(doc\.text\)\.length === 0/,
    "the landing-page refusal is no longer conditioned on yielding NO items — a joint agenda would be discarded",
  );
  assert.match(ingest, /landing page\(s\) refused/, "the refusal is no longer counted in the report");
});

test("no server reply is discarded on the way to the reader", () => {
  /*
   * **THIS DISCARD BIT THREE TIMES, AND THE FOURTH IS NOW UNREACHABLE.**
   * (Rewritten by ASK-05, 2026-08-28.)
   *
   * The client's agenda handler read `body.topic ? body : null`, so the WHOLE
   * reply was thrown away whenever that rung had no topic — which is exactly
   * the case for a question that names a government and carries no agenda
   * keyword. It swallowed the body-agenda answer first, and then the
   * server-resolved `namedEntity`, so a reader was told we had not matched a
   * government the server had already resolved. Both were invisible to every
   * automated check, because a discarded reply fails nothing.
   *
   * That handler is gone with the second engine. What replaces this test is
   * the structural reason the class cannot recur: there is ONE reply, it is
   * READ through the declared contract rather than filtered by a predicate,
   * every field travels on every mode, and the parse falls back to a stated
   * transport failure rather than to null.
   */
  const box = readFileSync(join(process.cwd(), "components/ask/ask-box.tsx"), "utf8");

  /* No conditional discard survives anywhere on the reply path. */
  assert.ok(
    !/return "topic" in body/.test(box),
    "a reply is being filtered by a predicate again instead of read whole",
  );
  assert.match(
    box,
    /readAskAnswer\(await response\.json\(\)\) \?\? transportFailure\(\)/,
    "the reply must be read through the contract, and a refusal must be a STATED state",
  );
  /*
   * A failed ANSWER request must produce a sentence, never a silent null. The
   * scope is the grounded rung only, and deliberately: `classify` returns null
   * on failure and that is correct — it selects a curated DESTINATION, and its
   * absence leaves the reader with the honest refusal they would have had
   * anyway. It makes no claim about a government to withhold.
   */
  const groundedFetch = box.slice(
    box.indexOf('const askGrounded = async'),
    box.indexOf('const ask = () => {'),
  );
  assert.ok(groundedFetch.length > 0, "the grounded rung must be findable");
  assert.ok(
    !/return null;/.test(groundedFetch),
    "a failed answer request must produce a sentence, never a silent null",
  );
  assert.match(groundedFetch, /if \(!response\.ok\) return transportFailure\(\);/);

  /*
   * And the server must actually send the whole shape, or the client's
   * refusing to discard it is moot. `askAnswer` builds from the PACK, so the
   * records a reader sees are by construction the ones validation checked.
   */
  const route = readFileSync(
    join(process.cwd(), "app/api/ask/grounded/route.ts"),
    "utf8",
  );
  assert.match(route, /const payload: AskAnswerPayload = askAnswer\(\{/);
  assert.match(route, /pack,/, "the reply is built from the evidence pack itself");
});
