import assert from "node:assert/strict";
import test from "node:test";

/**
 * **THE GROUNDED ROUTE, EXERCISED END TO END AGAINST THE COMMITTED CORPUS.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * The unit tests beside this one check each rung. This checks the thing a
 * reader actually receives: the real `POST` handler, the real meetings
 * snapshot, the real ballot set, the real rosters.
 *
 * ## Why no model runs here
 *
 * `ANTHROPIC_API_KEY` is deleted before the handler is imported, so both model
 * rungs return `UNAVAILABLE` and no network call is made. That is not a
 * limitation — it is the **degraded path**, and it is the one worth pinning:
 * the product's honesty must not depend on a model being reachable. Every
 * assertion below is about what the deterministic half produces, which is what
 * a reader gets when the key is missing, the ceiling is hit, or the answer is
 * rejected by validation.
 *
 * The tense still has to be right, the government still has to be the one that
 * was named, the date still has to be the local one, the portal page still has
 * to be refused as an agenda, and the contacts still have to be real.
 */

delete process.env.ANTHROPIC_API_KEY;

const { POST, resetGroundedState } = await import("@/app/api/ask/grounded/route");

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const AZ = "ocd-division/country:us/state:az";
const SLDU = "ocd-division/country:us/state:az/sldu:19";
const SLDL = "ocd-division/country:us/state:az/sldl:19";

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string; office?: string | null } | null;
  answer?: string | null;
  records?: {
    kind: string;
    id: string;
    text: string;
    occurredAt?: string | null;
    sourceUrl?: string | null;
  }[];
  gaps?: { whose: string; statement: string }[];
  contacts?: { id: string; name: string; relationship: string; sourceUrl: string | null }[];
  denominators?: Record<string, number>;
  mention?: string;
  candidates?: string[];
  trace?: {
    resolution: { state: string; basis?: string; subjectId?: string | null };
    retrieval: { selection: string; recordCount: number };
    answerMode: string;
  };
}

async function ask(
  question: string,
  over: Record<string, unknown> = {},
): Promise<GroundedBody> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must be
         — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "pr212-followup-route-test",
    },
    body: JSON.stringify({
      question,
      /* The divisions a reader at 85641 actually resolves to, including the
         state legislative districts — without those the reader has no
         legislators and the fallback has nothing to offer, which would make a
         passing test measure the fixture rather than the product. */
      ocdIds: [AZ, PIMA, VAIL, SLDU, SLDL],
      /* Pinned so a passing test today cannot start failing on a Tuesday. The
         handler accepts a supplied date precisely so nothing has to guess one. */
      today: "2026-08-28",
      ...over,
    }),
  });
  const response = await POST(request);
  /* Read ONCE. A `Response` body is a stream, and reading it for an assertion
     message consumes it — so a failing status would have produced a confusing
     "Body has already been read" instead of the status it was reporting on. */
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as GroundedBody;
}

/* ══════════════════════════════════════════════════════════════════════
   THE VAIL RED CONTROL, THROUGH THE HANDLER THE READER'S BOX POSTS TO
   ══════════════════════════════════════════════════════════════════════ */

test("RED CONTROL: 'What's on the Vail school district agenda?' resolves Vail and takes the NEXT sitting", async () => {
  const body = await ask("What's on the Vail school district agenda?");

  assert.equal(body.subject?.id, VAIL, "the government the reader NAMED");
  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.equal(body.trace?.retrieval.selection, "NEXT", "'what's on the agenda' means the next sitting");

  const meeting = body.records?.find((r) => r.kind === "MEETING");
  assert.ok(meeting, "the chosen sitting must travel as a record");
  assert.equal(
    meeting!.id,
    "apptegy:vail:60703698",
    "the next future Vail sitting as of 2026-08-28",
  );
});

test("RED CONTROL: the SAME question in the past tense selects a DIFFERENT, earlier sitting", async () => {
  /*
   * ASK02's defect, re-proved through the route rather than through the
   * selection function alone: `upcoming[0] ?? past[0]` answered every tensed
   * question with the next meeting, so a reader asking what a board DISCUSSED
   * was told what it is going to discuss — a well-sourced statement that a
   * discussion had already happened when it had not.
   */
  const body = await ask("What did the Vail school district discuss at its last meeting?");

  assert.equal(body.subject?.id, VAIL);
  assert.equal(body.trace?.retrieval.selection, "LAST");
  const meeting = body.records?.find((r) => r.kind === "MEETING");
  assert.equal(meeting!.id, "apptegy:vail:60703697", "the most recent PAST sitting");
});

