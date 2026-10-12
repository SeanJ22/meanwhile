import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  askKeyHash,
  askRunHash,
  captureAskInteraction,
  prepareAskInteraction,
  type AskInteractionInput,
} from "../lib/db/ask-signal.ts";
import { writeAskInteraction } from "../lib/db/ask-interaction-writer.ts";
import {
  cohortLabel,
  countsAsResident,
  zipCohortOnly,
  LOCATION_CONFIDENCES,
  RESIDENCY_RELATIONS,
} from "../lib/ask/residency.ts";

/** The Ask interaction store, tested with its ripcord pulled. */

function input(over: Partial<AskInteractionInput> = {}): AskInteractionInput {
  return {
    question: "What's on the Vail school district agenda?",
    intent: "UPCOMING_AGENDA",
    temporalKind: "NEXT",
    subjectIds: ["ocd-division/country:us/state:az/school_district:vail_unified_district"],
    resolutionState: "BOUND",
    answerMode: "GROUNDED_CLAUDE",
    answerText: "The next Vail Unified District board meeting is on 8 September 2026.",
    answerModel: "claude-opus-5",
    validationPassed: true,
    evidenceRecordCount: 2,
    evidenceSourceCount: 1,
    namedGapCount: 1,
    evidenceProvenance: {
      recordRefs: ["MEETING:apptegy:vail:60703698", "AGENDA_DOCUMENT:https://example.gov/portal"],
      sourceUrls: ["https://example.gov/portal"],
      sourceOrgs: ["Vail School District Governing Board"],
      retrievedFrom: "2026-08-13T21:01:25.791Z",
      retrievedTo: "2026-08-13T21:01:25.791Z",
    },
    surface: "MAP",
    approximateLocation: "85641",
    ocdIds: ["ocd-division/country:us/state:az/county:pima"],
    divisionVintage: "2024",
    residencyRelation: "CURRENT_HOME",
    locationConfidence: "SELF_DECLARED_ZIP",
    coverageTier: "TIER_1",
    coverageTierDistribution: "T0:24,T1:3,T2:1,T3:0",
    continuityKey: "browser-minted-abc123",
    runClass: "ORGANIC",
    runId: null,
    occurredAt: "2026-08-27T12:00:00.000Z",
    ...over,
  };
}

test("ASK03: with a continuity key and a write path, one Ask writes one row", async () => {
  let wrote = 0;
  const outcome = await captureAskInteraction(input(), async () => {
    wrote += 1;
  });
  assert.equal(outcome.kind, "WROTE");
  assert.equal(wrote, 1);
});

test("the database writer preserves unanswered transport failures and refuses a disabled engine mode", async () => {
  await assert.rejects(writeAskInteraction(prepareAskInteraction(input({ answerMode: "OFF" }))),
    /OFF is not a delivered Ask interaction/);
  const row = prepareAskInteraction(input({ answerMode: "TRANSPORT_FAILED", answerText: null }));
  assert.equal(row.answerMode, "TRANSPORT_FAILED");
  assert.equal(row.answerText, null);
});

test("Ask questions and answers are stored character for character", () => {
  for (const question of ["Who represents 412 elm st phoenix?", "What happened at the 2026 Budget Hearing?", "q".repeat(900),
    "  Who represents me?\nI am Jane Doe, jane.doe@example.com, 555-123-4567, 42 Rillito Lane.  "]) {
    const answerText = "  The board meets on September 8th, 2026.\n" + "x".repeat(9000) + "  ";
    const row = prepareAskInteraction(input({ question, answerText }));
    assert.equal(row.question, question);
    assert.equal(row.answerText, answerText);
    assert.deepEqual(row.selfDisclosure, []);
  }
});

test("ASK03: the continuity key is stored ONLY as a digest, under its own prefix", () => {
  const row = prepareAskInteraction(input({ continuityKey: "browser-minted-abc123" }));
  assert.ok(!JSON.stringify(row).includes("browser-minted-abc123"), "the raw key must not be stored");
  assert.equal(row.askKeyHash, askKeyHash("browser-minted-abc123"));
  assert.match(row.askKeyHash, /^[0-9a-f]{64}$/);
});

test("ASK03: the digest CANNOT equality-join to another store's key for the same browser", () => {
  /* Stores hashing one browser key must not produce the same digest: no two stores may be equality-joinable. */
  const key = "the-same-browser-everywhere";
  const ask = askKeyHash(key);
  const reaction = createHash("sha256").update(key, "utf8").digest("hex");
  const speak = createHash("sha256").update(`speak-your-mind:${key}`).digest("hex");
  const limiter = createHash("sha256").update(`intake-limiter:${key}`).digest("hex");

  assert.notEqual(ask, reaction, "ask and reaction digests collide — the stores would join");
  assert.notEqual(ask, speak);
  assert.notEqual(ask, limiter);
  assert.equal(new Set([ask, reaction, speak, limiter]).size, 4);
});

test("ASK03: the run id is namespaced too", () => {
  const bare = createHash("sha256").update("run-42", "utf8").digest("hex");
  assert.notEqual(askRunHash("run-42"), bare);
  const row = prepareAskInteraction(input({ runId: "run-42" }));
  assert.equal(row.runId, askRunHash("run-42"));
  assert.ok(!JSON.stringify(row).includes("run-42"));
});

test("ASK03: the row carries no email, account, address or phone field at all", () => {
  const row = prepareAskInteraction(input());
  const keys = Object.keys(row).map((k) => k.toLowerCase());
  for (const forbidden of ["email", "account", "address", "phone", "userid", "ip"]) {
    assert.ok(
      !keys.some((k) => k.includes(forbidden)),
      `the row carries a ${forbidden}-shaped field`,
    );
  }
});

