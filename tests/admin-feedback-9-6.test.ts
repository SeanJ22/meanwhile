import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { commandCentre, type CommandCentreInput } from "../lib/control-plane/command-centre.ts";
import { readinessRowOutcome } from "../lib/control-plane/readiness/read.ts";
import { READINESS_DERIVATION_CONTRACT } from "../lib/control-plane/readiness/model.ts";
import { findingCodesWithMeaning, findingMeaning, roleLead } from "../lib/control-plane/workers/plain-roles.ts";
import { plainCount, plainDuration, plainMeaning } from "../lib/control-plane/plain-words.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { WorkerAttemptView, WorkerRoleView } from "../lib/control-plane/workers/readback.ts";

/* ========================================================================== */
/* THE 9.6.26 OWNER FEEDBACK ON THE MERGED ADMIN C — ACLOSE-6                 */
/* ========================================================================== */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* -------------------------------------------------------------------------- */
/* A — a control that looks actionable and does nothing                        */
/* -------------------------------------------------------------------------- */

/**
 * The owner clicked **Open** on *"What is blocked?"* and nothing happened. The
 * card's target was `#decisions`; no element in the application carried that
 * id. `#receipts` was dead the same way. Both were invisible because a fragment
 * with no indicated part is a no-op in every browser rather than an error.
 *
 * So the guard is not "the blocked card points at `#blocked`" — that would pass
 * again the moment someone renamed the section. It is: **every fragment this
 * projection can emit is an id something actually renders.**
 */
const ADMIN_SOURCE_DIRS = ["app"] as const;

function adminSource(): string {
  const files = filesThatWouldBeCommitted({ cwd: ROOT, paths: [...ADMIN_SOURCE_DIRS] }).filter((f) => /\.tsx?$/.test(f));
  return files.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
}

function centreInput(over: Partial<CommandCentreInput> = {}): CommandCentreInput {
  return {
    runner: { state: "Active", level: "GREEN", needsYou: false, action: null },
    code: { rawMain: "a".repeat(40), executable: "b".repeat(40), verdict: "CURRENT" },
    production: { sha: "c".repeat(40), at: "2026-09-07T08:32:53.000Z" },
    staging: { sha: "d".repeat(40), reviewState: "READY_FOR_REVIEW", decision: null },
    steward: { depth: 0, current: null, paused: false },
    promotionOn: false,
    openRecordClasses: 0,
    decisionsWaiting: 77,
    stuckIncidents: 27,
    latestReceipt: { says: "A readback was recorded.", at: "2026-09-07T08:00:00.000Z", id: "rcpt-1" },
    receiptGap: null,
    ...over,
  };
}

test("every fragment the command centre can send the owner to is an id something renders", () => {
  const source = adminSource();
  // Both branches of every card: the answered one and the could-not-read one.
  const answers = [...commandCentre(centreInput()), ...commandCentre(centreInput({
    production: null,
    staging: null,
    steward: null,
    latestReceipt: null,
    receiptGap: "not read",
    decisionsWaiting: 0,
    stuckIncidents: 0,
  }))];
  const fragments = [...new Set(answers.map((a) => a.where).filter((w): w is string => typeof w === "string" && w.startsWith("#")).map((w) => w.slice(1)))];

  assert.ok(fragments.length > 0, "the sweep found no fragment targets at all, so it is not looking at the projection");
  const dead = fragments.filter((id) => !source.includes(`id="${id}"`));
  assert.deepEqual(
    dead,
    [],
    `these cards point at fragments no element renders, so their Open control silently does nothing: ${dead.join(", ")}. ` +
      "This is the exact defect the owner found on the merged Admin C — #decisions and #receipts were both dead.",
  );
});

test("the route targets the command centre can send the owner to are real pages", () => {
  const answers = commandCentre(centreInput());
  const routes = [...new Set(answers.map((a) => a.where).filter((w): w is string => typeof w === "string" && w.startsWith("/")))];
  assert.ok(routes.length > 0, "the sweep found no route targets, so it is not looking at the projection");
  const tracked = new Set(filesThatWouldBeCommitted({ cwd: ROOT, paths: ["app"] }));
  const missing = routes.filter((route) => {
    const leaf = route.replace(/^\/admin\/?/, "");
    return ![...tracked].some((f) => f.includes(`/admin/${leaf}/page.tsx`));
  });
  assert.deepEqual(missing, [], `these cards point at routes with no page: ${missing.join(", ")}`);
});