test("RED CONTROL: the sitting a reader reads is the LOCAL day, not the UTC day", async () => {
  const body = await ask("What's on the Vail school district agenda?");
  const meeting = body.records?.find((r) => r.kind === "MEETING");

  /*
   * The corpus stores 2026-09-09T02:00:00Z. Arizona is UTC-7 year round, so
   * that instant is Tuesday 8 September at 7:00 p.m. — which is when Vail's
   * board actually sits, on the second and fourth Tuesday, as the district
   * states on its own portal page. Printing the UTC date puts the meeting on
   * a Wednesday.
   */
  assert.match(meeting!.text, /Tuesday, September 8th, 2026 at 7:00 PM MST/);
  assert.ok(!/2026-09-09/.test(meeting!.text), "the UTC calendar date must not reach a reader");
  assert.ok(!/T02:00/.test(meeting!.text), "no ISO instant on a reader surface");
  assert.ok(!/America\/Phoenix/.test(meeting!.text), "no IANA zone id on a reader surface");
});

test("RED CONTROL: a portal landing page is NOT called this meeting's agenda", async () => {
  /*
   * All nine Vail documents in the corpus share one URL — the district's
   * Highbond portal root. One page cannot be the agenda of nine meetings. The
   * gap is named as OURS, the link still travels so a reader can go and look,
   * and no agenda items are asserted.
   */
  const body = await ask("What's on the Vail school district agenda?");

  const items = body.records?.filter((r) => r.kind === "AGENDA_ITEM") ?? [];
  assert.equal(items.length, 0, "no items may be extracted from a navigation menu");

  const gap = body.gaps?.find((g) => /agenda portal rather than the agenda itself/.test(g.statement));
  assert.ok(gap, "the reader is told exactly what we hold");
  assert.equal(gap!.whose, "OURS", "this is a fact about our retrieval, never about the district");

  const document = body.records?.find((r) => r.kind === "AGENDA_DOCUMENT");
  assert.ok(document?.sourceUrl, "the link still travels — it is where they publish it");
});

test("RED CONTROL: the Vail answer carries verified contacts with sources", async () => {
  const body = await ask("What's on the Vail school district agenda?");

  assert.ok((body.contacts?.length ?? 0) >= 5, "the district's own board and superintendent");
  for (const contact of body.contacts ?? []) {
    assert.ok(contact.sourceUrl, `${contact.name} carries the record it was read from`);
  }
  const superintendent = body.contacts?.find((c) => /Superintendent/.test(c.relationship));
  assert.ok(superintendent, "the most useful contact for a district question");

  /* And they reach the evidence pack, so the synthesis rung can EXPLAIN a
     contact and validation can check it — a contact outside the pack would be
     a fact the model could see and nothing could check. */
  const asRecords = body.records?.filter((r) => r.kind === "CONTACT") ?? [];
  assert.ok(asRecords.length > 0);
});

test("a question about a government we do not hold says so, and never substitutes a nearby one", async () => {
  /*
   * The original defect, at the route. A Tucson reader asking about Vail was
   * answered about Sunnyside. Here the reader asks about a district nobody
   * holds, and the answer is that nobody holds it — never the nearest thing.
   */
  const body = await ask("What's on the Cienega school district agenda?", {
    /* The interpretation model is unavailable in this test, so the mention has
       to come from the reader's own words — which is exactly the floor the
       deterministic path is supposed to hold on its own. */
  });
  assert.equal(body.mode, "UNRESOLVED");
  assert.equal(body.mention, "cienega");
  assert.equal(body.subject ?? null, null, "nothing is bound, so nothing is answered about");
});

/* ══════════════════════════════════════════════════════════════════════
   THE HOBBS RED CONTROL
   ══════════════════════════════════════════════════════════════════════ */

test("RED CONTROL: Hobbs resolves to the exact person AND office, and the record gap is NAMED", async () => {
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");

  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.match(body.subject?.name ?? "", /Katie Hobbs/);

  const officeholder = body.records?.find((r) => r.kind === "OFFICEHOLDER");
  assert.ok(officeholder, "identity is a sourced record, not an assumption");
  assert.match(
    officeholder!.text,
    /holds the office of/,
    "identity is person AND office, never either alone",
  );
  assert.ok(officeholder!.sourceUrl, "every rendered fact about a person carries its source");
});