test("ASK03: a self-declared ZIP is a ZIP COHORT and is NOT district membership", () => {
  /* The initial zip is a self-declared home zip, not an address-validated residence, so the two sentences are never spoken as one. */
  assert.equal(zipCohortOnly("SELF_DECLARED_ZIP"), true);
  assert.equal(zipCohortOnly("UNVERIFIED"), true);
  assert.equal(zipCohortOnly("ADDRESS_RESOLVED"), false);
  assert.equal(zipCohortOnly("ADDRESS_VALIDATED"), false);

  assert.equal(
    cohortLabel("CURRENT_HOME", "SELF_DECLARED_ZIP", "85641"),
    "readers who identified 85641 as their home ZIP",
  );
  assert.equal(
    cohortLabel("CURRENT_HOME", "ADDRESS_RESOLVED", "Vail Unified District"),
    "readers whose address resolved to Vail Unified District",
  );
});

test("ASK03: a prospective mover is NEVER counted as a current resident", () => {
  assert.equal(countsAsResident("PROSPECTIVE_HOME"), false);
  assert.equal(countsAsResident("BROWSING"), false);
  assert.equal(countsAsResident("UNKNOWN"), false);
  assert.equal(countsAsResident("CURRENT_HOME"), true);

  // And their own cohort is named rather than discarded — the moving-here
  // reader is separately valuable, not noise.
  assert.equal(
    cohortLabel("PROSPECTIVE_HOME", "SELF_DECLARED_ZIP", "85641"),
    "readers researching a move to 85641",
  );
});

test("ASK03: browsing elsewhere does not overwrite the home cohort", () => {
  const browsing = prepareAskInteraction(
    input({ residencyRelation: "BROWSING", approximateLocation: "03301" }),
  );
  assert.equal(browsing.residencyRelation, "BROWSING");
  assert.notEqual(browsing.residencyRelation, "CURRENT_HOME");
  assert.match(cohortLabel("BROWSING", "SELF_DECLARED_ZIP", "03301"), /from elsewhere/);
});

test("ASK03: every declared relation and confidence has an honest label", () => {
  for (const relation of RESIDENCY_RELATIONS) {
    for (const confidence of LOCATION_CONFIDENCES) {
      const label = cohortLabel(relation, confidence, "85641");
      assert.ok(label.length > 0);
      /* The one sentence that must never be produced from weak evidence. */
      if (zipCohortOnly(confidence)) {
        assert.ok(
          !/address resolved/i.test(label),
          `${relation}/${confidence} claimed an address it does not have`,
        );
      }
      if (relation !== "CURRENT_HOME") {
        assert.ok(
          !/home ZIP/i.test(label),
          `${relation}/${confidence} claimed a home it was not told about`,
        );
      }
    }
  }
});

test("ASK03: the answer mode is stored as given and is never inferred", () => {
  /*
   * Saying GROUNDED_CLAUDE when only the deterministic path ran would make
   * every later measurement of this feature a fiction. The row records what
   * happened, including the unflattering outcomes.
   */
  for (const mode of [
    "GROUNDED_CLAUDE",
    "STRUCTURED_GROUNDED",
    "CLARIFY",
    "UNRESOLVED",
    "NO_EVIDENCE",
    "REJECTED_FELL_BACK",
  ] as const) {
    assert.equal(prepareAskInteraction(input({ answerMode: mode })).answerMode, mode);
  }
});

test("ASK03: a rejected answer records the rejection, not a success", () => {
  const row = prepareAskInteraction(
    input({ answerMode: "REJECTED_FELL_BACK", validationPassed: false, answerText: null }),
  );
  assert.equal(row.answerMode, "REJECTED_FELL_BACK");
  assert.equal(row.validationPassed, false);
  assert.equal(row.answerText, null);
});

test("ASK03: an unanswered question keeps its demand signal", () => {
  // The roadmap needs exactly the questions this product could NOT answer.
  const row = prepareAskInteraction(
    input({
      question: "What did the Empire Fire District decide about the new station?",
      answerMode: "NO_EVIDENCE",
      answerText: null,
      answerModel: null,
      validationPassed: null,
      evidenceRecordCount: 0,
      evidenceSourceCount: 0,
    }),
  );
  assert.match(row.question, /Empire Fire District/);
  assert.equal(row.answerMode, "NO_EVIDENCE");
  assert.equal(row.evidenceRecordCount, 0);
});

test("ASK03: synthetic and author traffic are marked so they leave organic aggregates", () => {
  assert.equal(prepareAskInteraction(input({ runClass: "SYNTHETIC" })).runClass, "SYNTHETIC");
  assert.equal(prepareAskInteraction(input({ runClass: "AUTHOR" })).runClass, "AUTHOR");
  /* An unmarked row is UNKNOWN rather than ORGANIC: for a store that is not
     yet live, assuming a human at a browser would be the wrong default. */
  const bare = { ...input() };
  delete (bare as Partial<AskInteractionInput>).runClass;
  assert.equal(prepareAskInteraction(bare as AskInteractionInput).runClass, "UNKNOWN");
});

test("ASK03: the surface is recorded, so MAP and BALLOT questions stay distinguishable", () => {
  assert.equal(prepareAskInteraction(input({ surface: "BALLOT" })).surface, "BALLOT");
  assert.equal(prepareAskInteraction(input({ surface: "MAP" })).surface, "MAP");
});