test("the blocked card's destination is one region carrying BOTH halves of what it counts", () => {
  const blocked = commandCentre(centreInput()).find((a) => a.question === "What is blocked?");
  assert.ok(blocked, "the blocked card is gone");
  assert.equal(blocked.where, "#blocked");
  assert.match(blocked.says ?? "", /77 decisions and 27 stuck sources/);
  const page = readFileSync(join(ROOT, "app", "(admin)", "admin", "page.tsx"), "utf8");
  const region = page.slice(page.indexOf('<RevealTarget id="blocked"'), page.indexOf("</RevealTarget>"));
  assert.ok(region.length > 0, "no #blocked region is rendered on the console at all");
  assert.match(region, /<ObligationsSection/, "the stuck-source explanation is not inside the destination");
  assert.match(region, /<DecisionQueue/, "the decision list is not inside the destination");
});

test("the banner's 'Take me there' and the card's 'Open' cannot disagree — they are the same value", () => {
  // `actNext` picks the answer, and the banner renders `next.where`. A separate
  // banner target would be a second thing to keep alive.
  const strip = readFileSync(join(ROOT, "app", "(admin)", "admin", "sections", "command-centre.tsx"), "utf8");
  assert.match(strip, /<a href=\{next\.where\}>Take me there<\/a>/);
  assert.match(strip, /<a href=\{a\.where\}>Open<\/a>/);
});

test("a fragment target clears the sticky header rather than landing under it", () => {
  const layout = readFileSync(join(ROOT, "app", "(admin)", "layout.tsx"), "utf8");
  assert.match(
    layout,
    /\.reveal-target[^}]*scroll-margin-top/,
    "arriving at an anchor that the sticky console header covers is arriving nowhere the owner can see",
  );
});