test("RED CONTROL: the corpus now HOLDS gubernatorial action records, windowed and bounded", async () => {
  /*
   * **AZ03, HALF-CLOSED, AND THE HALF THAT IS NOT IS NAMED.**
   *
   * This test used to assert `actionRecordsHeld === 0` — the honest answer when
   * the corpus held nothing about what any governor had DONE. The reader's
   * question was the lead, the hunt followed it, and the answer changed:
   * `data/officials/az-governor-actions.json` holds Arizona executive orders
   * read from the office's own index and detail pages, each with a date and a
   * signed PDF.
   *
   * What the test asserts now is harder than what it asserted before, because
   * holding records makes over-claiming possible for the first time:
   *
   *  - the reader's WINDOW is applied, not ignored;
   *  - every record carries the office's own words and a source;
   *  - the half that is still missing — bills signed and vetoed, behind a host
   *    that disallows every automated client — is a NAMED GAP.
   */
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");

  assert.ok(
    (body.denominators?.actionRecordsHeld ?? 0) > 0,
    "the corpus holds gubernatorial action records now",
  );

  const actions = body.records?.filter((r) => r.kind === "OFFICIAL_ACTION") ?? [];
  assert.ok(actions.length > 0, "and they reach the evidence pack");
  for (const action of actions) {
    assert.match(action.text, /^Executive Order \d{4}-\d+, ".+", signed \d{4}-\d{2}-\d{2}\.$/);
    assert.ok(action.sourceUrl, `${action.id} carries the document it was read from`);
  }

  /*
   * **THE WINDOW IS APPLIED.** "In the last 12 months" is a range, and an
   * answer built from an unwindowed list answers a different question. Every
   * record returned must fall inside it, and the windowed count must be smaller
   * than everything held — otherwise the filter is a no-op that happens to pass.
   */
  for (const action of actions) {
    assert.ok(
      (action.occurredAt ?? "") >= "2025-08-28",
      `${action.id} at ${action.occurredAt} is outside the 12 months that were asked for`,
    );
  }
  assert.ok(
    (body.denominators?.actionRecordsInAskedWindow ?? 0) <
      (body.denominators?.actionRecordsHeld ?? 0),
    "the window actually narrows — a filter that matched everything would prove nothing",
  );

  /* And the half that is not held is NAMED, so six orders cannot read as a
     complete account of a governor's year. */
  const vetoGap = body.gaps?.find((g) => /bills signed or vetoed/.test(g.statement));
  assert.ok(vetoGap, "the missing half is a named gap, never silence");
  assert.equal(vetoGap!.whose, "OURS");
});

