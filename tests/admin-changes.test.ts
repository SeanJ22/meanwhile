import assert from "node:assert/strict";
import { test } from "node:test";

import { changeRowOf, groupChanges, plainLine, sessionOf, type ChangePr } from "../lib/control-plane/changes/model.ts";
import { forgetChanges, readChanges } from "../lib/control-plane/changes/source.ts";

const pr = (over: Partial<ChangePr>): ChangePr => ({
  number: 1,
  title: "S11: Every click does what it says",
  url: "https://github.com/x/y/pull/1",
  state: "OPEN",
  isDraft: false,
  updatedAt: "2026-09-30T18:00:00Z",
  mergedAt: null,
  headRefName: "codex/s11-admin",
  baseRefName: "main",
  checks: "SUCCESS",
  ...over,
});

test("the session and the plain line come from the title, then the branch", () => {
  assert.equal(sessionOf(pr({})), "S11");
  assert.equal(sessionOf(pr({ title: "Add staging-only terminal owner controls", headRefName: "codex/s8-staging-owner-action" })), "S8");
  assert.equal(sessionOf(pr({ title: "Engineer adapter: x", headRefName: "engineer-adapter/x" })), null);
  assert.equal(plainLine("S7 draft: lease workers, provider capacity"), "Lease workers, provider capacity");
  assert.equal(plainLine("S5: Auditor — after publishing, sampled across strata"), "Auditor — after publishing, sampled across strata");
  const long = `S4: ${"word ".repeat(10)}— ${"tail ".repeat(40)}`;
  assert.ok(plainLine(long).length < 100, "a long tail after a dash is cut");
});

test("status follows draft, checks, merge and the live site", () => {
  assert.equal(changeRowOf(pr({ isDraft: true }))?.status, "building");
  assert.equal(changeRowOf(pr({ checks: "PENDING" }))?.status, "building");
  assert.equal(changeRowOf(pr({ checks: "FAILURE" }))?.why, "A check is failing.");
  assert.equal(changeRowOf(pr({ checks: "SUCCESS" }))?.status, "on-test");
  assert.equal(changeRowOf(pr({ state: "CLOSED" })), null);
  const merged = pr({ state: "MERGED", mergedAt: "2026-09-30T19:00:00Z" });
  assert.equal(changeRowOf(merged, "in-live-site")?.status, "live");
  assert.equal(changeRowOf(merged, "no-site-change")?.status, "live");
  assert.equal(changeRowOf(merged, "not-yet")?.status, "deploying");
  assert.equal(changeRowOf(merged, "unknown")?.status, "deploying");
  assert.equal(changeRowOf({ ...merged, baseRefName: "codex/other" }, "in-live-site")?.status, "building");
  const groups = groupChanges([changeRowOf(pr({ number: 2, updatedAt: "2026-09-30T20:00:00Z" }))!, changeRowOf(pr({ number: 3 }))!]);
  assert.deepEqual(groups["on-test"].map((r) => r.number), [2, 3], "newest first");
  assert.equal(groups.live.length, 0);
});

const LIVE = "a".repeat(40);
const node = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n, title: `S${n}: change ${n}`, url: `https://github.com/x/y/pull/${n}`, state: "OPEN", isDraft: false,
  updatedAt: "2026-09-30T18:00:00Z", mergedAt: null, headRefName: `b${n}`, baseRefName: "main", mergeCommit: null,
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] }, ...extra,
});

function fakeGithub(nodes: unknown[], compare: Record<string, string>, files: Record<number, string[]> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith("/graphql")) return json({ data: { repository: { pullRequests: { nodes } } } });
    const cmp = /compare\/([0-9a-f]+)\.\.\.[0-9a-f]+$/.exec(url);
    if (cmp) return json({ status: compare[cmp[1]] ?? "diverged" });
    const f = /pulls\/(\d+)\/files/.exec(url);
    if (f) return json((files[Number(f[1])] ?? ["app/page.tsx"]).map((filename) => ({ filename })));
    return json({}, 404);
  }) as typeof fetch;
}

test("without a token the page says what is missing and lists nothing", async () => {
  forgetChanges();
  const reading = await readChanges({ env: {}, force: true, fetchImpl: fakeGithub([], {}) });
  assert.equal(reading.kind, "UNAVAILABLE");
  if (reading.kind === "UNAVAILABLE") assert.match(reading.fix ?? "", /WTP_GITHUB_READ_TOKEN/);
});

test("merged work is live when the live site holds it, and no-site-change when it touches nothing served", async () => {
  forgetChanges();
  const now = Date.parse("2026-09-30T20:00:00Z");
  const merged = (n: number, sha: string) => node(n, { state: "MERGED", mergedAt: "2026-09-30T19:00:00Z", mergeCommit: { oid: sha } });
  const a = "1".repeat(40), b = "2".repeat(40), c = "3".repeat(40);
  const reading = await readChanges({
    env: { WTP_GITHUB_READ_TOKEN: "t", WTP_BUILD_COMMIT: LIVE },
    force: true,
    nowMs: () => now,
    fetchImpl: fakeGithub([node(9), merged(10, a), merged(11, b), merged(12, c)], { [a]: "ahead", [b]: "diverged", [c]: "diverged" }, { 11: ["docs/x.md", "tests/y.test.ts"], 12: ["app/page.tsx"] }),
  });
  assert.equal(reading.kind, "OBSERVED");
  if (reading.kind !== "OBSERVED") return;
  const byNumber = Object.fromEntries(reading.rows.map((r) => [r.number, r]));
  assert.equal(byNumber[9].status, "on-test");
  assert.equal(byNumber[10].status, "live");
  assert.equal(byNumber[11].status, "live");
  assert.match(byNumber[11].why, /nothing to deploy/);
  assert.equal(byNumber[12].status, "deploying");
});

test("a refused token reads as unavailable, never as an empty list", async () => {
  forgetChanges();
  const refuse = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const reading = await readChanges({ env: { WTP_GITHUB_READ_TOKEN: "bad" }, force: true, fetchImpl: refuse });
  assert.equal(reading.kind, "UNAVAILABLE");
});
