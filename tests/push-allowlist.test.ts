/**
 * THE SCHEDULED-PUSH ALLOWLIST.
 * (2026-08-26, the unblock-pushers session. RULING 162.)
 *
 * Branch protection on `main` refuses a direct push from everyone, the Actions
 * bot included, so all eight scheduled pushers have gone red at the push since
 * 2026-08-25. Sean ruled for a scoped bypass for the bot — and **the bypass is
 * only safe because of the allowlist this file guards.** A bypass that could
 * carry code is the 8/25 hole reopened.
 *
 * Two halves, and the second is the one that has to survive a future session:
 *
 *   1. the classifier fails CLOSED in all four directions, and
 *   2. a pusher added later without the guard fails THIS TEST, not review.
 *
 * The second half is anchored on the WORKFLOW FILES (RULING 147). It reads what
 * the `.yml` actually does — whether it invokes the pusher, under which id, and
 * what its own `git add` lines stage — rather than re-reading the profile list
 * that would agree with a missing guard on every run, forever.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  NEVER_PUSHABLE,
  PUSHER_PROFILES,
  auditWorkflowPushers,
  classifyPushPaths,
  gitAddPathsIn,
  isAllowedFor,
  isNeverPushable,
  profileFor,
} from "../lib/ops/push-allowlist.ts";

const WORKFLOW_DIR = join(process.cwd(), ".github", "workflows");

function workflowSources() {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => ({
      file: `.github/workflows/${f}`,
      text: readFileSync(join(WORKFLOW_DIR, f), "utf8"),
    }));
}

/* ---- 1. the classifier fails closed --------------------------------------- */

test("RULING 162: no --workflow id refuses, and does not read as an empty diff", () => {
  const d = classifyPushPaths({ profileId: undefined, changed: ["data/meetings-snapshot.json"] });
  assert.equal(d.verdict, "cannot-tell");
  assert.match(d.reason, /no --workflow id/);
});

test("RULING 162: an unknown workflow id refuses rather than inheriting a grant", () => {
  const d = classifyPushPaths({ profileId: "refresh-something-new", changed: ["data/x.json"] });
  assert.equal(d.verdict, "cannot-tell");
  assert.match(d.reason, /not a known scheduled pusher/);
});

test("RULING 162: an UNREADABLE diff refuses — it is not an empty diff", () => {
  const d = classifyPushPaths({ profileId: "refresh-daily", changed: null });
  assert.equal(d.verdict, "cannot-tell");
  assert.match(d.reason, /could not be read/);
  assert.doesNotMatch(d.reason, /changes NO paths/);
});

test("RULING 162: an EMPTY diff refuses — zero is a result that must be earned", () => {
  const d = classifyPushPaths({ profileId: "refresh-daily", changed: [] });
  assert.equal(d.verdict, "cannot-tell");
  assert.match(d.reason, /changes NO paths/);
});

test("RULING 162: a path outside the profile is refused and NAMED", () => {
  const d = classifyPushPaths({
    profileId: "refresh-fec-snapshot",
    changed: ["data/fec/fec-2026.json", "lib/ballot/candidate-cards.ts"],
  });
  assert.equal(d.verdict, "refused");
  assert.deepEqual([...d.offenders], ["lib/ballot/candidate-cards.ts"]);
  assert.match(d.reason, /lib\/ballot\/candidate-cards\.ts/);
});

test("RULING 162: the happy path is allowed, and states its count", () => {
  const d = classifyPushPaths({
    profileId: "refresh-daily",
    changed: ["data/meetings-snapshot.json", "docs/refresh-run.md"],
  });
  assert.equal(d.verdict, "allowed");
  assert.equal(d.offenders.length, 0);
  assert.match(d.reason, /2 changed path/);
});

test("RULING 162: one refresher may not write another's artifact", () => {
  const d = classifyPushPaths({
    profileId: "refresh-fec-snapshot",
    changed: ["data/ballot/07866.json"],
  });
  assert.equal(d.verdict, "refused", "a per-workflow list is the point; a shared one would allow this");
});

test("RULING 162: traversal and absolute paths are refused before any rule is consulted", () => {
  const daily = profileFor("refresh-daily")!;
  assert.equal(isAllowedFor(daily, "data/../.github/workflows/build-check.yml"), false);
  assert.equal(isAllowedFor(daily, "/etc/passwd"), false);
  assert.equal(isAllowedFor(daily, "C:/Windows/system32"), false);
});

test("RULING 162: NEVER_PUSHABLE overrides a profile that was widened by mistake", () => {
  // A profile is a list somebody can edit. This is the second, independent
  // check that keeps "a bypass that could carry code" impossible rather than
  // merely unintended.
  const widened = { id: "x", workflow: ".github/workflows/x.yml", allow: [{ path: "", why: "" }] } as const;
  const overreaching = { ...widened, allow: [{ path: "docs/", why: "widened by mistake" }] };
  assert.equal(isAllowedFor(overreaching, "docs/rulings.md"), false, "rulings.md is barred outright");
  assert.equal(isAllowedFor(overreaching, "docs/tracker-resolved.csv"), false, "resolved rows are the author's");

  for (const { prefix } of NEVER_PUSHABLE) {
    const probe = prefix.endsWith("/") ? `${prefix}anything.ts` : prefix;
    assert.equal(isNeverPushable(probe), true, `${probe} must be barred outright`);
  }
});

