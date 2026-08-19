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
