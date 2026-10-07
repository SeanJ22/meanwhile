import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { Meeting } from "../lib/sources/types.ts";
import {
  AGENDA_TOPICS,
  agendaItems,
  agendaTopicFor,
  meetingsWithin,
  milesBetween,
  searchAgendas,
  type AgendaDocumentLike,
} from "../lib/routing/agenda-search.ts";
import { agendaTopicEvidence } from "../lib/ask/agenda-topic.ts";

/**
 * Agenda topic search and item extraction, over an inline corpus. Minimum counts throughout: a
 * search that quietly matches nothing must fail here.
 */

const agenda = (n: number, text: string | null): AgendaDocumentLike => ({
  meetingId: `m${n}`,
  documentUrl: `https://example.gov/agendas/${n}.pdf`,
  sourceUrl: `https://example.gov/agendas/${n}.pdf`,
  sourceOrg: "Town of Example",
  retrievedAt: "2026-08-18T00:00:00.000Z",
  text,
  extraction: text === null ? "failed" : "pdf",
});

const meeting = (n: number, location: { lat: number; lng: number } | null): Meeting =>
  ({
    id: `m${n}`,
    ocdId: "ocd-division/country:us/state:az/place:example",
    bodyName: "Town Council",
    title: "Regular Meeting",
    startsAt: "2026-09-01T02:00:00.000Z",
    ...(location ? { location } : {}),
  }) as unknown as Meeting;

const snapshot: { meetings: Meeting[]; agendaDocuments: AgendaDocumentLike[] } = {
  agendaDocuments: [
    agenda(1, "1. Call to order and roll call.\n2. Public hearing on a rezoning of parcel 44 for a data center campus.\n3. Adjournment of the meeting."),
    agenda(2, "1. Approval of the consent agenda.\n2. Conditional use permit for a warehouse and distribution center.\n3. Traffic signal at Main Street and First Avenue."),
    agenda(3, "A. Wireless communication facility on the water tower site.\nB. Final plat for a subdivision of forty single-family lots.\nW. Congress Street, 1st Floor"),
    agenda(4, "1. Presentation on a solar farm and battery energy storage proposal.\n2. School boundary adjustment hearing for next year."),
    agenda(5, "A paragraph of prose with no item markers at all, read for completeness."),
    agenda(6, null),
  ],
  meetings: [
    meeting(1, { lat: 32.25, lng: -110.95 }),
    meeting(2, { lat: 32.1, lng: -110.8 }),
    meeting(3, { lat: 33.45, lng: -112.07 }),
    meeting(4, null),
  ],
};

test("A03: a reader's question maps to the words agendas actually use", () => {
  assert.equal(agendaTopicFor("is there a data center coming?")?.id, "data-center");
  assert.equal(agendaTopicFor("any warehouses being built near me")?.id, "warehouse");
  assert.equal(agendaTopicFor("what rezoning is happening")?.id, "rezoning");
  assert.equal(agendaTopicFor("is a cell tower going up")?.id, "cell-tower");

  // A question this rung has nothing to say about falls through rather than
  // claiming a topic — the other rungs of the ask pipeline continue.
  assert.equal(agendaTopicFor("who is my senator"), null);
  assert.equal(agendaTopicFor("when is the election"), null);

  // The longest phrase wins, so a compound name is not claimed by a
  // shorter entry that happens to sit inside it.
  assert.equal(
    agendaTopicFor("plans for a distribution center")?.id,
    "warehouse",
  );
});

test("A03: real topics find real lines in the real corpus, quoted verbatim", () => {
  const dataCenter = AGENDA_TOPICS.find((t) => t.id === "data-center")!;
  const { hits, searched, unreadable } = searchAgendas(
    snapshot.agendaDocuments,
    dataCenter,
  );

  // A zero here is a broken search.
  assert.ok(searched >= 5, `only ${searched} documents were readable`);
  assert.ok(hits.length >= 1, "no data-center line found in the whole corpus");
  assert.ok(
    unreadable + searched === snapshot.agendaDocuments.length,
    "the searched and unreadable counts do not add up to the corpus",
  );

  for (const hit of hits) {
    // The quote is the document's own text.
    const doc = snapshot.agendaDocuments.find(
      (d) => d.documentUrl === hit.documentUrl,
    );
    assert.ok(doc?.text, `${hit.documentUrl} has no text but produced a hit`);
    const normalized = doc!.text!.replace(/\s+/g, " ");
    const body = hit.quote.replace(/…$/, "");
    assert.ok(
      normalized.includes(body),
      `a quote is not present in its own document: ${body.slice(0, 80)}`,
    );
    // The matched phrase is checked against the document: a quote is capped at 400 characters.
    assert.ok(hit.matchedPhrase.length > 0);
    assert.ok(
      normalized.toLowerCase().includes(hit.matchedPhrase),
      `the matched phrase is not in the document it is attributed to: ${hit.matchedPhrase}`,
    );
  }
});