test("RULING 162: the tracker grant is to job-watch ALONE", () => {
  const jobWatch = profileFor("job-watch")!;
  assert.equal(isAllowedFor(jobWatch, "docs/tracker-working.csv"), true);
  for (const profile of PUSHER_PROFILES) {
    if (profile.id === "job-watch") continue;
    assert.equal(
      isAllowedFor(profile, "docs/tracker-working.csv"),
      false,
      `${profile.id} must not inherit job-watch's tracker grant`,
    );
  }
  // And even job-watch may not touch the resolved store — RULING 37.
  assert.equal(isAllowedFor(jobWatch, "docs/tracker-resolved.csv"), false);
});

/* ---- 2. every pusher is guarded, anchored on the workflow files ------------ */

test("RULING 162: every workflow that pushes main declares a profile and stages only what it grants", () => {
  const audits = auditWorkflowPushers(workflowSources());
  const pushers = audits.filter((a) => a.pushes);

  // A floor, so a reader that matched nothing cannot report green (RULING 159).
  assert.ok(
    pushers.length >= 8,
    `expected at least the 8 known scheduled pushers, found ${pushers.length}. ` +
      "If a pusher was retired, move this floor in the same diff.",
  );

  const broken = pushers.filter((a) => a.problems.length > 0);
  assert.deepEqual(
    broken.map((a) => `${a.file}: ${a.problems.join(" | ")}`),
    [],
    "every workflow pushing main must pass --workflow with a declared profile",
  );

  // Every declared profile is actually used by the file it names — a profile
  // for a workflow that no longer pushes is a grant nobody is watching.
  const used = new Set(pushers.map((a) => a.workflowId));
  for (const profile of PUSHER_PROFILES) {
    assert.ok(used.has(profile.id), `profile "${profile.id}" is declared but no workflow pushes under it`);
  }
});

/* ---- 3. the instrument is shown catching the real thing (RULING 110/157) --- */

test("RULING 157: the audit catches a guardless pusher it was not derived from", () => {
  // The derived-from case is the eight real workflows, asserted above. This is
  // an INDEPENDENT case: a workflow that did not exist when the guard was
  // written, constructed here, caught, and gone when the test ends. Verifying
  // only against the instances the fix came from cannot close the class.
  const planted = {
    file: ".github/workflows/refresh-invented-source.yml",
    text: [
      "name: Refresh invented source",
      "on:",
      "  schedule:",
      '    - cron: "0 4 * * *"',
      "jobs:",
      "  refresh:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Commit",
      "        run: |",
      "          git add data/invented.json",
      '          git commit -m "invented"',
      "          node scripts/push-main.mjs",
    ].join("\n"),
  };

  const [audit] = auditWorkflowPushers([planted]);
  assert.equal(audit.pushes, true, "the reader must see this as a pusher at all");
  assert.equal(audit.workflowId, null);
  assert.ok(
    audit.problems.some((p) => /without --workflow/.test(p)),
    `a guardless pusher must be named as one; got: ${audit.problems.join(" | ")}`,
  );

  // And one that passes an id nobody declared is caught too — the other way a
  // ninth pusher slips in, which is by copying a neighbour's step and editing it.
  const [undeclared] = auditWorkflowPushers([
    { ...planted, text: planted.text.replace("push-main.mjs", "push-main.mjs --workflow refresh-invented-source") },
  ]);
  assert.ok(
    undeclared.problems.some((p) => /has no profile/.test(p)),
    `an undeclared id must be refused; got: ${undeclared.problems.join(" | ")}`,
  );

  // And a declared pusher that quietly widens its own git add is caught.
  const [widened] = auditWorkflowPushers([
    {
      file: ".github/workflows/job-watch.yml",
      text: [
        "jobs:",
        "  watch:",
        "    steps:",
        "      - run: |",
        "          git add docs/",
        "          node scripts/push-main.mjs --workflow job-watch",
      ].join("\n"),
    },
  ]);
  assert.ok(
    widened.problems.some((p) => /not allowed to push/.test(p)),
    `a widened git add must be refused; got: ${widened.problems.join(" | ")}`,
  );
});

test("RULING 162: the git add reader ignores comments, so a mention is not a stage", () => {
  const text = ["      # git add docs/rulings.md", "      run: |", "        git add data/x.json"].join("\n");
  assert.deepEqual(gitAddPathsIn(text), ["data/x.json"]);
});

test("RULING 162: build-check mentions the pusher in prose and is NOT read as one", () => {
  const audits = auditWorkflowPushers(workflowSources());
  const buildCheck = audits.find((a) => a.file.endsWith("build-check.yml"));
  assert.ok(buildCheck, "build-check.yml must be among the files read");
  assert.equal(buildCheck.pushes, false, "a comment naming push-main.mjs is not an invocation of it");
});
