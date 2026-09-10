/** The permanent software-only `main` protection state, as executable proof. */

import assert from "node:assert/strict";
import test from "node:test";

import { judgeProtection } from "../lib/ops/protection-state.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

const CONTEXTS = REQUIRED_CONTEXTS;

function ruleset(overrides: Record<string, unknown> = {}) {
  return {
    id: 21_572_280,
    name: "main",
    enforcement: "active",
    target: "branch",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: CONTEXTS.map((context) => ({ context })),
        },
      },
    ],
    ...overrides,
  };
}

const classic = {
  required_status_checks: { strict: true, contexts: [...CONTEXTS] },
  required_pull_request_reviews: { required_approving_review_count: 0 },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
};

const complete = (classicReading: unknown, rulesets: unknown[], deployKeys: unknown = []) => ({
  classic: classicReading,
  rulesets,
  deployKeys,
  complete: true,
  unreachable: [],
}) as never;

test("PDC: an unreadable API is cannot-tell, never intact", () => {
  const report = judgeProtection({
    classic: null,
    rulesets: [],
    deployKeys: null,
    complete: false,
    unreachable: ["rulesets: HTTP 401"],
  }, CONTEXTS);
  assert.equal(report.verdict, "cannot-tell");
  assert.match(report.summary, /not a pass/i);
});

test("PDC: no protection is drift", () => {
  const report = judgeProtection(complete(null, []), CONTEXTS);
  assert.equal(report.verdict, "drifted");
  assert.match(report.summary, /not protected/);
});

test("PDC: terminal main ruleset has strict exact software gates and no direct-write route", () => {
  const report = judgeProtection(complete(null, [ruleset()], [
    { id: 8, title: "read-only mirror", read_only: true },
  ]), CONTEXTS);
  assert.equal(report.verdict, "intact", report.summary);
  assert.equal(report.shape, "ruleset");
  assert.equal(report.assertions.filter((assertion) => assertion.ok !== true).length, 0);
  assert.match(
    report.assertions.find((assertion) => /zero write-enabled/.test(assertion.name))!.detail,
    /0 of 1/,
  );
});

test("PDC regression: the former DeployKey bypass plus scheduled-pusher key is drift", () => {
  const former = ruleset({
    bypass_actors: [{ actor_id: null, actor_type: "DeployKey", bypass_mode: "exempt" }],
  });
  const report = judgeProtection(complete(null, [former], [{
    id: 161_394_591,
    title: "wtp-scheduled-pushers",
    read_only: false,
  }]), CONTEXTS);
  assert.equal(report.verdict, "drifted");
  assert.equal(
    report.assertions.find((assertion) => /can bypass/.test(assertion.name))!.ok,
    false,
  );
  const keys = report.assertions.find((assertion) => /zero write-enabled/.test(assertion.name))!;
  assert.equal(keys.ok, false);
  assert.match(keys.detail, /wtp-scheduled-pushers/);
});

