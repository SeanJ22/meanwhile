import assert from "node:assert/strict";
import test from "node:test";

import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { OFFICIAL_STATE_ROLL_CALL_TARGETS } from "../lib/state-rollcalls/authority.ts";
import {
  READER_VOTE_RENDERABLE_STATE_SCOPES,
  officialStateVotesRenderToReader,
} from "../lib/state-rollcalls/reader-vote-visibility.ts";

/**
 * The client-safe render gate must equal the set of official state scopes whose
 * votes actually reach a reader through `/api/votes` → promoted STATE_ROLL_CALL:
 * a plain STATE_ROLL_CALL contract, no live-acceptance gap, no fan-out. Re-derive
 * it from the contracts so the hardcoded client list cannot drift — a state that
 * becomes renderable fails this test until it is listed (so the popup asks for
 * its votes), and a blocked/fan-out state must never be listed (so its argued
 * absence is not silently rendered as "no votes").
 */
test("reader render gate equals the plain STATE_ROLL_CALL contracts", () => {
  const derived = OFFICIAL_STATE_ROLL_CALL_TARGETS
    .filter((target) => {
      const contract = ROUTINE_SOURCE_CONTRACTS.find((entry) => entry.id === target.contractId);
      assert.ok(contract, `no registered contract for ${target.contractId}`);
      return (
        contract.recordClass === "STATE_ROLL_CALL" &&
        contract.liveAcceptance === undefined &&
        contract.fanOut !== true
      );
    })
    .map((target) => target.jurisdiction)
    .sort();

  assert.deepEqual(
    [...READER_VOTE_RENDERABLE_STATE_SCOPES].sort(),
    derived,
    "READER_VOTE_RENDERABLE_STATE_SCOPES drifted from the contracts: list every scope whose " +
      "STATE_ROLL_CALL votes render (so the popup asks for them), and no fan-out or WAF-blocked scope.",
  );
});

test("AZ (WAF-blocked, argued named gap) and NH (mid-flight fan-out) are excluded", () => {
  // These are deliberately NOT renderable-through-STATE_ROLL_CALL yet. Excluding
  // them keeps their absence a filed follow-up, never a silent "no votes".
  assert.equal(officialStateVotesRenderToReader("az-legislature:1234"), false);
  assert.equal(officialStateVotesRenderToReader("nh-general-court:5"), false);
});

test("NJ official ids render; federal and other ids do not", () => {
  assert.equal(officialStateVotesRenderToReader("nj-legislature:42"), true);
  assert.equal(officialStateVotesRenderToReader("congress:C001133"), false);
  assert.equal(officialStateVotesRenderToReader("plural:947e2e2b-0000-0000-0000-000000000000"), false);
  assert.equal(officialStateVotesRenderToReader("nj-legislature:"), false);
});
