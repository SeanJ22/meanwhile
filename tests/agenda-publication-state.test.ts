import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import {
  classifyAgendaPublication,
  observationIsFresh,
  recordPublisherAgendaObservation,
  resetPublisherAgendaObservations,
  DEFAULT_PUBLISHER_OBSERVATION_HOURS,
  MAX_PUBLISHER_OBSERVATION_HOURS,
  type PublisherAgendaObservation,
} from "../lib/ask/agenda-publication.ts";
import { selectSitting } from "../lib/ask/select.ts";
import { snapshotEntities } from "../lib/ask/inventory.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { bindNamedEntity } from "../lib/routing/named-entity.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

/**
 * **ASK-07 — OUR EMPTY HANDS ARE NOT THEIR SILENCE.** (2026-08-29.)
 *
 * `app/api/ask/grounded/route.ts` held one line that turned a count of our own
 * rows into a claim about a government:
 *
 * ```ts
 * if (forMeeting.length === 0) {
 *   gaps.push({ whose: "THEIRS",
 *     statement: `No agenda has been published for that ${subject.name} meeting yet.` });
 * }
 * ```
 *
 * and `tests/ask-body-agenda.test.ts` regex-pinned that exact string as
 * correct, arguing in a comment that "exactly one of them is THEIRS". So the
 * suite was protecting the defect: a session repairing the route would have
 * been stopped by a green-looking guard telling it the false sentence was law.
 * That test is repaired in the same change as the route, and this file is the
 * standing net underneath both.
 *
 * Every control below runs against the REAL reader path — the exported `POST`
 * handler over the committed corpus, or `classifyAgendaPublication`, which is
 * the function the handler itself calls. Nothing here re-implements the
 * selection rule; a test that built its own copy of the rule would pass forever
 * regardless of what a reader receives, which is the shape of defect this
 * repository spent PR #211 finding.
 *
 * ## Why no model runs here
 *
 * `ANTHROPIC_API_KEY` is deleted before the handler is imported, so both model
 * rungs return `UNAVAILABLE` and no network call is made. That is the degraded
 * path and it is the one worth pinning: this product's honesty must not depend
 * on a model being reachable.
 */

delete process.env.ANTHROPIC_API_KEY;

await installRegistryRuntimeFirstSeeds();

const { POST, resetGroundedState } = await import("@/app/api/ask/grounded/route");

interface Snapshot {
  meetings: {
    id: string;
    bodyId: string | null;
    ocdId: string | null;
    title: string;
    bodyName: string;
    startsAt: string;
    agendaUrl?: string | null;
  }[];
  agendaDocuments: AgendaDocumentLike[];
}

const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
) as Snapshot;
const ROUTE_NOW = Date.parse("2026-08-29T12:00:00.000Z");

/**
 * **A REAL BODY WITH A REAL FUTURE SITTING AND NOT ONE DOCUMENT.**
 *
 * Chosen out of the committed corpus rather than named, so the control cannot
 * quietly stop measuring anything the day that body's agendas start arriving —
 * it re-points itself, and the assertion below fails loudly if the corpus ever
 * holds a document for every single sitting (at which point this defect class
 * is unreachable through the route and the control would be vacuous).
 */
const withDocument = new Set(snapshot.agendaDocuments.map((d) => d.meetingId));

/**
 * The body is picked through the handler's OWN inventory and the handler's own
 * binder, so the question this file asks is one a reader could actually type
 * and the subject it reaches is the one the route resolves. Building the
 * question out of `Meeting.bodyName` instead looked right and bound to nothing
 * — the corpus's row name for this body is "RTSD Board Meeting", and the
 * canonical identity a reader names is "Rockaway Township School District".
 */
const entities = snapshotEntities(snapshot.meetings as never, (bodyId) =>
  canonicalBodyIdentity(bodyId),
);

const { bodyId: emptyHandedBodyId, name: emptyHandedName, ocdId: emptyHandedOcdId } = (() => {
  const byBody = new Map<
    string,
    { total: number; documented: number; future: number; ocdId: string | null }
  >();
  for (const m of snapshot.meetings) {
    if (!m.bodyId) continue;
    const row = byBody.get(m.bodyId) ?? {
      total: 0,
      documented: 0,
      future: 0,
      ocdId: m.ocdId,
    };
    row.total += 1;
    if (withDocument.has(m.id)) row.documented += 1;
    if (Date.parse(m.startsAt) >= ROUTE_NOW) row.future += 1;
    byBody.set(m.bodyId, row);
  }
  for (const [bodyId, row] of byBody) {
    if (row.documented !== 0 || row.future === 0) continue;
    const entity = entities.find((e) => e.id === bodyId);
    if (!entity) continue;
    const bound = bindNamedEntity(`What's on the ${entity.name} agenda?`, entities);
    if (bound.kind !== "BOUND" || bound.entity.id !== bodyId) continue;
    return { bodyId, name: entity.name, ocdId: row.ocdId };
  }
  assert.fail(
    "no bindable body in the corpus has a future sitting and zero agenda documents — the route " +
      "control would be vacuous. Re-point it, or this gap is no longer reachable through Ask.",
  );
})();

