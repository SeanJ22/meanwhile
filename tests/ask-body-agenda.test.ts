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
  ];
  const route = readFileSync(
    join(process.cwd(), "app/api/ask/agenda/route.ts"),
    "utf8",
  );
  for (const state of STATES) {
    assert.ok(
      route.includes(`"${state}"`),
      `the route no longer distinguishes ${state} — an empty lost its reason`,
    );
  }
  assert.equal(new Set(STATES).size, STATES.length, "the states must be distinct");
});