test("the destination opens what is collapsed inside it, in both mechanisms", () => {
  const reveal = readFileSync(join(ROOT, "app", "(admin)", "reveal.tsx"), "utf8");
  assert.match(reveal, /querySelectorAll\("details"\)/, "plain disclosures inside the region are not opened");
  assert.match(reveal, /scrollIntoView/);
  assert.match(reveal, /\.focus\(/, "the target is never focused, so keyboard and screen-reader users do not move");
  assert.match(reveal, /hashchange/, "a second click on the same target would do nothing");
  // The decision queue owns its open state in React and cannot be reached into.
  const decisions = readFileSync(join(ROOT, "app", "(admin)", "admin", "decisions.tsx"), "utf8");
  assert.match(decisions, /addresses\("blocked"/, "the decision queue does not open when it is the destination");
  assert.match(decisions, /setOpen\(true\)/);
});

/* -------------------------------------------------------------------------- */
/* B — the research detail did not explain itself in English                   */
/* -------------------------------------------------------------------------- */

/**
 * The owner opened Parsers and read, on the face of an attempt row:
 *
 * > *source scope mismatch — The held artifact must bind to the exact observed
 * > publisher, source, route, and URL scope.*
 *
 * A de-underscored constant and the instrument's own engineering sentence. The
 * findings list was the ONE thing on that row that was neither translated nor
 * behind a disclosure.
 */
test("the two codes the owner actually read now say what happened in ordinary English", () => {
  for (const code of ["SOURCE_SCOPE_MISMATCH", "SOURCE_SHAPE_UNSUPPORTED"]) {
    const meaning = findingMeaning(code);
    assert.ok(meaning, `${code} still has no owner sentence, and it is one of the two he quoted`);
    assert.doesNotMatch(meaning, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `${meaning} carries a machine constant`);
    assert.doesNotMatch(meaning, /\bartifact\b|\bpublisher binding\b|\bURL scope\b/i, `${meaning} still speaks the instrument's vocabulary`);
    assert.ok(meaning.trim().endsWith("."), "an explanation is a sentence");
    assert.ok(meaning.length > 60, `${code}'s sentence is too short to have explained anything`);
  }
});

test("an unmapped finding code returns null rather than a plausible-sounding invention", () => {
  assert.equal(findingMeaning("SOMETHING_NOBODY_HAS_WRITTEN_YET"), null);
});

test("every owner sentence for a finding is free of machine vocabulary and is a whole sentence", () => {
  const codes = findingCodesWithMeaning();
  assert.ok(codes.length >= 40, `only ${codes.length} finding codes carry an owner sentence`);
  for (const code of codes) {
    const meaning = findingMeaning(code) ?? "";
    assert.doesNotMatch(meaning, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `${code}: ${meaning}`);
    assert.doesNotMatch(meaning, /\blib\/[a-z-]+\//, `${code} names a source path`);
    assert.ok(meaning.trim().endsWith(".") || meaning.trim().endsWith("!"), `${code} does not end a sentence`);
  }
});

test("the raw instrument sentence moved off the face and is still on the page", () => {
  const panel = readFileSync(join(ROOT, "app", "(admin)", "admin", "research", "worker-fleet-panel.tsx"), "utf8");
  const disclosure = panel.slice(panel.indexOf("the instrument&rsquo;s own words"));
  assert.match(disclosure, /f\.detail/, "the instrument's own sentence is not in the disclosure — it was deleted rather than demoted");
  const face = panel.slice(panel.indexOf('<ul className="findings">'), panel.indexOf('<ul className="findings">') + 900);
  assert.match(face, /findingMeaning/, "the face does not render the owner sentence");
  assert.doesNotMatch(face, /finding\.detail/, "the raw engineering sentence is still on the face");
});

test("a count agrees with its noun, and a duration is in seconds", () => {
  // "1 artifacts / 1" was on every attempt row.
  assert.equal(plainCount(1, "document kept", "documents kept"), "1 document kept");
  assert.equal(plainCount(2, "document kept", "documents kept"), "2 documents kept");
  assert.match(plainDuration(1552), /^1\.6 seconds$/);
  assert.match(plainDuration(839), /^0\.8 seconds$/);
});

function attempt(over: Partial<WorkerAttemptView> = {}): WorkerAttemptView {
  return {
    attemptId: "at-1",
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    worker: { role: "PARSER", provider: "deterministic", version: "1", instance: "i-1" },
    outcome: "COMPLETED",
    startedAt: "2026-09-06T22:26:00.000Z",
    endedAt: "2026-09-06T22:26:02.000Z",
    duration: null,
    cost: null,
    artifacts: { value: 1, denominator: 1, contract: "artifacts kept", source: "the vault", observedAt: "2026-09-06T22:26:02.000Z", unit: "artifacts" },
    resultStatus: "MATCHED",
    resultId: "r-1",
    verdict: "FAILED",
    executionMode: "DETERMINISTIC",
    resultDetail: "raw",
    findings: [],
    workItemState: "OPEN",
    reopenedByResult: false,
    ...over,
  } as WorkerAttemptView;
}

test("a verdict is not glossed with the same word it already is", () => {
  const metric = (value: number) => ({
    value,
    denominator: value,
    contract: "attempts shown",
    source: "the attempt log",
    observedAt: "2026-09-06T22:26:02.000Z",
    unit: "attempts" as const,
  });
  const role = {
    role: "PARSER",
    shown: metric(2),
    pending: metric(0),
    due: metric(0),
    attempts: [attempt(), attempt({ attemptId: "at-2", verdict: "EXTRACTED" })],
  } as unknown as WorkerRoleView;
  const lead = roleLead(role);
  assert.doesNotMatch(lead.doing, /failed \(failed\)/, "the owner read `2 failed (failed)` — a word glossed by itself");
  assert.match(lead.doing, /extracted \(records were extracted\)/, "a real translation must survive");
});

/* -------------------------------------------------------------------------- */
/* C — the release review led with machine identity                            */
/* -------------------------------------------------------------------------- */

test("the release manifest's status words have owner translations", () => {
  for (const code of ["STAGING_READY_FOR_OWNER_REVIEW", "STAGING_BOUNDARY_STABLE", "MANIFEST_UNAVAILABLE"]) {
    assert.ok(plainMeaning(code), `${code} was on the face of the release review and still has no owner sentence`);
  }
});

test("the release review answers the owner's questions before it shows an identifier", () => {
  const page = readFileSync(join(ROOT, "app", "(admin)", "admin", "release-review", "page.tsx"), "utf8");
  const plainAt = page.indexOf('className="rr-plain"');
  const identityAt = page.indexOf('className="rr-build-identity"');
  assert.ok(plainAt > 0, "the four plain answers are not on the page");
  assert.ok(identityAt > 0, "the build identity block is gone rather than demoted");
  assert.ok(plainAt < identityAt, "the SHAs still come before the plain answers");
  for (const question of ["Review site", "Live site", "Needs you", "What your decision does"]) {
    assert.ok(page.includes(`<dt>${question}</dt>`), `the face never answers "${question}"`);
  }
  assert.match(page, /does not merge code, it does not deploy anything/, "the page must say what does NOT happen");
});

test("the build identity is a disclosure, and every identifier is still inside it", () => {
  const page = readFileSync(join(ROOT, "app", "(admin)", "admin", "release-review", "page.tsx"), "utf8");
  const from = page.indexOf('className="rr-build-identity"');
  const block = page.slice(from, page.indexOf("</details>", from));
  assert.ok(block.length > 0, "the build identity disclosure is not closed, or is not there at all");
  assert.match(block, /prompt3Status/, "the manifest codes were deleted rather than demoted");
  assert.match(block, /staging boundary/);
  assert.match(block, /CopyButton/, "an auditor must still be able to copy the exact identifiers");
  assert.match(block, /<ProductionCard \/>/);
});

test("the release review is swept for plain English like every other admin page", () => {
  const sweep = readFileSync(join(ROOT, "scripts", "admin-plain-sweep.mts"), "utf8");
  const list = sweep.slice(sweep.indexOf("SWEPT_PATHS"), sweep.indexOf("/** One kind of thing"));
  assert.match(list, /"admin\/release-review"/, "the one page whose whole face was manifest codes is not swept");
});

/* -------------------------------------------------------------------------- */
/* D — state readiness told the owner to run a command                         */
/* -------------------------------------------------------------------------- */

test("a superseded readiness snapshot says what happened in owner language, and needs nobody", () => {
  const out = readinessRowOutcome(
    { derivationContract: "readiness/instrument-derived@1", publishedAt: "2026-09-07T08:25:05.786Z", publisher: "readiness-refresh.mts" } as never,
    "control plane (Postgres)",
    "Arizona",
    { revision: 25, updatedAt: "2026-09-07T08:25:05.786Z" },
  );
  assert.equal(out.kind, "REQUIRES_REPUBLISH");
  if (out.kind !== "REQUIRES_REPUBLISH") return;

  assert.equal(out.needsYou, false, "a republish is the runner's job every cycle and never the owner's");
  // The face must not carry the contract identifier, a command, or a module name.
  for (const field of [out.says, out.next]) {
    assert.doesNotMatch(field, /instrument-derived/, `the face names the derivation contract: ${field}`);
    assert.doesNotMatch(field, /\bpnpm [a-z]/, `the face tells the owner to run a command: ${field}`);
    assert.doesNotMatch(field, /\.mts\b|\blib\//, `the face names a module: ${field}`);
    assert.doesNotMatch(field, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `the face carries a machine constant: ${field}`);
  }
  assert.match(out.says, /Arizona/, "the sentence must name the state it is about");
  assert.match(out.next, /Nothing needs you\./);
  // And every machine fact is still carried, for the disclosure.
  assert.equal(out.snapshotContract, "readiness/instrument-derived@1");
  assert.equal(out.currentContract, READINESS_DERIVATION_CONTRACT);
  assert.equal(out.legacy.revision, 25);
  assert.match(out.detail, /superseded/);
  assert.equal(out.clearedBy.command, "automatic standing-runtime console publisher");
  assert.doesNotMatch(out.clearedBy.command, /readiness:publish|\bpnpm\b/,
    "the recovery identity must not restore a retired owner-run command");
});

test("the readiness page puts the machine facts one disclosure down, and keeps them", () => {
  const page = readFileSync(join(ROOT, "app", "(admin)", "readiness", "[state]", "page.tsx"), "utf8");
  const start = page.indexOf('outcome.kind === "REQUIRES_REPUBLISH"');
  const block = page.slice(start, page.indexOf("const snapshot: ReadinessStateSnapshot"));
  assert.match(block, /\{outcome\.says\}/, "the page does not lead with the owner sentence");
  assert.match(block, /\{outcome\.next\}/);
  const disclosureAt = block.indexOf("<details");
  assert.ok(disclosureAt > 0, "there is no Technical details disclosure");
  assert.ok(block.indexOf("{outcome.says}") < disclosureAt, "the machine facts still come first");
  const disclosure = block.slice(disclosureAt);
  assert.match(disclosure, /clearedBy\.command/, "the standing publisher identity was deleted from the technical disclosure");
  assert.match(disclosure, /snapshotContract/, "the contract identifier was deleted rather than demoted");
  assert.match(disclosure, /outcome\.detail/);
});

test("the console is published before the first cycle, not only after one", () => {
  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  const loopAt = runner.indexOf("while (cycle < CYCLES)");
  assert.ok(loopAt > 0);
  const before = runner.slice(0, loopAt);
  assert.match(
    before,
    /publishConsole\(\);/,
    "nothing republishes the console until a whole cycle has finished, so a runner that just came up on new code " +
      "leaves every readiness panel quarantined for up to a full cycle — which is exactly what the owner walked into",
  );
});