/** The sitting the handler itself will choose for a "what's on the agenda" question. */
const emptyHandedSitting = selectSitting(
  "NEXT",
  snapshot.meetings.filter((m) => m.bodyId === emptyHandedBodyId),
  ROUTE_NOW,
)!;

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string } | null;
  answer?: string | null;
  records?: { kind: string; id: string; text: string }[];
  gaps?: { whose: string; statement: string }[];
  denominators?: Record<string, number>;
}

async function ask(question: string): Promise<{ body: GroundedBody; raw: string }> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must be
         — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "ask07-agenda-publication-state",
    },
    body: JSON.stringify({
      question,
      ocdIds: [emptyHandedOcdId].filter(Boolean),
      /* Supplied so a passing test today cannot start failing on a Tuesday.
         The handler accepts a date precisely so nothing has to guess one. */
      today: "2026-08-29",
    }),
  });
  const response = await POST(request);
  const raw = await response.text();
  assert.equal(response.status, 200, raw);
  return { body: JSON.parse(raw) as GroundedBody, raw };
}

/** Sentences that assert something about a GOVERNMENT's own publishing. */
const CLAIMS_ABOUT_THEM = [
  /No agenda has been published/i,
  /has not (?:yet )?been published/i,
  /(?:they|the \w+) (?:has|have) not published/i,
];

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 1 (RED) — zero documents, no publisher evidence, through POST
   ══════════════════════════════════════════════════════════════════════ */

