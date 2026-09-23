import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FLEET_TABS, READINESS_TABS, withScope } from "../app/(admin)/_mw/scope.ts";
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
 * again the moment someone renamed the section. It is: **every fragment the
 * console can send the owner to is an id something actually renders.**
 *
 * Admin redesign, 2026-09-23: the command centre strip and its cards were
 * removed (its projection, `lib/control-plane/command-centre.ts`, is no longer
 * drawn by any page), so the sweep now reads the fragment links the console
 * itself builds — on Fleet · Work, in the composer, from a readiness code to
 * the body it names on Fleet · Now, and on the pages that kept their content.
 */
const ADMIN_SOURCE_DIRS = ["app"] as const;

function adminFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT, paths: [...ADMIN_SOURCE_DIRS] }).filter((f) => /\.tsx?$/.test(f));
}

function adminSource(): string {
  return adminFiles().map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
}

/** Every fragment an admin link names: the literal id, or the fixed prefix of a built one. */
function fragmentLinks(): { readonly from: string; readonly line: string; readonly id: string; readonly built: boolean }[] {
  const out: { from: string; line: string; id: string; built: boolean }[] = [];
  for (const f of adminFiles().filter((p) => p.startsWith("app/(admin)/"))) {
    for (const line of readFileSync(join(ROOT, f), "utf8").split("\n")) {
      if (!/\bhref=/.test(line)) continue;
      for (const m of line.matchAll(/#([a-z][\w-]*?)(\$\{|[`"'])/g)) out.push({ from: f, line: line.trim(), id: m[1], built: m[2] === "${" });
    }
  }
  return out;
}

test("every fragment the console sends the owner to is an id something renders", () => {
  const source = adminSource();
  const links = fragmentLinks();
  assert.ok(links.some((l) => l.id === "assignments") && links.some((l) => l.built), "the sweep found none of the console's fragment links, so it is not looking at them");
  const dead = links.filter((l) => (l.built ? !source.includes(`id={\`${l.id}\${`) : !source.includes(`id="${l.id}"`)));
  assert.deepEqual(
    dead.map((l) => `${l.from}: #${l.id}${l.built ? "…" : ""}`),
    [],
    "these links point at fragments no element renders, so they silently do nothing. " +
      "This is the exact defect the owner found on the merged Admin C — #decisions and #receipts were both dead.",
  );
});

test("a fragment link built through the scope helper keeps its fragment where the browser reads it", () => {
  /*
   * A URL's fragment runs to its end: a query written after `#` is read as part
   * of the fragment, which then names no element — and the scope it carried is
   * lost with it. The redesigned pages build their links with `withScope`.
   */
  const built = [...adminSource().matchAll(/withScope\(`([^`]*#[^`]*)`/g)].map((m) => m[1]);
  assert.ok(built.length > 0, "the sweep found no fragment link built with withScope, so it is not looking at them");
  for (const raw of built) {
    const path = raw.replace(/\$\{[^}]*\}/g, "x");
    const url = new URL(withScope(path, { kind: "state", state: "az" }), "https://admin.invalid");
    assert.equal(url.hash, `#${path.split("#")[1]}`, `${raw}: the scope is written after the fragment, so the browser reads "${url.hash}" as the id to scroll to — no element has it — and the scope is dropped`);
    assert.equal(url.searchParams.get("scope"), "az", `${raw}: the scope does not survive the link`);
  }
});

test("the route targets the console's own navigation sends the owner to are real pages", () => {
  // Admin redesign, 2026-09-23: the command centre's cards were removed; the console's routes are now its area tabs, its area toggle and its Other pages menu.
  const header = readFileSync(join(ROOT, "app", "(admin)", "_mw", "header-controls.tsx"), "utf8");
  const others = [...header.matchAll(/\{ href: "(\/[^"]+)", label:/g)].map((m) => m[1]);
  assert.ok(others.length >= 5, `the sweep must read the Other pages menu; saw ${others.length}`);
  const routes = [...new Set([...FLEET_TABS.map((t) => t.path), ...READINESS_TABS.map((t) => t.path), ...others])];
  const tracked = new Set(filesThatWouldBeCommitted({ cwd: ROOT, paths: ["app"] }));
  const missing = routes.filter((route) => !tracked.has(`app/(admin)${route}/page.tsx`));
  assert.deepEqual(missing, [], `these links point at routes with no page: ${missing.join(", ")}`);
  assert.ok(tracked.has("app/(admin)/readiness/[state]/page.tsx"), "the Readiness toggle lands on a state's page when the scope names one");
});

// Admin redesign, 2026-09-23: the "What is blocked?" card and its #blocked region were removed with the command centre; Fleet · Now's three cards are counted from the lists drawn beneath them on the same page.
// Admin redesign, 2026-09-23: the command centre's banner and its per-card Open links were removed, so there is no second target to keep in step.

test("a fragment target clears the sticky header rather than landing under it", () => {
  const layout = readFileSync(join(ROOT, "app", "(admin)", "layout.tsx"), "utf8");
  assert.match(
    layout,
    /\.reveal-target[^}]*scroll-margin-top/,
    "arriving at an anchor that the sticky console header covers is arriving nowhere the owner can see",
  );
});

// Admin redesign, 2026-09-23: the reveal-on-arrival wrapper and the collapsible decision queue it opened were removed; Fleet · Work opens an assignment in place from its URL (?open=), and the suggested next steps are never collapsed.

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
  // Admin redesign, 2026-09-23: the state page was redrawn in the shell; its branch for a record worked out an older way is now a refusal box over the `readiness` outcome. The rule follows the branch.
  const page = readFileSync(join(ROOT, "app", "(admin)", "readiness", "[state]", "page.tsx"), "utf8");
  const start = page.indexOf('readiness.kind === "REQUIRES_REPUBLISH" && (');
  assert.ok(start > 0, "the state page has no branch for a record worked out an older way");
  const block = page.slice(start, page.indexOf(")}", page.indexOf("</Refusal>", start)));
  assert.match(block, /\{readiness\.says\}/, "the page does not lead with the owner sentence");
  assert.match(block, /\{readiness\.next\}/);
  const disclosureAt = block.indexOf("<details");
  assert.ok(disclosureAt > 0, "there is no Technical details disclosure: the machine facts were deleted rather than demoted");
  assert.ok(block.indexOf("{readiness.says}") < disclosureAt, "the machine facts still come first");
  const disclosure = block.slice(disclosureAt);
  assert.match(disclosure, /clearedBy\.command/, "the standing publisher identity was deleted from the technical disclosure");
  assert.match(disclosure, /snapshotContract/, "the contract identifier was deleted rather than demoted");
  assert.match(disclosure, /readiness\.detail/);
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