test("A03: every topic is searchable, and a topic with no hits is not an error", () => {
  let topicsWithHits = 0;
  let total = 0;
  for (const topic of AGENDA_TOPICS) {
    const { hits } = searchAgendas(snapshot.agendaDocuments, topic);
    if (hits.length > 0) topicsWithHits++;
    total += hits.length;
  }
  // A topic with no hits is a true answer, so the assertion is on the aggregate.
  assert.ok(
    topicsWithHits >= 4,
    `only ${topicsWithHits} of ${AGENDA_TOPICS.length} topics found anything`,
  );
  assert.ok(total >= 8, `only ${total} hits across the whole vocabulary`);
});

test("A03: a document whose extraction failed is counted, never read as empty", () => {
  const rezoning = AGENDA_TOPICS.find((t) => t.id === "rezoning")!;
  const withNulls: AgendaDocumentLike[] = [
    ...snapshot.agendaDocuments.slice(0, 5),
    {
      meetingId: "m-broken",
      documentUrl: "https://example.gov/broken.pdf",
      sourceUrl: "https://example.gov/broken.pdf",
      sourceOrg: "Test",
      retrievedAt: "2026-08-18T00:00:00.000Z",
      text: null,
      extraction: "failed",
    },
  ];
  const { searched, unreadable } = searchAgendas(withNulls, rezoning);
  assert.equal(unreadable, withNulls.filter((d) => !d.text).length);
  assert.equal(searched + unreadable, withNulls.length);
  // The failed one is never counted as searched — our parsing failure must
  // not become a claim that the agenda said nothing.
  assert.ok(unreadable >= 1);
});

test("A03: the radius filters on the meeting's own place, and says what it could not place", () => {
  const tucson = { lat: 32.2226, lng: -110.9747 };
  const { within, placeless, outside } = meetingsWithin(snapshot.meetings, tucson, 25);

  assert.ok(within.length > 0, "no meetings within 25 miles of Tucson");
  assert.equal(
    within.length + placeless.length + outside,
    snapshot.meetings.length,
    "the three buckets do not account for every meeting",
  );
  // A placeless meeting cannot be filtered by distance; it is returned, not dropped.
  assert.ok(placeless.length > 0, "no placeless meetings — the bucket is untested");
  for (const meeting of within) {
    assert.ok(meeting.location);
    assert.ok(milesBetween(tucson, meeting.location!) <= 25);
  }

  // A wider radius never returns fewer — the same rule the map's own
  // viewport radius follows: more area may never mean less.
  const wider = meetingsWithin(snapshot.meetings, tucson, 60);
  assert.ok(wider.within.length >= within.length);
});

test("A05: the item list is the clerk's own items, and never an address", () => {
  let documentsWithItems = 0;
  let itemsTotal = 0;
  for (const doc of snapshot.agendaDocuments) {
    const items = agendaItems(doc.text);
    if (items.length === 0) continue;
    documentsWithItems++;
    itemsTotal += items.length;
    const normalized = doc.text!.replace(/\s+/g, " ");
    for (const item of items) {
      // Verbatim.
      assert.ok(
        normalized.includes(item.replace(/…$/, "")),
        `an item is not present in its own document: ${item.slice(0, 60)}`,
      );
      // A compass direction heading a line is an address, not an item marker.
      assert.doesNotMatch(
        item,
        /^[NSEW][.)]\s/,
        `a compass-direction address is being rendered as an agenda item: ${item.slice(0, 60)}`,
      );
    }
  }
  assert.ok(
    documentsWithItems >= 4,
    `only ${documentsWithItems} of ${snapshot.agendaDocuments.length} documents yield items`,
  );
  assert.ok(itemsTotal >= 10, `only ${itemsTotal} items across the corpus`);
});

test("A05: a document with no readable structure yields nothing, not a fabricated list", () => {
  assert.deepEqual(agendaItems(null), []);
  assert.deepEqual(agendaItems(""), []);
  assert.deepEqual(agendaItems("a paragraph of prose with no item markers at all"), []);
});