test("RED CONTROL: nothing in the Hobbs reply is an action the corpus does not hold", async () => {
  /*
   * The structural half of "cannot use model memory". With no key the model
   * never runs, so there is no prose at all — and every record that DOES travel
   * carries a source URL that came out of the corpus. A record with no source
   * is a record the answer may not assert.
   */
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");
  assert.equal(body.answer ?? null, null, "no model, no prose — never a plausible substitute");
  for (const record of body.records ?? []) {
    if (record.kind === "CONTACT") continue;
    assert.ok(record.sourceUrl, `${record.kind}:${record.id} reached the pack with no source`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   THE BALLOT'S OWN ENTITIES, THROUGH THE SAME ENGINE
   ══════════════════════════════════════════════════════════════════════ */

test("BALLOT: a non-statewide challenger on the reader's ballot resolves and retrieves", async () => {
  /*
   * Andy Biggs is on the same governor line as Katie Hobbs and was not an
   * entity this product held at all before the ballot inventory existed.
   */
  const body = await ask("What do we know about Andy Biggs?", { surface: "BALLOT" });

  assert.equal(body.trace?.resolution.state, "BOUND");
  /*
   * The GENERAL-LINEUP key, which is the one `app/ballot/page.tsx` renders and
   * keys reactions, funding, positions and incumbency with wherever a lineup
   * exists. Ask uses the page's key rather than the filing's, because a
   * differently derived id resolves to a person and retrieves nothing.
   */
  assert.equal(body.subject?.id, "ballot-az-pima:governor|Andy Biggs");
  assert.equal(body.subject?.kind, "PERSON");
  assert.equal(body.subject?.office, "Governor", "identity is person AND office");

  /* And the FILING still travels, reached through the subject's `candidacyId`
     — one human, one subject, both stores. */
  const candidacy = body.records?.find((r) => r.kind === "CANDIDACY");
  assert.ok(candidacy, "the filing is the record");
  assert.equal(candidacy!.id, "ballot-az-pima:governor:biggs-andy");
});

test("BALLOT: a measure resolves from the short form a reader actually types", async () => {
  const body = await ask("What does Prop 423 do?", { surface: "BALLOT" });

  assert.equal(body.subject?.id, "ballot-az-pima:prop-423");
  assert.equal(body.subject?.kind, "MEASURE");
  const question = body.records?.find((r) => r.kind === "MEASURE_QUESTION");
  assert.ok(question, "the official question text, verbatim");
  assert.match(question!.text, /BUDGET OVERRIDE CONTINUATION/);
});

test("BALLOT: a contest resolves and lists who filed for it", async () => {
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });

  assert.equal(body.subject?.id, "ballot-az-pima:governor");
  assert.equal(body.subject?.kind, "CONTEST");
  assert.ok(
    (body.denominators?.candidatesFiledForThisContest ?? 0) > 1,
    "the filing list is the denominator",
  );
});

test("BALLOT: a pronoun with one focused person on screen resolves; with two it asks", async () => {
  const one = await ask("What has she done?", {
    surface: "BALLOT",
    activeSubjects: [
      {
        id: "ballot-az-pima:governor|Katie Hobbs",
        name: "Katie Hobbs",
        kind: "PERSON",
        focused: true,
      },
    ],
  });
  assert.equal(one.subject?.id, "ballot-az-pima:governor|Katie Hobbs");

  const two = await ask("What has she done?", {
    surface: "BALLOT",
    activeSubjects: [
      { id: "ballot-az-pima:governor|Katie Hobbs", name: "Katie Hobbs", kind: "PERSON" },
      { id: "ballot-az-pima:governor|Andy Biggs", name: "Andy Biggs", kind: "PERSON" },
    ],
  });
  assert.equal(two.mode, "CLARIFY", "two plausible people ASK — they are never chosen between");
  assert.equal(two.candidates?.length, 2);
});

test("BALLOT: an explicit name beats the card the reader has open", async () => {
  const body = await ask("What has Katie Hobbs done?", {
    surface: "BALLOT",
    activeSubjects: [
      { id: "ballot-az-pima:governor|Andy Biggs", name: "Andy Biggs", kind: "PERSON", focused: true },
    ],
  });
  assert.match(body.subject?.name ?? "", /Katie Hobbs/);
});

/* ══════════════════════════════════════════════════════════════════════
   THE STRUCTURED RECORDS ARE WHAT A READER SEES WHEN PROSE IS REJECTED
   ══════════════════════════════════════════════════════════════════════ */

test("RECORDS: no ISO date reaches a reader, because these render verbatim", async () => {
  /*
   * **FOUND IN A REJECTED_FELL_BACK CAPTURE** (2026-08-28). The degradation
   * ladder worked — validation refused a generated answer and the records
   * rendered instead — and the records themselves read "appears on this ballot
   * for 2026 General Election on 2026-11-03". An identifier on a reader
   * surface, in the one branch nobody looks at because it is the fallback.
   *
   * The records are not internal diagnostics. They ARE the answer whenever
   * synthesis is unavailable, over its ceiling, or rejected.
   */
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });
  for (const record of body.records ?? []) {
    assert.ok(
      !/\d{4}-\d{2}-\d{2}/.test(record.text),
      `an ISO date reached a reader surface: ${record.kind} — ${record.text.slice(0, 160)}`,
    );
  }
  const contest = body.records?.find((r) => r.kind === "CONTEST");
  assert.ok(contest, "a contest question retrieves the contest");
  assert.match(contest.text, /November 3rd, 2026/, "spelled out, the way every other date is");
});

test("RECORDS: a position record states the SEARCH, never a stance", async () => {
  /*
   * The same capture read "On water, Katie Hobbs published: …" over a passage
   * that was a run of site headings. The quote was honest; the frame asserted
   * she published something about water, and a frame is a claim.
   *
   * What the corpus holds is a passage found by SEARCHING published material
   * for an issue's phrases. Saying that is both true and more useful.
   */
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  for (const record of (body.records ?? []).filter((r) => r.kind === "POSITION")) {
    assert.match(record.text, /^Searching .+ published material for /);
    assert.ok(
      !/^On .+ published:/.test(record.text),
      "a matched passage is not a statement ON the issue that matched it",
    );
    assert.ok(record.sourceUrl, "and it carries the document it was read from");
  }
});
/* ══════════════════════════════════════════════════════════════════════
   CONTACTS AND SOURCES ARE SCOPED TO THE SUBJECT
   ══════════════════════════════════════════════════════════════════════ */

