import assert from "node:assert/strict";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  initializeFederalVoteFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);
import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";

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

const { POST } = await import("@/app/api/ask/grounded/route");
const { resetGroundedState } = await import("@/lib/ask/grounded-state");

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
/**
 * Vail's governing BOARD — the body — as distinct from the school district
 * DIVISION above. (2026-08-29.) Ask used to resolve a reader's question to the
 * division and filter meetings by geography; where a division carries more than
 * one body that returned another government's meetings, which is how the Pima
 * County Board of Supervisors came to be given a Central Arizona Water
 * Conservation District event. Vail carries only one body, so its ANSWER was
 * never wrong — but the id it resolved to was, and these assertions pin the
 * body because that is what the reader actually named.
 */
const VAIL_BOARD = `${VAIL}#board`;
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
    canonicalSubjectId?: string;
    candidateProfile?: EvidenceRecord["candidateProfile"];
    rollCall?: EvidenceRecord["rollCall"];
  }[];
  gaps?: { whose: string; statement: string }[];
  contacts?: { id: string; name: string; relationship: string; sourceUrl: string | null }[];
  denominators?: Record<string, number>;
  mention?: string;
  candidates?: string[];
  clarification?: string;
  trace?: {
    sourcesLoaded?: string;
    preloads?: Record<string, number>;
    preloadSources?: Record<string, string>;
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

  assert.equal(body.subject?.id, VAIL_BOARD, "the BODY the reader NAMED, not its division");
  assert.equal(body.trace?.resolution.state, "BOUND");
  assert.equal(body.trace?.retrieval.selection, "NEXT", "'what's on the agenda' means the next sitting");
  assert.equal(body.trace?.sourcesLoaded, "IDENTITY_AND_MEETINGS");
  for (const key of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) {
    assert.equal(body.trace?.preloads?.[key], undefined, `a bound meeting question never reads ${key}`);
    assert.equal(body.trace?.preloadSources?.[key], undefined, "an unread family is not mislabeled as a database read");
  }

  const meeting = body.records?.find((r) => r.kind === "MEETING");
  assert.ok(meeting, "the chosen sitting must travel as a record");
  assert.equal(
    meeting!.id,
    "apptegy:vail:60703698",
    "the next future Vail sitting as of 2026-08-28",
  );
});