test("A03/A05: nothing in this module generates a sentence", () => {
  // Structural: every string this module returns is sliced out of the input
  // or is a curated label. A test cannot prove the absence of generation in
  // general, but it can prove there is no model call and no template that
  // asserts anything about a government.
  const source = readFileSync(
    join(process.cwd(), "lib/routing/agenda-search.ts"),
    "utf8",
  );
  // The MACHINERY, not the word — the module's own docblock says "nothing
  // here generates", and a check that fails on the sentence describing the
  // rule is a check nobody can keep.
  assert.doesNotMatch(source, /@anthropic-ai|openai|await fetch\(|new Anthropic/i);
  // And the route beside it returns the document's own strings.
  const route = readFileSync(
    join(process.cwd(), "app/api/ask/agenda/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(route, /@anthropic-ai|openai|new Anthropic/i);
  // The raw agenda link rides on every response, so an
  // extraction can never stand in place of the record.
  assert.match(route, /agendaUrl/);
});

/* ══ the topic sweep's sentences (`lib/ask/agenda-topic.ts`) ═════════════════ */

test("A03: a search that ran and found nothing renders, and says so", () => {
  const rezoning = AGENDA_TOPICS.find((t) => t.id === "rezoning")!;

  // Nothing searched is not nothing found.
  const nothingHeld = agendaTopicEvidence({
    question: `is there a ${rezoning.phrases[0]} coming`,
    documents: [],
    meetings: [],
    scopeLabel: "your area",
  });
  assert.ok(nothingHeld.topic, "the topic was recognised");
  assert.equal(nothingHeld.denominators.agendasSweptForTopic, 0);
  const empty = nothingHeld.gaps.map((g) => g.statement).join(" ");
  assert.match(empty, /don't hold any readable agendas for your area yet/i);
  assert.match(empty, /not a statement that nothing is planned/i);

  // A search that ran and found nothing is a different
  // fact, and it carries the number it actually looked at.
  const meeting = {
    id: "m1",
    ocdId: "ocd-division/country:us/state:az/place:x",
    bodyName: "Town Council",
    title: "Regular Meeting",
    startsAt: "2026-09-01T02:00:00.000Z",
  };
  const searchedNothingFound = agendaTopicEvidence({
    question: "is there a data center coming",
    documents: [
      {
        meetingId: "m1",
        documentUrl: "https://example.gov/a.pdf",
        sourceUrl: "https://example.gov/a.pdf",
        sourceOrg: "Town",
        retrievedAt: "2026-08-01T00:00:00.000Z",
        text: "1. Approval of minutes. 2. Sidewalk repair on Elm Street.",
        extraction: "text",
      },
    ],
    meetings: [meeting],
    scopeLabel: "your area",
  });
  assert.equal(searchedNothingFound.denominators.agendasSweptForTopic, 1);
  assert.equal(searchedNothingFound.records.length, 0);
  assert.match(
    searchedNothingFound.gaps.map((g) => g.statement).join(" "),
    /No mention of .* in the 1 agenda we hold for your area\./,
    "a search that ran states what it looked at, and never asserts an absence",
  );

  // Every one of these is OURS.
  for (const gap of [...nothingHeld.gaps, ...searchedNothingFound.gaps]) {
    assert.equal(gap.whose, "OURS", gap.statement);
  }
});

test("A03: the corpus limit rides with the answer — agendas are not the permit record", () => {
  // Agendas are not the permit record: an application can exist long before, or without, an agenda item.
  const doc = {
    meetingId: "m1",
    documentUrl: "https://example.gov/a.pdf",
    sourceUrl: "https://example.gov/a.pdf",
    sourceOrg: "Town",
    retrievedAt: "2026-08-01T00:00:00.000Z",
    text: "1. Public hearing on a rezoning of parcel 44. 2. Adjourn.",
    extraction: "text",
  };
  const meeting = {
    id: "m1",
    ocdId: "ocd-division/country:us/state:az/place:x",
    bodyName: "Planning Commission",
    title: "Regular Meeting",
    startsAt: "2026-09-01T02:00:00.000Z",
  };

  const hit = agendaTopicEvidence({
    question: "is there a rezoning coming",
    documents: [doc],
    meetings: [meeting],
    scopeLabel: "your area",
  });
  const miss = agendaTopicEvidence({
    question: "is there a rezoning coming",
    documents: [{ ...doc, text: "1. Approval of minutes. 2. Adjourn." }],
    meetings: [meeting],
    scopeLabel: "your area",
  });

  assert.ok(hit.records.length > 0, "the hit case must actually find something");
  assert.equal(miss.records.length, 0);

  // It rides on the hit case as well as the empty one.
  for (const outcome of [hit, miss]) {
    const said = outcome.gaps.map((g) => g.statement).join(" ");
    assert.match(said, /not the permit or zoning-application record/i);
    assert.match(said, /filed with a planning department long before/i);
  }

  // No progress claim about our own pipeline.
  for (const outcome of [hit, miss]) {
    const said = outcome.gaps.map((g) => g.statement).join(" ");
    assert.doesNotMatch(said, /have ?n[o']t (wired|curated|worked)/i);
  }
});

test("A05: the meeting card renders the clerk's items, using the one extractor", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "components/map/popup/agenda-section.tsx"),
    "utf8",
  );

  // The card calls the same extractor the route calls.
  assert.match(source, /import \{ agendaItems \} from "@\/lib\/routing\/agenda-search"/);
  assert.match(source, /const items = agendaItems\(/);
  assert.match(source, /On the docket/);

  // It sits alongside the raw agenda link and never
  // replaces it. The document's full text still renders below the items.
  assert.match(source, /sanitizeStoredText\(latest\.text\)/);
  assert.match(source, /the full text is the record/i);

  // An empty item list renders NOTHING — never "no items". The extraction
  // is best-effort against collapsed PDF text, and our parser's failure
  // must not become a claim about a government's agenda.
  assert.match(source, /\{items\.length > 0 && \(/);
  assert.doesNotMatch(source, /No items on this agenda/i);
});
