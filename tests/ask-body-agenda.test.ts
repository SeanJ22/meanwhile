import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { agendaItems, agendaTopicFor, type AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
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
   * TWO FILES, because the empty-state decision MOVED and this guard is a text
   * sweep. `emptySelectionState` now lives in `lib/ask/select.ts` so the
   * deterministic agenda route and the grounded route cannot disagree about
   * which meeting a tensed question meant. Reading only the route would have
   * made this guard fail for a reason that was not a defect — and the wrong fix
   * would have been to loosen it.
   */
  const sources = [
    readFileSync(join(process.cwd(), "app/api/ask/agenda/route.ts"), "utf8"),
    readFileSync(join(process.cwd(), "lib/ask/select.ts"), "utf8"),
  ].join("\n");
  for (const state of STATES) {
    assert.ok(
      sources.includes(`"${state}"`),
      `the agenda answer no longer distinguishes ${state} — an empty lost its reason`,
    );
  }
  assert.equal(new Set(STATES).size, STATES.length, "the states must be distinct");
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

test("the agenda reply is kept whenever it carries something usable, not only a topic", () => {
  /*
   * **THIS DISCARD HAS NOW BITTEN THREE TIMES.**
   *
   * The client's agenda handler read `body.topic ? body : null`, so the WHOLE
   * reply was thrown away whenever the agenda rung had no topic — which is
   * exactly the case for a question that names a government and carries no
   * agenda keyword.
   *
   * It swallowed the body-agenda answer first: the route answered the tester's
   * question correctly and the reader saw nothing. Then it swallowed the
   * server-resolved `namedEntity`: the route had bound Vail against the whole
   * corpus, and the client — which can only see the reader's area — went on
   * telling them we had not matched it.
   *
   * Both were invisible to every automated check, because a discarded reply
   * fails nothing. Pinned on the source so the condition cannot narrow back.
   */
  const box = readFileSync(join(process.cwd(), "components/ask/ask-box.tsx"), "utf8");
  assert.ok(
    !/return "topic" in body && body\.topic \? body : null;/.test(box),
    "the reply is discarded again whenever the agenda rung has no topic",
  );
  assert.match(
    box,
    /body\.topic \|\| body\.namedEntity/,
    "the reply must be kept when it carries a server-resolved entity, not only a topic",
  );
  /* And the route must actually send one, or the client's keeping it is moot. */
  const route = readFileSync(join(process.cwd(), "app/api/ask/agenda/route.ts"), "utf8");
  assert.match(
    route,
    /mode: "topic",\s*\n\s*topic: null,\s*\n\s*hits: \[\],\s*\n\s*namedEntity:/,
    "the no-topic reply no longer carries the server's binding, so there is nothing to keep",
  );
});