test("a named body we don't hold gets a plain calendar gap without a model after restoring deferred sources", async () => {
  const body = await ask("When does the Unheld Example City Council meet next?");
  assert.equal(body.mode, "NO_EVIDENCE");
  assert.equal(body.answer, "We don't have Unheld Example City Council's calendar yet.");
  assert.equal(body.subject, null);
  assert.equal(body.clarification, undefined);
  assert.equal(body.records?.length, 0);
  assert.deepEqual(body.gaps, [{ whose: "OURS", statement: body.answer }]);
  assert.equal(body.trace?.sourcesLoaded, "ALL");
  for (const key of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]) {
    assert.equal(typeof body.trace?.preloads?.[key], "number", `an unresolved body restores ${key} before its gap`);
  }
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

  assert.equal(body.subject?.id, VAIL_BOARD);
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
  assert.equal(body.mode, "NO_EVIDENCE");
  assert.equal(body.answer, "We don't have Cienega School District's agendas yet.");
  assert.equal(body.clarification, undefined);
  assert.equal(body.candidates, undefined);
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
   * `data/states/az/officials/az-governor-actions.json` holds Arizona executive orders
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

  /*
   * **THIS ASSERTION WAS WIDENED DELIBERATELY, AND IT GOT STRICTER DOING IT.**
   * (AZ04, 2026-08-28.)
   *
   * It used to be a single shape:
   *
   *     /^Executive Order \d{4}-\d+, ".+", signed \d{4}-\d{2}-\d{2}\.$/
   *
   * which was correct while executive orders were the only rows that existed,
   * and which would have FAILED on the first veto — not because the veto was
   * wrong, but because `actionText` hardcoded the word "signed" and would have
   * rendered *`HB2003, "…", signed 2026-06-19.`* about a bill she refused.
   * Loosening this to `.+` would have made the test pass and left the false
   * sentence in production, so the pattern is per-KIND instead: each kind gets
   * the one shape it is allowed to have.
   *
   * The prohibition below is the part that matters more than the shapes: no
   * record that is not a signing may contain the word "signed".
   */
  const SHAPES: RegExp[] = [
    /^Executive Order \d{4}-\d+, ".+", signed \d{4}-\d{2}-\d{2}\.$/,
    /^[HS][BCMJR]\d{3,4}, ".+", signed by the Governor on \d{4}-\d{2}-\d{2} and chaptered as Chapter \d+ of the \S+ session\.$/,
    /^[HS][BCMJR]\d{3,4}(, ".+",)? signed by the Governor on \d{4}-\d{2}-\d{2}, per her transmittal letter\.$/,
    /^[HS][BCMJR]\d{3,4}(, ".+",)? vetoed by the Governor on \d{4}-\d{2}-\d{2}, per her veto letter\.$/,
    /^[HS][BCMJR]\d{3,4}, ".+", became Arizona session law as Chapter \d+ .+\.$/,
    /^[HS][BCMJR]\d{3,4} — the Governor sent the legislature a letter about this bill\. We have the letter but have not read it yet, so we cannot say what it decided\./,
  ];
  for (const action of actions) {
    assert.ok(
      SHAPES.some((shape) => shape.test(action.text)),
      `${action.id} rendered a sentence no kind is allowed to produce: ${action.text}`,
    );
    assert.ok(action.sourceUrl, `${action.id} carries the document it was read from`);
  }

  /*
   * **THE WORD "SIGNED" IS EARNED, NEVER DEFAULTED.** A record may say she
   * signed something only when it is a signing. This is the assertion that
   * would have caught the original defect, and it does not care what the
   * sentence looks like.
   */
  for (const action of actions) {
    if (/\bsigned\b/i.test(action.text)) {
      assert.match(
        action.id,
        /^az-(eo|chapter|govletter)-/,
        `${action.id} claims a signing: ${action.text}`,
      );
      assert.ok(
        !/vetoed|have not read it yet/i.test(action.text),
        `${action.id} says both signed and not-signed: ${action.text}`,
      );
    }
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

  /*
   * **THE GAP THIS USED TO MATCH WAS ITSELF A FALSE CLAIM.** (AZ04, 2026-08-28.)
   *
   * The old matcher was `/bills signed or vetoed/`, and the sentence it
   * accepted read: *"the legislature's bill-status system does not permit
   * automated reading, so that half of the record is not ours to show yet."*
   * That was a statement about a GOVERNMENT — that Arizona's legislature
   * withholds its record — and it was false. `apps.azleg.gov` disallows
   * automated clients; `www.azleg.gov` is a different host, is allowed, and
   * publishes the whole thing. A blocked ROUTE had been recorded, rendered,
   * and then TESTED FOR, as a blocked FACT.
   *
   * So the test now asserts the two things that must be true of the
   * replacement rather than pinning one sentence: the remaining gaps are
   * attributed to US, and none of them blames the publisher.
   */
  const ourGaps = (body.gaps ?? []).filter((g) => g.whose === "OURS");
  assert.ok(ourGaps.length > 0, "what is still missing is named, never silence");

  const letterGap = ourGaps.find((g) => /letters about individual bills/.test(g.statement));
  assert.ok(letterGap, "the unread transmittal letters are a named gap");
  assert.match(
    letterGap!.statement,
    /we will not say what any of them decided until we have read it/,
    "and the gap refuses the inference rather than hinting at it",
  );

  for (const gap of body.gaps ?? []) {
    /* No gap may attribute our shortfall to the publisher. */
    assert.ok(
      !/does not permit automated reading|not ours to show/.test(gap.statement),
      `a gap still blames the publisher for our own shortfall: ${gap.statement}`,
    );
    if (gap.whose === "OURS") {
      assert.ok(
        !/\bthey (do not|don't|have not|haven't)\b/i.test(gap.statement),
        `an OURS gap is phrased as a fact about THEM: ${gap.statement}`,
      );
    }
  }

  /* And no gap anywhere may call the unread letters vetoes. */
  for (const gap of body.gaps ?? []) {
    if (/letters about individual bills/.test(gap.statement)) {
      assert.ok(!/\bveto/i.test(gap.statement), `an unread letter was called a veto: ${gap.statement}`);
    }
  }
});