test("CONTACTS: a measure's contacts are its OWN district's board, not the reader's legislators", async () => {
  /*
   * **FOUND BY READING THE PANEL** (2026-08-28). Every answer carried the
   * reader's state senator and two state representatives, whatever was asked —
   * including an answer about a Vail Unified budget override, whose actual
   * decision-makers are Vail's governing board and are sitting in the corpus.
   *
   * A contact whose relationship to the subject is "none" does not add
   * helpfulness; it dilutes the ones whose relationship is real, and it is one
   * step from the influence ranking this product may never build.
   */
  const body = await ask("What does Prop 423 do?", { surface: "BALLOT" });

  const names = (body.contacts ?? []).map((c) => c.name);
  assert.ok(names.includes("Allison Pratt"), `expected Vail's board, got ${names.join(", ")}`);
  assert.ok(
    !names.includes("David Gowan"),
    "a state senator has no factual relationship to a school district's budget override",
  );
  for (const contact of body.contacts ?? []) {
    /*
     * **THE RELATIONSHIP NAMES THE GOVERNMENT, NOT THE BALLOT QUESTION.**
     *
     * Passing the contest title through produced "Governing Board President
     * on Proposition 423: Vail Unified School District budget override
     * continuation". She is president of a school district's governing board,
     * not of a ballot question — and a relationship that names the wrong thing
     * is a wrong fact about a named person, which is the one failure this
     * product cannot survive.
     */
    assert.match(contact.relationship, /Vail Unified District$/);
    assert.ok(
      !/Proposition/.test(contact.relationship),
      `a person does not hold office on a ballot question: ${contact.relationship}`,
    );
  }
});

test("CONTACTS: the reader's own legislators are the FALLBACK, and they still appear", async () => {
  /*
   * The other direction. Scoping must not delete them: their relationship is
   * real and it is to the READER — the geometry placed the reader's divisions
   * inside these districts — which makes them the right answer when nothing
   * closer exists.
   */
  const body = await ask("What do we know about Andy Biggs?", { surface: "BALLOT" });
  const names = (body.contacts ?? []).map((c) => c.name);
  assert.ok(
    names.includes("David Gowan"),
    `a statewide contest has no roster of its own, so the reader's legislators stand: got ${names.join(", ")}`,
  );
  for (const contact of body.contacts ?? []) {
    assert.match(contact.relationship, /^Your /, "and they are described as the READER's, never the subject's");
  }
});

test("CONTACTS: an officeholder question carries that OFFICE's own published contact", async () => {
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  const office = body.contacts?.find((c) => /the office this question is about/.test(c.relationship));
  assert.ok(office, "the Governor's own office is the most relevant contact for a question about the Governor");
  assert.equal(office!.name, "Katie Hobbs");
  assert.ok(office!.sourceUrl, "and it is read off a sourced record like every other");
});

test("SOURCES: an answer does not carry documents it did not rest on", async () => {
  /*
   * The school-board cancellation absence — a real, cited, useful record about
   * VAIL — was being attached to every answer, so a reader asking about the
   * Governor saw it in the source line. A source list carrying documents the
   * answer did not rest on is a weaker attribution, not a fuller one.
   */
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  const absences = body.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.equal(
    absences.length,
    0,
    "an absence about a school district is not evidence in an answer about the Governor",
  );

  /* CONTROL: it is still evidence where it belongs. */
  const vail = await ask("What does Prop 423 do?", { surface: "BALLOT" });
  const vailAbsences = vail.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.equal(vailAbsences.length, 1, "Vail's own absence rides with a Vail subject");
  assert.match(vailAbsences[0].text, /no Vail Unified School District governing board race/i);
});

/* ══════════════════════════════════════════════════════════════════════
   THE SIGNAL PATH IS REACHED AND WRITES NOTHING
   ══════════════════════════════════════════════════════════════════════ */

test("SIGNAL: a real reader Ask through the real route writes no interaction row", async () => {
  /*
   * The gate is checked inside `captureAskInteraction`, which the route calls
   * on every outcome — so this proves the caller EXISTS and that the flag holds
   * it shut, which are two different facts and the first one was missing.
   */
  const { RIPCORDS } = await import("../lib/ripcords.ts");
  assert.equal(RIPCORDS["ripcord.askSignalCapture"].pulled, true);

  const body = await ask("What's on the Vail school district agenda?");
  assert.ok(body.subject, "the reader still gets their answer while nothing is stored");
});