test("PDC: every bypass actor type is drift, including an Actions app or a human role", () => {
  for (const actor of [
    { actor_type: "Integration", actor_id: 15368, bypass_mode: "always" },
    { actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" },
    { actor_type: "OrganizationAdmin", actor_id: 1, bypass_mode: "pull_request" },
  ]) {
    const report = judgeProtection(complete(null, [ruleset({ bypass_actors: [actor] })]), CONTEXTS);
    assert.equal(report.verdict, "drifted", actor.actor_type);
    assert.equal(
      report.assertions.find((assertion) => /can bypass/.test(assertion.name))!.ok,
      false,
    );
  }
});

test("PDC: a write-enabled deploy key is drift even when no ruleset bypass is present", () => {
  const report = judgeProtection(complete(null, [ruleset()], [
    { id: 9, title: "unexpected-writer", read_only: false },
  ]), CONTEXTS);
  assert.equal(report.verdict, "drifted");
  const keys = report.assertions.find((assertion) => /zero write-enabled/.test(assertion.name))!;
  assert.equal(keys.ok, false);
  assert.match(keys.detail, /unexpected-writer/);
});

test("PDC: an unread deploy-key inventory is cannot-tell", () => {
  const report = judgeProtection(complete(null, [ruleset()], null), CONTEXTS);
  assert.equal(report.verdict, "cannot-tell");
  assert.equal(
    report.assertions.find((assertion) => /zero write-enabled/.test(assertion.name))!.ok,
    null,
  );
});

test("PDC: an indeterminate deploy-key privilege or omitted bypass inventory is not intact", () => {
  const unknownKey = judgeProtection(complete(null, [ruleset()], [
    { id: 7, title: "missing-privilege-bit" },
  ]), CONTEXTS);
  assert.equal(unknownKey.verdict, "cannot-tell");

  const omittedBypass = ruleset();
  delete (omittedBypass as { bypass_actors?: unknown }).bypass_actors;
  const report = judgeProtection(complete(null, [omittedBypass]), CONTEXTS);
  assert.equal(report.verdict, "drifted");
  assert.match(
    report.assertions.find((assertion) => /can bypass/.test(assertion.name))!.detail,
    /omitted bypass_actors/,
  );
});

test("PDC: a missing, renamed, duplicated, or unexpected required context is drift", () => {
  const variants = [
    CONTEXTS.slice(0, -1),
    CONTEXTS.map((context) => context.replace(" · ", ", ")),
    [...CONTEXTS, CONTEXTS[0]],
    [...CONTEXTS, "unreviewed-extra-check"],
  ];
  for (const contexts of variants) {
    const malformed = ruleset({
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        { type: "pull_request", parameters: { required_approving_review_count: 0 } },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: contexts.map((context) => ({ context })),
          },
        },
      ],
    });
    const report = judgeProtection(complete(null, [malformed]), CONTEXTS);
    assert.equal(report.verdict, "drifted", contexts.join(" | "));
    assert.equal(
      report.assertions.find((assertion) => /required contexts/.test(assertion.name))!.ok,
      false,
    );
  }
});

test("PDC: lax status checks, missing PR, deletion, or force-push bars are drift", () => {
  const cases = [
    ruleset({ rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request" },
      { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: CONTEXTS.map((context) => ({ context })),
      } },
    ] }),
    ruleset({ rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: CONTEXTS.map((context) => ({ context })),
      } },
    ] }),
    ruleset({ rules: [
      { type: "non_fast_forward" },
      { type: "pull_request" },
      { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: CONTEXTS.map((context) => ({ context })),
      } },
    ] }),
    ruleset({ rules: [
      { type: "deletion" },
      { type: "pull_request" },
      { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: CONTEXTS.map((context) => ({ context })),
      } },
    ] }),
  ];
  for (const reading of cases) {
    assert.equal(judgeProtection(complete(null, [reading]), CONTEXTS).verdict, "drifted");
  }
});

test("PDC: evaluate mode, classic-only, classic plus ruleset, or multiple rulesets is drift", () => {
  const readings = [
    complete(null, [ruleset({ enforcement: "evaluate" })]),
    complete(classic, []),
    complete(classic, [ruleset()]),
    complete(null, [ruleset(), ruleset({ id: 22, name: "also-main" })]),
    complete(null, [ruleset({ target: undefined })]),
    complete(null, [ruleset({ conditions: { ref_name: {
      include: ["~DEFAULT_BRANCH"],
      exclude: ["refs/heads/main"],
    } } })]),
  ];
  for (const reading of readings) {
    assert.equal(judgeProtection(reading, CONTEXTS).verdict, "drifted");
  }
});

test("PDC target: exact live ruleset payload after bypass and write-key retirement is intact", () => {
  const target = {
    id: 21_572_280,
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: CONTEXTS.map((context) => ({ context, integration_id: 15368 })),
        },
      },
    ],
    bypass_actors: [],
  };
  const report = judgeProtection(complete(null, [target], []), CONTEXTS);
  assert.equal(report.verdict, "intact", report.summary);
  assert.equal(report.assertions.length, 8);
});