test("RED: a sitting we hold no agenda for never becomes a claim that none was published", async () => {
  /*
   * The whole defect, at the reader. The corpus holds this body's calendar and
   * not one agenda document for any of its sittings, and this product has
   * never once looked at that body's own page to see whether a packet is up.
   * Zero rows is a measurement of us.
   */
  resetPublisherAgendaObservations();
  const { body, raw } = await ask(`What's on the ${emptyHandedName} agenda?`);

  assert.equal(
    body.denominators?.agendaDocumentsForThatMeeting ?? 0,
    0,
    "the fixture body must still hold no documents for the chosen sitting",
  );
  assert.equal(
    body.denominators?.publisherPublicationObservationsForThatMeeting,
    0,
    "and no publisher observation may exist, or this control is measuring the other branch",
  );

  /* The whole payload, not just the gaps — the answer field is a reader
     surface too, and a claim smuggled into prose is the same claim. */
  for (const claim of CLAIMS_ABOUT_THEM) {
    assert.doesNotMatch(
      raw,
      claim,
      "the reader was told a government has not published something we never looked for",
    );
  }

  const publicationGaps = (body.gaps ?? []).filter((g) => /agenda/i.test(g.statement));
  assert.ok(publicationGaps.length > 0, "an absent agenda is a NAMED GAP, never silence");
  for (const gap of publicationGaps) {
    assert.equal(
      gap.whose,
      "OURS",
      `an agenda gap with no publisher evidence is OURS: ${gap.statement}`,
    );
  }
  assert.ok(
    publicationGaps.some((g) => /have not yet acquired the agenda/.test(g.statement)),
    "the acquisition gap must say what it actually is",
  );
  /* RULING 139 — the attribution is required, the verdict on ourselves is
     struck. And the wording must keep the hunt OPEN, not close it: "not yet".
     2026-09-24 (author directive): the sentence no longer promises "we are
     still looking" — this path cannot know that looking is happening (the Pima
     Board sittings carried that promise for ten days while every re-read failed
     in our own code), and a progress claim is said only where actionable work
     is known to exist. */
  assert.ok(
    publicationGaps.some((g) => /have not yet acquired/i.test(g.statement)),
    "the acquisition obligation must stay open in the words a reader reads",
  );
  assert.ok(
    publicationGaps.every((g) => !/still looking/i.test(g.statement)),
    "no unverifiable progress claim",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 2 (GREEN) — first-party publisher evidence earns a scoped THEIRS
   ══════════════════════════════════════════════════════════════════════ */

const firstParty = (over: Partial<PublisherAgendaObservation> = {}): PublisherAgendaObservation => ({
  meetingId: emptyHandedSitting.id,
  provenance: "FIRST_PARTY_PUBLISHER",
  report: "NOT_AVAILABLE",
  observedAt: new Date(ROUTE_NOW - 2 * 3_600_000).toISOString(),
  observedUrl: "https://example.gov/boards/calendar",
  sourceOrg: emptyHandedName,
  evidenceQuote: "Agenda: not yet posted",
  ...over,
});

test("GREEN: a fresh first-party reading of the publisher's own page IS allowed to be THEIRS", async () => {
  /*
   * The rule is not "never say anything about a government". It is "say it
   * when something measured it". A clerk's own calendar cell reading *Agenda:
   * not yet posted*, read two hours ago, measures exactly the thing the old
   * sentence asserted for free — so the THEIRS branch opens, and it opens
   * SCOPED: the publisher is named and the day of the reading is printed, so
   * a reader sees the age of the claim instead of a standing fact.
   */
  resetPublisherAgendaObservations();
  recordPublisherAgendaObservation(firstParty());
  const { body } = await ask(`What's on the ${emptyHandedName} agenda?`);
  resetPublisherAgendaObservations();

  assert.equal(body.denominators?.publisherPublicationObservationsForThatMeeting, 1);
  const theirs = (body.gaps ?? []).filter((g) => g.whose === "THEIRS");
  assert.equal(theirs.length, 1, "the observation earns exactly one THEIRS sentence");
  /*
   * ASK-18 (2026-08-30): the clauses are unchanged and their ORDER is not. It
   * led with the date — *"As of <date>, <org> had not posted..."* — which
   * buries the subject and reads as hedging. The owner asked that we *"very
   * clearly say that this agenda is not posted"*.
   *
   * The publisher and the fact come first; the reading date follows as the
   * scope it is. Both assertions below are what actually matters and both
   * still hold: the day of the READING is printed, and the sentence is about
   * what a named publisher's own page showed rather than about whether an
   * agenda exists.
   */
  assert.match(theirs[0].statement, /when we read it on \d{4}-\d{2}-\d{2}/, "the day of the READING, printed");
  assert.match(
    theirs[0].statement,
    /its own page showed none/,
    "and it describes what THEIR page showed, never whether an agenda exists",
  );
  assert.match(theirs[0].statement, new RegExp(emptyHandedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    theirs[0].statement,
    /still checking/i,
    "a publisher's negative does not close our recheck obligation (RULING 170)",
  );
});

test("GREEN: only FIRST-PARTY provenance can reach the THEIRS branch", () => {
  /*
   * A vendor portal reporting on a body's behalf is real evidence and is not
   * the government's own statement about its own docket; anything INFERRED is
   * our collection state wearing a hat. Neither may become a sentence about a
   * government, and that is enforced by the classifier rather than by whoever
   * writes the next caller.
   */
  for (const provenance of ["THIRD_PARTY", "INFERRED"] as const) {
    const reading = classifyAgendaPublication({
      bodyName: "Board of Adjustment",
      meetingId: "m1",
      documentsForMeeting: [],
      documentsAcrossCorpus: [],
      observations: [firstParty({ meetingId: "m1", provenance })],
      now: ROUTE_NOW,
    });
    assert.equal(reading.publication, "UNKNOWN", provenance);
    assert.equal(reading.gap?.whose, "OURS", provenance);
  }
});

test("GREEN: an observation of a DIFFERENT sitting never speaks for this one", () => {
  /* Scoping is the entire rule. A reading of last month's cell says nothing
     about the packet for the meeting a reader just asked about. */
  const reading = classifyAgendaPublication({
    bodyName: "Board of Adjustment",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [firstParty({ meetingId: "m2" })],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "UNKNOWN");
  assert.equal(reading.gap?.whose, "OURS");
});

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 3 (RED) — a stale negative is not current truth
   ══════════════════════════════════════════════════════════════════════ */

test("RED: a publisher negative past its freshness window stops being renderable", async () => {
  /*
   * Publication state CHANGES. Packets in this corpus land in the last days
   * before a sitting and frequently the evening before, so a "not yet posted"
   * reading is at its most wrong exactly when a reader is most likely to ask.
   * Rendering a week-old negative as current truth is the stale-snapshot
   * failure this repository has already recorded twice — pointed, this time,
   * at a claim about a government.
   */
  const stale = firstParty({
    observedAt: new Date(ROUTE_NOW - 8 * 24 * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(stale, ROUTE_NOW), false);

  resetPublisherAgendaObservations();
  recordPublisherAgendaObservation(stale);
  const { body, raw } = await ask(`What's on the ${emptyHandedName} agenda?`);
  resetPublisherAgendaObservations();

  assert.equal(
    body.denominators?.publisherPublicationObservationsForThatMeeting,
    1,
    "the stale reading is KEPT — dropping it would lose the recheck obligation",
  );
  assert.equal(
    (body.gaps ?? []).filter((g) => g.whose === "THEIRS").length,
    0,
    "and it may not be spoken as current",
  );
  for (const claim of CLAIMS_ABOUT_THEM) assert.doesNotMatch(raw, claim);

  /* The state is NAMED rather than forgotten, and the obligation stays open. */
  const reading = classifyAgendaPublication({
    bodyName: "Board of Adjustment",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [{ ...stale, meetingId: "m1" }],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "STALE_OBSERVATION");
  assert.equal(reading.obligationOpen, true);
  assert.equal(reading.alternateSearchOpen, true);
  assert.ok(reading.recheckDueAt, "a stale reading carries the instant it went stale");
});

test("RED: a reading stamped in the future is not fresh either", () => {
  /* A broken clock must never be the thing that authorises a sentence about a
     government, so this fails closed rather than open. */
  const ahead = firstParty({ observedAt: new Date(ROUTE_NOW + 3_600_000).toISOString() });
  assert.equal(observationIsFresh(ahead, ROUTE_NOW), false);
  assert.equal(observationIsFresh(firstParty({ observedAt: "not-a-date" }), ROUTE_NOW), false);
});

test("the freshness window is bounded at both ends", () => {
  const now = ROUTE_NOW;
  const justInside = firstParty({
    observedAt: new Date(now - (DEFAULT_PUBLISHER_OBSERVATION_HOURS - 1) * 3_600_000).toISOString(),
  });
  const justOutside = firstParty({
    observedAt: new Date(now - (DEFAULT_PUBLISHER_OBSERVATION_HOURS + 1) * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(justInside, now), true);
  assert.equal(observationIsFresh(justOutside, now), false);

  /* A publisher cannot grant its own negative an unlimited shelf life. */
  const greedy = firstParty({
    freshnessHours: 100_000,
    observedAt: new Date(now - (MAX_PUBLISHER_OBSERVATION_HOURS + 1) * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(greedy, now), false);
});

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 4 (GREEN) — the document states still each keep their OWN sentence
   ══════════════════════════════════════════════════════════════════════ */

const doc = (over: Partial<AgendaDocumentLike> = {}): AgendaDocumentLike => ({
  meetingId: "m1",
  documentUrl: "https://example.gov/agenda-2026-09-01.pdf",
  sourceUrl: "https://example.gov/boards",
  sourceOrg: "Town of Example",
  retrievedAt: "2026-08-28T12:00:00.000Z",
  text: "1. Call to order\n2. Approval of minutes\n3. Rezoning of parcel 44\n4. Adjournment",
  extraction: "pdf",
  ...over,
});

test("GREEN: every honest empty is a DIFFERENT state with a DIFFERENT sentence", () => {
  /*
   * **WHAT THE OLD GUARD WAS RIGHT ABOUT, KEPT.**
   *
   * `tests/ask-body-agenda.test.ts` guarded one true thing — that the four
   * document states do not collapse into one flat absence (RULING 100: an
   * operation that can return nothing is asked WHAT it returned) — and one
   * false thing, that one of them is a fact about a government. The true half
   * lives here now, and it is asserted BEHAVIOURALLY: the four inputs are put
   * through the function the handler calls and the four sentences a reader
   * would receive are compared. The old form grepped the route's source for
   * regexes, which pinned an implementation rather than a behaviour and is why
   * the false sentence became load-bearing.
   *
   * A fifth state is added: nothing acquired at all, which used to be THEIRS.
   */
  const portal = doc({ documentUrl: "https://example.gov/portal", text: "Board Portal Home Calendar Contact" });
  const cases: Array<[string, ReturnType<typeof classifyAgendaPublication>]> = [
    [
      "NOTHING ACQUIRED",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [],
        documentsAcrossCorpus: [],
        now: ROUTE_NOW,
      }),
    ],
    [
      "ACQUIRED, UNREADABLE",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [doc({ text: null, extraction: "failed" })],
        documentsAcrossCorpus: [doc({ text: null, extraction: "failed" })],
        now: ROUTE_NOW,
      }),
    ],
    [
      "A PORTAL, NOT AN AGENDA",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [portal],
        documentsAcrossCorpus: [portal, { ...portal, meetingId: "m2" }],
        now: ROUTE_NOW,
      }),
    ],
    [
      "READ, NO ITEMS",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [doc({ text: "The board will discuss the published budget proposal." })],
        documentsAcrossCorpus: [doc({ text: "The board will discuss the published budget proposal." })],
        now: ROUTE_NOW,
      }),
    ],
  ];

  const sentences = cases.map(([, r]) => r.gap?.statement ?? "");
  for (const [name, reading] of cases) {
    assert.ok(reading.gap, `${name} must produce a named gap`);
    assert.equal(reading.gap?.whose, "OURS", `${name} is a fact about US`);
    assert.equal(reading.obligationOpen, true, `${name} leaves the hunt open`);
  }
  assert.equal(
    new Set(sentences).size,
    cases.length,
    `a state lost its own sentence and collapsed into another: ${sentences.join(" | ")}`,
  );
  assert.equal(new Set(cases.map(([, r]) => r.acquisition)).size, cases.length);

  /* And the fifth: items reader-ready is NOT a gap at all. */
  const ready = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [doc()],
    documentsAcrossCorpus: [doc()],
    now: ROUTE_NOW,
  });
  assert.equal(ready.acquisition, "ITEMS_READER_READY");
  assert.equal(ready.gap, null);
  assert.equal(ready.obligationOpen, false);
  assert.ok(ready.items.length > 0);
});

test("a discovered link and a blocked route are their own states, and neither is an absence", () => {
  /*
   * RULING 184 — a blocked route may never become a blocked fact. `CAPTCHA`,
   * a 403 and a missing adapter are route facts; each one leaves the record
   * question entirely open, and the sentence a reader gets says so.
   */
  const discovered = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    discoveredDocumentUrl: "https://example.gov/agenda.pdf",
    now: ROUTE_NOW,
  });
  assert.equal(discovered.acquisition, "REPRESENTATION_DISCOVERED");
  assert.equal(discovered.gap?.whose, "OURS");

  const blocked = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    discoveredDocumentUrl: "https://example.gov/agenda.pdf",
    routeAttempts: [
      {
        meetingId: "m1",
        routeId: "novusagenda:direct",
        outcome: "BLOCKED",
        attemptedAt: "2026-08-29T00:00:00.000Z",
        note: "CAPTCHA",
      },
    ],
    now: ROUTE_NOW,
  });
  assert.equal(blocked.acquisition, "ROUTE_BLOCKED");
  assert.equal(blocked.gap?.whose, "OURS");
  assert.notEqual(blocked.gap?.statement, discovered.gap?.statement);
  assert.equal(blocked.alternateSearchOpen, true, "one blocked route is not an exhausted ladder");
});

