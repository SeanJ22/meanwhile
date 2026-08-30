import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * **THE PIMA RED CONTROL — a division is not a body, through the handler the
 * reader's box actually posts to.** (2026-08-29.)
 *
 * ## The production defect
 *
 * A reader asked *"What's on the Pima County Board of Supervisors agenda?"* and
 * was told the Board's next meeting was:
 *
 * > CAP University: Deeper Dive on How Water is Accounted for in the Lower Basin
 *
 * That is an event of the **Central Arizona Water Conservation District**, a
 * different government. The answer then said there was no other upcoming Board
 * meeting in the records. There were fourteen.
 *
 * The trace read `GROUNDED_CLAUDE`, and that is the important part: the model
 * had stayed inside its evidence pack and paraphrased it faithfully. **The
 * application retrieved the wrong civic record**, so every rung downstream was
 * working correctly on a false input. A validator that reads prose cannot catch
 * this, because every name in the sentence was the right name.
 *
 * The mechanism was one line — `meetings.filter((m) => m.ocdId === subject.id)`
 * — reachable because `lib/ask/inventory.ts` built the Ask body inventory from
 * `meeting.ocdId` and stamped it `nameClass: "body"`. The Pima County division
 * carries 42 meetings: 30 the Board's, 12 the water district's.
 *
 * ## Why these assertions and not "the answer must not say CAP University"
 *
 * Because that test would pass by accident on 1 September. `selectSitting`
 * reads the real clock, so which wrong meeting gets picked changes with the
 * date, and a test pinned to one title would go green while the defect stayed.
 *
 * Every assertion below is TIME-INDEPENDENT and states the actual rule:
 *
 * 1. the resolved subject is a **body id**, not a division id;
 * 2. the denominator is the **body's** meeting count, not the division's;
 * 3. **no record returned belongs to a sibling body** on the same division.
 *
 * (3) is the general form of "not CAP University" and it holds on every date.
 *
 * ## Reading the corpus is not re-implementing the rule
 *
 * The counts below are read out of the committed snapshot rather than typed as
 * literals, so a regenerated corpus does not turn a real regression into a
 * green test or a real fix into a red one. That is reading DATA. The RULE —
 * select on `bodyId`, never on `ocdId` — is never restated here; it is only
 * ever exercised through the real `POST` handler. The repository has been
 * caught once already by a test that re-implemented the rule it was guarding
 * (`lib/ask/select.ts` says so in its own doc block), and this is the shape
 * that avoids it.
 */

/* No model runs: both synthesis rungs return UNAVAILABLE and the deterministic
   half is what gets asserted. The product's honesty must not depend on a model
   being reachable — and the identity of the retrieved record is decided long
   before synthesis either way. */
delete process.env.ANTHROPIC_API_KEY;

const { POST, resetGroundedState } = await import("@/app/api/ask/grounded/route");

const AZ = "ocd-division/country:us/state:az";
const PIMA_DIVISION = "ocd-division/country:us/state:az/county:pima";
const SLDU = "ocd-division/country:us/state:az/sldu:19";
const SLDL = "ocd-division/country:us/state:az/sldl:19";

/** The county's own governing body. */
const BOARD_OF_SUPERVISORS = `${PIMA_DIVISION}#governing`;
/** A DIFFERENT government, recorded against the same division. */
const WATER_DISTRICT = `${PIMA_DIVISION}#central-arizona-water-conservation-district`;

interface SnapshotMeeting {
  id: string;
  bodyId: string | null;
  ocdId: string | null;
  title: string;
  startsAt: string;
}

const snapshot = JSON.parse(
  readFileSync("data/meetings-snapshot.json", "utf8"),
) as { meetings: SnapshotMeeting[] };

const meetingsOf = (bodyId: string) => snapshot.meetings.filter((m) => m.bodyId === bodyId);
const onDivision = snapshot.meetings.filter((m) => m.ocdId === PIMA_DIVISION);
const boardMeetings = meetingsOf(BOARD_OF_SUPERVISORS);
const waterMeetings = meetingsOf(WATER_DISTRICT);
const waterMeetingIds = new Set(waterMeetings.map((m) => m.id));

interface GroundedBody {
  mode: string;
  subject?: { kind: string; id: string; name: string } | null;
  answer?: string | null;
  records?: { kind: string; id: string; text: string; bodyId?: string | null }[];
  gaps?: { whose: string; statement: string }[];
  denominators?: Record<string, number>;
  trace?: { resolution: { state: string; subjectId?: string | null } };
}

