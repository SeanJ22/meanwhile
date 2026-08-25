/**
 * **`NJ25` — a deploy that errored, and nothing in the close-out noticed.**
 *
 * The old check compared the newest READY deploy's commit against the last
 * deploy-eligible one, so a shipped commit whose deploy failed produced *BEHIND
 * by 1* — which is exactly what a deploy still building produces. The one state
 * that demands action read like the one state that demands patience.
 *
 * There was no failed deploy in the last forty records to prove the FAILED
 * verdict against on the day this was written, so it is PLANTED. That is the
 * whole reason the decision is a pure function rather than four lines inside a
 * script that only a live API call can reach.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEPLOY_EXIT,
  verdictForDeploys,
  type DeployRecord,
} from "../lib/ops/deploy-verdict.ts";

const SHA = "abc1234def5678901234567890123456789012ab";

const ready = (over: Partial<DeployRecord> = {}): DeployRecord => ({
  id: "d-ready",
  state: "ready",
  context: "production",
  commit_ref: SHA,
  ...over,
});

describe("NJ25 — the close-out verifies the deploy for the shipped SHA succeeded", () => {
  it("SUCCESS when a deploy carrying this commit is ready", () => {
    const v = verdictForDeploys([ready()], SHA);
    assert.equal(v.kind, "SUCCESS");
    assert.equal(DEPLOY_EXIT[v.kind], 0);
  });

  it("FAILED — the planted case, because no real one existed to point at", () => {
    const v = verdictForDeploys(
      [
        {
          id: "d-broken",
          state: "error",
          context: "production",
          commit_ref: SHA,
          error_message: "Failed during stage 'building site': Command failed with exit code 1: next build",
        },
      ],
      SHA,
    );
    assert.equal(v.kind, "FAILED");
    assert.equal(DEPLOY_EXIT[v.kind], 1, "a failed deploy must exit non-zero or the close-out passes over it");
    assert.match(v.why, /building site/, "the failure must carry Netlify's own message, not a generic one");
  });

  it("a FILTER CANCEL is not a failure — RULING 115, and it is the live case", () => {
    /*
     * Netlify's actual record for `2f86b57`, a `context.md` rewrite, read on
     * 2026-08-25. RULING 124's deploy filter stopped it, and Netlify writes a
     * cancel as `state: "error"` — so every quiet paperwork commit would have
     * raised this alarm. An alarm that cannot tell an exercise from an event
     * eventually cries wolf, and the cost is the real one nobody reads.
     */
    const v = verdictForDeploys(
      [
        {
          id: "d-cancelled",
          state: "error",
          context: "production",
          commit_ref: SHA,
          error_message:
            "Failed during stage 'checking build content for changes': Canceled build due to no content change",
        },
      ],
      SHA,
    );
    assert.equal(v.kind, "CANCELLED-BY-FILTER");
    assert.equal(DEPLOY_EXIT[v.kind], 0, "a correctly-filtered paperwork commit must not fail a close-out");
  });

  it("a RETRY that succeeded reads SUCCESS — the question is what production serves", () => {
    const v = verdictForDeploys(
      [
        ready({ id: "d-retry" }),
        { id: "d-first-try", state: "error", context: "production", commit_ref: SHA, error_message: "boom" },
      ],
      SHA,
    );
    assert.equal(v.kind, "SUCCESS");
  });

  it("PENDING while it builds, and PENDING when it has not appeared — never SUCCESS", () => {
    assert.equal(
      verdictForDeploys([{ id: "d", state: "building", context: "production", commit_ref: SHA }], SHA).kind,
      "PENDING",
    );
    assert.equal(verdictForDeploys([], SHA).kind, "PENDING");
    assert.equal(DEPLOY_EXIT.PENDING, 2);
  });

  it("a SHORT sha matches the full ref, because that is what a caller has", () => {
    /*
     * Netlify records 40 characters; a session names whatever `git log
     * --format=%h` printed. Equality would answer PENDING forever for a deploy
     * that shipped — this failure, arriving from the other side.
     */
    assert.equal(verdictForDeploys([ready()], SHA.slice(0, 7)).kind, "SUCCESS");
  });

  it("another commit's deploy is not this commit's, and a PREVIEW is not production", () => {
    assert.equal(verdictForDeploys([ready({ commit_ref: "9999999999" })], SHA).kind, "PENDING");
    assert.equal(verdictForDeploys([ready({ context: "deploy-preview" })], SHA).kind, "PENDING");
  });

  it("CANNOT-TELL exits non-zero — an unanswerable question is never a pass", () => {
    assert.equal(DEPLOY_EXIT["CANNOT-TELL"], 3);
  });
});