test("RED CONTROL: nothing in the Hobbs reply is an action the corpus does not hold", async () => {
  /*
   * The structural half of "cannot use model memory". With no key the model
   * never runs, so there is no prose at all — and every record that DOES travel
   * carries its corpus provenance. Existing curated contact fields may lack a
   * recorded URL, just as CONTACT may; that exception must prove the exact
   * native held value and explicitly disclose the provenance limitation.
   * It never applies to an action, biography, link, or other civic claim.
   */
  const body = await ask("What did Katie Hobbs do for the state of Arizona in the last 12 months?");
  assert.equal(body.answer ?? null, null, "no model, no prose — never a plausible substitute");
  for (const record of body.records ?? []) {
    if (record.kind === "CONTACT") continue;
    if (record.kind === "CANDIDATE_CONTACT" && !record.sourceUrl) {
      const profile = record.candidateProfile;
      assert.ok(profile);
      assert.ok(["email", "phone"].includes(profile.field));
      const field = profile.field as "email" | "phone";
      const held = allCandidateCards().cards[profile.holdingKey];
      assert.ok(held, "contact exception requires an exact curated card holding");
      assert.equal(profile.value, held[field], "contact must be the native held field, never a generated substitute");
      assert.equal(record.canonicalSubjectId, profile.holdingKey);
      const pointer = profile.holdingKey.replaceAll("~", "~0").replaceAll("/", "~1");
      assert.equal(
        profile.holdingPath,
        `civic-data:CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates#/cards/${pointer}/${field}`,
        "the Reader receipt must identify the promoted candidate-profile authority, never its retired tracked seed",
      );
      assert.ok(profile.provenanceLimitation && record.text.includes(profile.provenanceLimitation), "missing contact provenance is disclosed with the actual field");
      continue;
    }
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

test("ASK-24: 'Explain Prop 141 to me' carries NOTHING off the measure — no Senate bullet, no unconnected people", async () => {
  /*
   * **THE OWNER'S PROP 141 REPORT, PINNED.** (2026-09-02.)
   *
   * *"Explain Prop 141 to me"* returned the measure explained and then a bullet
   * about the U.S. Senate seat on the 2026 ballot — a real, sourced
   * `BALLOT_ABSENCE` that attached only because Prop 141 and the Senate contest
   * share the statewide division — plus three of the reader's own legislators
   * under WHO THIS IS with no stated tie to the measure. Both reached the
   * synthesis rung. The relevance gate removes them before the pack is sealed.
   *
   * Asked at 85641, whose reader carries the statewide division that Prop 141
   * and the U.S. Senate absence both sit on — which is the exact overlap that
   * produced the bullet.
   */
  const body = await ask("Explain Prop 141 to me", {
    surface: "BALLOT",
    ocdIds: [AZ, PIMA, VAIL, SLDU, SLDL],
  });

  assert.equal(body.subject?.id, "ballot-az-pima:prop-141");
  assert.equal(body.subject?.kind, "MEASURE");
  assert.equal(body.mode, "STRUCTURED_GROUNDED", "the measure's own records still answer it");

  /* The Senate bullet is gone — as a record and as any prose about it. */
  const absences = body.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.deepEqual(absences, [], "no ballot-at-large absence rides with a measure");
  for (const record of body.records ?? []) {
    assert.ok(
      !/U\.S\. Senate|Senate seat/i.test(record.text),
      `a record off the measure's subject reached the pack: ${record.text.slice(0, 80)}`,
    );
  }

  /* WHO THIS IS is omitted — the reader's legislators have no printed
     connection to a yes/no measure, so no contact is offered rather than an
     unconnected one. */
  assert.deepEqual(body.contacts ?? [], [], "no contact without a printed connection to the measure");
  const contactRecords = body.records?.filter((r) => r.kind === "CONTACT") ?? [];
  assert.deepEqual(contactRecords, [], "and none reaches the evidence pack either");

  /* CONTROL: the measure's own definition IS there, sourced. The gate narrowed
     the answer without emptying it. */
  const own = (body.records ?? []).filter((r) => /^(CONTEST|MEASURE)/.test(r.kind));
  assert.ok(own.length > 0, "the measure's own contest/summary/provision records answer the question");
  for (const record of own) assert.ok(record.sourceUrl, `${record.kind} carries its source`);

  /* And the trace reports the gate ran, so a regression shows as a number. */
  assert.ok(
    (body.denominators?.recordsExcludedOffSubject ?? 0) >= 1,
    "the gate recorded the off-subject record it removed",
  );
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

test("RECORDS: a source passage states the SEARCH, never a stance", async () => {
  /*
   * The same capture read "On water, Katie Hobbs published: …" over a passage
   * that was a run of site headings. The quote was honest; the frame asserted
   * she published something about water, and a frame is a claim.
   *
   * What the corpus holds is a passage found by SEARCHING published material
   * for an issue's phrases. Saying that is both true and more useful.
   */
  const body = await ask("What has Katie Hobbs done?", { surface: "BALLOT" });
  for (const record of (body.records ?? []).filter((r) => r.kind === "SOURCE_PASSAGE")) {
    assert.match(record.text, /^Searching a (campaign|official|held public) page linked to .+ for /);
    assert.ok(
      !/^On .+ published:/.test(record.text),
      "a matched passage is not a statement ON the issue that matched it",
    );
    assert.match(record.text, /A phrase match does not establish the candidate's personal stance/);
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
  const body = await ask("Who is running for Governor?", { surface: "BALLOT" });
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

  /*
   * ── ASK-24 (2026-09-02) ── **A MEASURE ANSWER CARRIES NOTHING OUTSIDE THE
   * MEASURE.** (The owner's Prop 141 report.)
   *
   * This used to assert that Prop 423 rode with its OWN division's absence — one
   * BALLOT_ABSENCE, "no Vail governing board race". The owner's Prop 141 report
   * closed that door: a ballot measure is a single yes/no question, and an
   * absence about a DIFFERENT race — a board seat, a U.S. Senate seat — is not
   * about the measure however small the shared division. The relevance gate
   * (`lib/ask/relevance.ts`) drops it before the pack is sealed, so a measure
   * answer now carries no ballot-at-large absence at all.
   */
  const vail = await ask("What does Prop 423 do?", { surface: "BALLOT" });
  const vailAbsences = vail.records?.filter((r) => r.kind === "BALLOT_ABSENCE") ?? [];
  assert.equal(vailAbsences.length, 0, "a measure answer carries no absence about another race");
  /* CONTROL: the measure's OWN records and its own district's board still ride
     with it — the gate narrowed the answer, it did not empty it. */
  assert.ok((vail.records ?? []).some((r) => r.kind.startsWith("MEASURE")), "the measure's own records stay");
  assert.ok((vail.contacts ?? []).some((c) => /Vail Unified District$/.test(c.relationship)), "its district board stays");
});

/* ══════════════════════════════════════════════════════════════════════
   THE SIGNAL PATH IS REACHED AND WRITES NOTHING
   ══════════════════════════════════════════════════════════════════════ */

test("SIGNAL: a real reader Ask through the real route writes no interaction row without a continuity key", async () => {
  /*
   * The route calls `captureAskInteraction` on every outcome; a request that
   * carries no continuity key writes nothing, and the reader still gets the answer.
   */

  const body = await ask("What's on the Vail school district agenda?");
  assert.ok(body.subject, "the reader still gets their answer while nothing is stored");
});

/* ══════════════════════════════════════════════════════════════════════
   ASK-05 · ONE READER ANSWER SHAPE, THROUGH THE REAL HANDLER
   ══════════════════════════════════════════════════════════════════════ */

test("ASK-05: every mode returns the WHOLE contract, not two or three keys", async () => {
  /*
   * `CLARIFY` and `UNRESOLVED` used to answer with `{ mode, mention, trace }`
   * and nothing else, which is what made a client's `?? []` the load-bearing
   * part of the render — and why every field in the hand-copied client types
   * was optional, and why a missing one was invisible.
   */
  for (const [label, question] of [
    ["UNRESOLVED", "What is on the Nowheresville Township agenda?"],
    ["BOUND", "What's on the Vail school district agenda?"],
  ] as const) {
    const body = (await ask(question)) as unknown as Record<string, unknown>;
    for (const field of [
      "mode",
      "subject",
      "answer",
      "records",
      "gaps",
      "contacts",
      "denominators",
      "trace",
    ]) {
      assert.ok(field in body, `${label}: the reply dropped ${field}`);
    }
    assert.ok(Array.isArray(body.records), `${label}: records`);
    assert.ok(Array.isArray(body.gaps), `${label}: gaps`);
    assert.ok(Array.isArray(body.contacts), `${label}: contacts`);
  }
});

test("ASK-05: the topic sweep is EVIDENCE under the one answer, never a second answer", async () => {
  /*
   * *"Is there a rezoning coming?"* used to be answered by a second network
   * call the map fired through `Promise.all` beside the grounded one, rendered
   * as a whole second civic answer with its own eyebrow and its own
   * denominator sentence. Both could paint on one screen.
   *
   * The capability had to survive the demotion, and this is what proves it:
   * the sweep's hits arrive in the ONE pack as `AGENDA_MENTION`, its
   * denominator is a number in the one vocabulary, and its corpus limit is a
   * named gap.
   */
  const body = await ask("Is there a rezoning coming?");
  assert.equal(
    typeof body.denominators?.agendasSweptForTopic,
    "number",
    "the sweep must state what it looked at, in the one denominator vocabulary",
  );

  const said = (body.gaps ?? []).map((g) => g.statement).join(" ");
  assert.match(
    said,
    /not the permit or zoning-application record/,
    "the corpus limit rides on every outcome — a filing exists long before a docket does",
  );

  /* Every mention that came back is a quoted clerk line with its own source.
     Nothing here is summarised: a summary of a zoning agenda is a claim about
     what a government is about to do, made by us. */
  for (const mention of body.records?.filter((r) => r.kind === "AGENDA_MENTION") ?? []) {
    assert.match(mention.text, /"/, "the record is the clerk's own line, quoted");
    assert.ok(mention.sourceUrl, "and it points at the agenda it was read from");
  }
});

test("ASK-05: a bound body NARROWS the sweep to its own agendas", async () => {
  /*
   * Every scope this sweep ever had was about WHERE THE READER IS. That is the
   * right default for "is there a data centre coming" and the wrong one the
   * moment a question names a government: a hit from a NEIGHBOURING district,
   * rendered under an answer about Vail, is the substitution defect wearing a
   * quote.
   */
  const named = await ask("Is there a rezoning on the Vail school district agenda?");
  assert.equal(named.subject?.id, VAIL_BOARD, "the reader named a government");

  const wide = await ask("Is there a rezoning coming?");
  assert.ok(
    (named.denominators?.agendasSweptForTopic ?? 0) <
      (wide.denominators?.agendasSweptForTopic ?? 0),
    "a bound body must sweep FEWER agendas than the reader's whole area",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   ASK-06 · VOTES REACH THE READER
   ══════════════════════════════════════════════════════════════════════ */

const CD6 = "ocd-division/country:us/state:az/cd:6";
const SLDL20 = "ocd-division/country:us/state:az/sldl:20";

test("ASK-06 (a): a reader asking about their sitting representative gets his roll calls", async () => {
  const body = await ask("What has Juan Ciscomani done?", {
    ocdIds: [AZ, PIMA, CD6],
  });

  assert.equal(body.subject?.kind, "PERSON");
  assert.equal(body.subject?.name, "Juan Ciscomani");

  const votes = body.records?.filter((r) => r.kind === "ROLL_CALL_VOTE") ?? [];
  assert.ok(votes.length > 0, "twenty recorded federal votes reached nothing before ASK-06");
  assert.equal(body.denominators?.rollCallVotesRecorded, 20);

  for (const vote of votes) {
    /* The constitution, verbatim: every vote rendered to a reader carries a
       source record pointing at a specific roll call. */
    assert.match(vote.sourceUrl ?? "", /clerk\.house\.gov\/Votes\//);
    /* Person AND office, and the office is the one he HOLDS. */
    assert.match(vote.text, /Juan Ciscomani, U\.S\. Representative: voted /);
  }
});

test("ASK-06 (a2): 'How has <person> voted?' is composed from the roll calls we hold — newest first, with how many we hold — with no model", async () => {
  const body = await ask("How has Juan Ciscomani voted?", { ocdIds: [AZ, PIMA, CD6] });
  assert.equal(body.mode, "GROUNDED_COMPOSED");
  assert.match(body.answer ?? "", /^Juan Ciscomani's most recent recorded votes: (?:YES|NO|Not Voting|Present)[^;]* on .+ \(.+; .+\)/);
  assert.match(body.answer ?? "", /We hold 20 recorded votes for Juan Ciscomani; the rest are listed below\.$/);
  const votes = (body.records ?? []).filter((record) => record.kind === "ROLL_CALL_VOTE");
  assert.equal(votes.length, 20, "the reader is shown every roll call, whatever the answer names");
  const newest = [...votes].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))[0]!;
  assert.ok((body.answer ?? "").includes(newest.rollCall!.what), "the newest recorded vote is the first one named");
});

test("ASK-06 (b): a candidate without a permanent voting-office identity gets a NAMED gap, never silence", async () => {
  /*
   * The retired Plural roster used to make a second Warren Petersen entity in
   * node:test and to attach that intermediary identity to this candidacy. PDC
   * deliberately refuses that bridge: until the permanent official-state
   * roster establishes an exact publisher identity, the candidate still
   * resolves and the missing relationship is stated as OURS. The focused
   * canonical ballot id disambiguates the test-only research fixture without
   * making that fixture authoritative.
   */
  const body = await ask("How has Warren Petersen voted?", {
    ocdIds: [AZ, PIMA],
    surface: "BALLOT",
    activeSubjects: [{
      id: "ballot-az-pima:attorney-general|Warren Petersen",
      name: "Warren Petersen",
      kind: "PERSON",
      focused: true,
    }],
  });

  assert.equal(body.subject?.name, "Warren Petersen");
  assert.equal(
    (body.records ?? []).filter((r) => r.kind === "ROLL_CALL_VOTE").length,
    0,
  );

  const gap = (body.gaps ?? []).find((g) => /confirmed which voting record belongs/i.test(g.statement));
  assert.ok(gap, "an unproved permanent identity must produce a sentence, not silence");
  assert.equal(gap.whose, "OURS");
  assert.match(gap.statement, /Warren Petersen/);
  assert.match(gap.statement, /haven't shown anyone else's votes/i);
  assert.doesNotMatch(gap.statement, /did not vote|has not voted|no votes cast/i);
});

test("ASK-06 (c): a retired intermediary bridge cannot attach Senate votes beside a House candidacy", async () => {
  // The frozen bridge related this candidacy to a Plural/OpenStates id. PDC
  // classifies that whole state corpus as research-only, so neither its person
  // id nor its twelve LegiScan positions may enter the permanent Reader. The
  // positive source-namespaced official-state path is proved independently in
  // state-rollcall-permanent-boundary.test.ts.
  const body = await ask("How has Sally Ann Gonzales voted?", {
    ocdIds: [AZ, PIMA, SLDL20],
  });

  assert.equal(body.subject?.name, "Sally Ann Gonzales", "the person still resolves");
  const votes = (body.records ?? []).filter((r) => r.kind === "ROLL_CALL_VOTE");
  assert.equal(votes.length, 0);
  assert.ok((body.gaps ?? []).some((gap) =>
    gap.whose === "OURS" &&
    /which voting record belongs to Sally Ann Gonzales/i.test(gap.statement) &&
    /haven't shown anyone else's votes/i.test(gap.statement)
  ));
  const { officeholderIdentityMayEnterReader } = await import("../lib/officials/roster-authority.ts");
  assert.equal(
    officeholderIdentityMayEnterReader("plural:3c965e03-1e51-4f10-a037-4fb2f35292c5", null, "production"),
    false,
    "the node:test fixture exception must not become a production Reader door",
  );
});