async function ask(question: string, over: Record<string, unknown> = {}): Promise<GroundedBody> {
  resetGroundedState();
  const request = new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      /* Declared synthetic, as every automated request to this product must be
         — an undeclared one would count as reader signal in a sold store. */
      "x-wtp-synthetic-run": "exact-body-identity-2026-08-29",
    },
    body: JSON.stringify({
      question,
      ocdIds: [AZ, PIMA_DIVISION, SLDU, SLDL],
      ...over,
    }),
  });
  const response = await POST(request);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as GroundedBody;
}

/* ══════════════════════════════════════════════════════════════════════
   THE FIXTURE ITSELF — this test is worthless if the corpus stops
   exercising the case, and that must FAIL LOUDLY rather than pass quietly.
   ══════════════════════════════════════════════════════════════════════ */

test("the committed corpus still puts two different governments on one division", () => {
  assert.ok(
    boardMeetings.length > 0,
    "the corpus holds no Board of Supervisors meetings — this test can no longer prove anything",
  );
  assert.ok(
    waterMeetings.length > 0,
    "the corpus holds no Central Arizona Water Conservation District meetings, so the " +
      "sibling-body case is no longer exercised and this whole file is a green no-op",
  );
  /* The exact shape of the defect: filtering by division would over-collect. */
  assert.ok(
    onDivision.length > boardMeetings.length,
    `the Pima division (${onDivision.length}) no longer carries more meetings than the ` +
      `Board itself (${boardMeetings.length}), so a division filter would no longer be wrong here`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
   RED — the question that shipped the wrong government
   ══════════════════════════════════════════════════════════════════════ */

test("the Board of Supervisors resolves to a BODY id, never to its division", async () => {
  const body = await ask("What's on the Pima County Board of Supervisors agenda?");

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    BOARD_OF_SUPERVISORS,
    `resolved to ${body.subject?.id} — the Ask inventory is keyed on the division again`,
  );
  /* Stated separately and deliberately: the old code resolved to exactly this
     string, so naming it is what makes the regression unmistakable. */
  assert.notEqual(
    body.subject?.id,
    PIMA_DIVISION,
    "the subject is the county DIVISION — 42 meetings, two governments, one of them wrong",
  );
});

test("no sibling body's meeting can reach an answer about the Board", async () => {
  const body = await ask("What's on the Pima County Board of Supervisors agenda?");
  const records = body.records ?? [];

  for (const record of records) {
    assert.ok(
      !waterMeetingIds.has(record.id),
      `a Central Arizona Water Conservation District meeting (${record.id}) was returned as ` +
        `evidence about the Board of Supervisors: "${record.text.slice(0, 120)}"`,
    );
    if (record.bodyId) {
      assert.equal(
        record.bodyId,
        BOARD_OF_SUPERVISORS,
        `record ${record.id} belongs to ${record.bodyId}, not to the resolved body`,
      );
    }
  }
});

test("the denominator counts the BODY's meetings, not the division's", async () => {
  const body = await ask("When does the Pima County Board of Supervisors meet next?");

  assert.equal(
    body.denominators?.meetingsHeldForThisBody,
    boardMeetings.length,
    "the meetings denominator is not the Board's own count",
  );
  assert.notEqual(
    body.denominators?.meetingsHeldForThisBody,
    onDivision.length,
    `the denominator is the DIVISION's count (${onDivision.length}) — every meeting on the ` +
      "geography is being treated as the Board's",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   POSITIVE CONTROLS — a fix that silences everything is not a fix
   ══════════════════════════════════════════════════════════════════════ */

test("the sibling body is still reachable under its OWN name", async () => {
  const body = await ask("What's on the Central Arizona Water Conservation District agenda?");

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    WATER_DISTRICT,
    "the water district can no longer be asked about by name — the repair over-corrected",
  );
  for (const record of body.records ?? []) {
    if (record.bodyId) assert.equal(record.bodyId, WATER_DISTRICT);
  }
});

test("the Board still retrieves its own meetings — the repair did not empty the answer", async () => {
  const body = await ask("When does the Pima County Board of Supervisors meet next?");

  assert.ok(
    (body.denominators?.meetingsHeldForThisBody ?? 0) > 0,
    "the Board now retrieves nothing at all, which is a different wrong answer",
  );
  const meetingRecords = (body.records ?? []).filter((r) => r.kind === "MEETING");
  for (const record of meetingRecords) {
    const held = snapshot.meetings.find((m) => m.id === record.id);
    assert.ok(held, `record ${record.id} is not a meeting in the corpus`);
    assert.equal(held?.bodyId, BOARD_OF_SUPERVISORS);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   A BODY WHOSE OWN NAME IDENTIFIES NOTHING IS STILL REACHABLE
   ══════════════════════════════════════════════════════════════════════ */

test("a body named only 'Planning Board' is reachable by the town a reader would say", async () => {
  /*
   * Nineteen of the corpus's seventy-eight bodies carry a name that identifies
   * nothing on its own — seven of them called exactly "Planning Board". The
   * binder declines such a name on purpose, so before qualification the reader
   * who typed "the Warner Planning Board" got AMBIGUOUS. Honest, and useless,
   * about precisely the hyperlocal sitting this product exists to surface.
   */
  const body = await ask("What's on the Warner Planning Board agenda?", {
    ocdIds: [
      "ocd-division/country:us/state:nh/county:merrimack/place:warner_town",
      "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town",
      "ocd-division/country:us/state:nh",
    ],
  });

  assert.equal(body.trace?.resolution.state, "BOUND", JSON.stringify(body.trace));
  assert.equal(
    body.subject?.id,
    "ocd-division/country:us/state:nh/county:merrimack/place:warner_town#planning-board",
    "the reader named a town and a board; both are sourced and together they identify one body",
  );
});

test("qualifying by division never overwrites a body that has its own name", async () => {
  /*
   * The control that stops the qualification rule becoming a second
   * substitution defect. The Central Arizona Water Conservation District is
   * recorded against the Pima County division and is NOT Pima's — it is a
   * multi-county district. Prefixing it would demand the word "Pima" from a
   * reader who would never say it and make the body unreachable, trading one
   * silent failure for another.
   */
  const body = await ask("What's on the Central Arizona Water Conservation District agenda?");
  assert.equal(body.subject?.id, WATER_DISTRICT, JSON.stringify(body.trace));
  assert.ok(
    !/^pima\b/i.test(body.subject?.name ?? ""),
    `a body with its own name was qualified anyway: "${body.subject?.name}"`,
  );
});

/* ══════════════════════════════════════════════════════════════════════
   AN AGENDA IS NOT AN OUTCOME
   ══════════════════════════════════════════════════════════════════════ */

const OUTCOME_QUESTIONS = [
  "Did the Pima County Board of Supervisors vote on the budget?",
  "How did the Pima County Board of Supervisors vote last time?",
  "What did the Pima County Board of Supervisors decide at its last meeting?",
];

for (const question of OUTCOME_QUESTIONS) {
  test(`an outcome question carries the gap: ${question}`, async () => {
    /*
     * Before this, all three of these returned AGENDA_ITEM records and ZERO
     * gaps — an agenda handed to a synthesis model as evidence about a vote,
     * with nothing in the pack saying no outcome record was held. The likeliest
     * sentence out of that pack is a confident, sourced account of a decision
     * this product has no record of, fabricated from a real document.
     */
    const body = await ask(question);
    const gaps = body.gaps ?? [];
    assert.ok(
      gaps.some((g) => /have not recorded/i.test(g.statement)),
      `no gap named the missing outcome record. gaps: ${JSON.stringify(gaps)}`,
    );
    /* And the gap is OURS. We know WE hold no minutes; we have not established
       that the county publishes none, and saying so would be a claim about a
       government built out of our own collection state. */
    const outcomeGap = gaps.find((g) => /have not recorded/i.test(g.statement));
    assert.equal(outcomeGap?.whose, "OURS");
  });
}

test("a question the agenda CAN answer is not given an outcome gap", async () => {
  /*
   * The positive control, and the reason the detector is deliberately narrow.
   * "What was the last meeting about?" is answerable from the agenda as WHAT
   * WAS ON THE AGENDA. Attaching a "we hold no outcome record" gap to it would
   * be noise on a correct answer, and a detector that fires on everything is
   * how a useful signal becomes ignorable.
   */
  for (const question of [
    "What was the Pima County Board of Supervisors last meeting about?",
    "What's on the Pima County Board of Supervisors agenda?",
    "When does the Pima County Board of Supervisors meet next?",
  ]) {
    const body = await ask(question);
    const gaps = body.gaps ?? [];
    assert.ok(
      !gaps.some((g) => /have not recorded (?:a roll call|minutes)/i.test(g.statement)),
      `"${question}" was given an outcome gap it never asked for: ${JSON.stringify(gaps)}`,
    );
  }
});

test("a named government we do not hold is still UNRESOLVED, never swapped", async () => {
  /* The Sunnyside class, checked here too: the repair changed the inventory
     these verdicts are computed against, so the verdict has to be re-proven. */
  const body = await ask("What's on the Fictional Nonexistent County Board agenda?");
  assert.notEqual(body.trace?.resolution.state, "BOUND");
});