test("an amended agenda is CURRENT plus SUPERSEDED, never one flat document", () => {
  /*
   * Agendas are revised and a silently revised agenda is itself news
   * (`lib/meetings/agenda-documents.ts` is append-only for this reason). The
   * reading names which version it was taken over and keeps the earlier ones
   * addressable rather than dropping them.
   */
  // An amendment is a change of CONTENT (2026-09-22): the same words at a
  // second address, or re-read on a later day, are one version, not two.
  const first = doc({ documentUrl: "https://example.gov/a-v1.pdf", retrievedAt: "2026-08-20T12:00:00.000Z" });
  const amended = doc({
    documentUrl: "https://example.gov/a-v2.pdf",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    text: "1. Call to order\n2. Approval of minutes\n3. Rezoning of parcel 44\n4. Road salt contract\n5. Adjournment",
  });
  const reading = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [first, amended],
    documentsAcrossCorpus: [first, amended],
    now: ROUTE_NOW,
  });
  assert.equal(reading.currentDocumentUrl, amended.documentUrl, "the CURRENT version is the newest");
  assert.deepEqual(reading.supersededDocumentUrls, [first.documentUrl]);
  assert.equal(reading.revised, true);
});

test("a publisher that says the agenda IS up, while we hold nothing, is still OURS", () => {
  /*
   * The one asymmetry worth stating: their page saying a packet is posted is
   * evidence about THEM and changes nothing about what we hold. It makes the
   * gap MORE clearly ours, not less, and the sentence says where to go next
   * rather than reporting an absence that does not exist.
   */
  const reading = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [firstParty({ meetingId: "m1", report: "AVAILABLE" })],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "REPORTS_AVAILABLE");
  assert.equal(reading.gap?.whose, "OURS");
  assert.match(reading.gap!.statement, /going after it/);
  assert.equal(reading.obligationOpen, true);
});
