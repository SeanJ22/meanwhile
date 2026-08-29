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
 * A03 ("Is there a data center coming?") and A05 ("What's on the docket for
 * this?") — 2026-08-18 (g19), against the committed agenda corpus rather
 * than a fixture, because the corpus is the thing that has to be searchable
 * and a hand-written agenda would prove only that the regex matches itself.
 *
 * Minimum counts throughout. A search that quietly matches nothing has to
 * fail here — it is the same empty-success shape the meeting adapters
 * already guard against by reporting fetched/normalized/dropped.
 */

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
) as {
  meetings: Meeting[];
  agendaDocuments: AgendaDocumentLike[];
};

test("A03: the corpus this searches is real and its size is stated", () => {
  assert.ok(
    snapshot.agendaDocuments.length >= 100,
    `only ${snapshot.agendaDocuments.length} agenda documents — the corpus shrank`,
  );
  const readable = snapshot.agendaDocuments.filter(
    (d) => d.text && d.text.length > 100,
  );
  assert.ok(
    readable.length >= 100,
    `only ${readable.length} readable documents of ${snapshot.agendaDocuments.length}`,
  );
});

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

  // Counted, with the denominator. A zero here is a broken search, not a
  // county with no data-center business.
  assert.ok(searched >= 100, `only ${searched} documents were readable`);
  assert.ok(hits.length >= 1, "no data-center line found in the whole corpus");
  assert.ok(
    unreadable + searched === snapshot.agendaDocuments.length,
    "the searched and unreadable counts do not add up to the corpus",
  );

  for (const hit of hits) {
    // The quote is the document's own text. Every character of it has to be
    // findable in the document it came from — that is what makes it a quote
    // rather than a summary.
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
    // And it says which phrase put it there, so the reader can see why.
    // Checked against the DOCUMENT rather than the quote: a quote is capped
    // at 400 characters, so a phrase near the end of a long agenda line is
    // legitimately outside the rendered excerpt.
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
  // The whole vocabulary produces real results across the corpus. A topic
  // that finds nothing today (no solar farms on any agenda we hold) is a
  // true answer, not a broken one — so the assertion is on the aggregate.
  assert.ok(
    topicsWithHits >= 4,
    `only ${topicsWithHits} of ${AGENDA_TOPICS.length} topics found anything`,
  );
  assert.ok(total >= 20, `only ${total} hits across the whole vocabulary`);
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
  // A placeless meeting is virtual (D18) and cannot be filtered by distance.
  // It is returned rather than dropped, so a caller can say so.
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
      // Verbatim, like A03's quotes.
      assert.ok(
        normalized.includes(item.replace(/…$/, "")),
        `an item is not present in its own document: ${item.slice(0, 60)}`,
      );
      // The defect the corpus caught: "W. Congress Street, 1st Floor" was
      // extracted as an agenda item, twice, because "W." is a perfectly
      // good letter marker. A compass direction heading a line is an
      // address far more often than an item.
      assert.doesNotMatch(
        item,
        /^[NSEW][.)]\s/,
        `a compass-direction address is being rendered as an agenda item: ${item.slice(0, 60)}`,
      );
    }
  }
  assert.ok(
    documentsWithItems >= 30,
    `only ${documentsWithItems} of ${snapshot.agendaDocuments.length} documents yield items`,
  );
  assert.ok(itemsTotal >= 100, `only ${itemsTotal} items across the corpus`);
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
  // A05's own rule: the raw agenda link rides on every response, so an
  // extraction can never stand in place of the record.
  assert.match(route, /agendaUrl/);
});

/* ══ g20, 2026-08-19: A03 and A05's named remainders ══════════════════════ */

/*
 * **THESE TWO MOVED WITH THE SWEEP, AND THEY ARE STRONGER FOR IT.**
 * (ASK-05, 2026-08-28.)
 *
 * Both used to read `components/ask/ask-box.tsx` as TEXT and regex the
 * four-way denominator ternary inside `{agenda && agenda.topic && (`. That
 * block was a SECOND reader-facing civic answer rendered beside the grounded
 * one, and it is gone: the sweep is `lib/ask/agenda-topic.ts` and its
 * sentences are named gaps in the one evidence pack.
 *
 * Every distinction the old tests protected is asserted below, and they are
 * now BEHAVIOURAL rather than textual. A regex over a component could only
 * prove a string was present in a file; calling the module with real inputs
 * and reading the sentences it produces proves a reader gets them.
 */
test("A03: a search that ran and found nothing renders, and says so", () => {
  const rezoning = AGENDA_TOPICS.find((t) => t.id === "rezoning")!;

  // Nothing searched is NOT nothing found. The rung used to render only on a
  // hit, so a reader who asked and got nothing saw no trace that anything had
  // been searched — and silence there reads as "no", which is exactly the
  // claim we are not entitled to make.
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

  // A search that RAN over a real corpus and found nothing is a different
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

  // Every one of these is OURS. "We hold no readable agendas" is a fact about
  // this product, and rendering it as a fact about a government is the render
  // defect the constitution names.
  for (const gap of [...nothingHeld.gaps, ...searchedNothingFound.gaps]) {
    assert.equal(gap.whose, "OURS", gap.statement);
  }
});

test("A03: the corpus limit rides with the answer — agendas are not the permit record", () => {
  // A03's own recorded remainder: this searches AGENDAS, which is where
  // zoning and permit items surface but is not the permit record itself. A
  // permit application exists in a planning department's system before it
  // reaches an agenda, and often never reaches one — so an unqualified "no
  // mention on an agenda" lets a reader take it for "nothing has been filed",
  // a much larger claim about a record of an entirely different kind.
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

  // It rides on the HIT case as well as the empty one: a reader who found one
  // mention still needs to know there may be filings behind it. The old test
  // proved that by comparing JSX character offsets; this proves the same
  // sentence reaches BOTH outcomes, which is what the offsets stood in for.
  for (const outcome of [hit, miss]) {
    const said = outcome.gaps.map((g) => g.statement).join(" ");
    assert.match(said, /not the permit or zoning-application record/i);
    assert.match(said, /filed with a planning department long before/i);
  }

  /*
   * **AND IT NO LONGER ANNOUNCES OUR OWN ROADMAP.** The sentence used to end
   * "and we haven't wired those systems yet" — a progress claim about our own
   * pipeline, which RULING 59 strikes from every reader surface and RULING 139
   * strikes again as a verdict on ourselves. It survived for months only
   * because it lived in JSX with an HTML entity in the contraction, which the
   * RULING 59 sweep's regex could not see through.
   */
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

  // g19 built agendaItems() and the route's meeting mode and recorded that
  // nothing rendered them. This is the surface. It calls the SAME function
  // the route calls rather than posting to it — one definition of what an
  // agenda item is, so the two can never disagree on the same card.
  assert.match(source, /import \{ agendaItems \} from "@\/lib\/routing\/agenda-search"/);
  assert.match(source, /const items = agendaItems\(/);
  assert.match(source, /On the docket/);

  // A05's own rule: it sits alongside the raw agenda link and never
  // replaces it. The document's full text still renders below the items.
  assert.match(source, /sanitizeStoredText\(latest\.text\)/);
  assert.match(source, /the full text is the record/i);

  // An empty item list renders NOTHING — never "no items". The extraction
  // is best-effort against collapsed PDF text, and our parser's failure
  // must not become a claim about a government's agenda.
  assert.match(source, /\{items\.length > 0 && \(/);
  assert.doesNotMatch(source, /No items on this agenda/i);
});
