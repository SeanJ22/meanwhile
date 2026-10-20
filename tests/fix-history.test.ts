import assert from "node:assert/strict";
import test from "node:test";

import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import { fixEpisodes, fixHistoryLine, historyFor, methodBreakFixWords, recordAttemptsKeepingHistory, withEpisodeKept, type FixItemWithHistory } from "../lib/control-plane/fix-history.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { fixQueueView } from "../lib/control-plane/fix-queue.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { memoryFixMap } from "../lib/method/fix-map-record.ts";

const item = (over: Partial<FixItemWithHistory> = {}): FixItemWithHistory => ({
  id: "fix-1", where: "Door d-1", says: "The meetings door is shut: the page moved.", addedBy: "The shut-door check",
  addedAt: "2026-09-01T12:00:00.000Z", state: "FIXED", fixedAt: "2026-09-02T12:00:00.000Z", whatChanged: "The door's record was edited.", changedBy: "A change to the door's record", ...over,
});

test("a fix that came back keeps the finished episode; fixed again, the item reads two episodes with how long each fix held", () => {
  const cameBack = withEpisodeKept(item(), "2026-09-12T12:00:00.000Z");
  assert.equal(cameBack.state, "CAME_BACK");
  assert.equal(cameBack.earlier?.length, 1);
  const fixedAgain: FixItemWithHistory = { ...cameBack, state: "FIXED", fixedAt: "2026-09-13T00:00:00.000Z", whatChanged: "Nothing on our side changed; the source answered again." };
  const episodes = fixEpisodes(fixedAgain, "2026-09-15T00:00:00.000Z");
  assert.deepEqual(episodes.map((e) => [e.brokeAt, e.fixedAt, e.heldHours, e.stillHolding]), [
    ["2026-09-01T12:00:00.000Z", "2026-09-02T12:00:00.000Z", 240, false],
    ["2026-09-12T12:00:00.000Z", "2026-09-13T00:00:00.000Z", 48, true],
  ]);
  const line = fixHistoryLine(fixedAgain, "2026-09-15T00:00:00.000Z");
  assert.match(line, /^Broke .*; fixed .*held 10 days\. Broke again .*holding for 2 days\.$/);
  assert.doesNotMatch(line, /T\d\d:/, "times are Eastern words, not raw stamps");
  assert.equal(historyFor([fixedAgain, item({ id: "x", where: "Door other" })], "Door d-1", "2026-09-15T00:00:00.000Z").length, 2);
});

test("an episode never fixed says so, and old items without kept episodes read as one", () => {
  const open = item({ state: "OPEN", fixedAt: undefined, whatChanged: undefined });
  assert.equal(fixEpisodes(open, "2026-09-03T00:00:00.000Z").length, 1);
  assert.match(fixHistoryLine(open, "2026-09-03T00:00:00.000Z"), /not fixed yet\.$/);
});

test("Admin's Fix list shows the history and how long the fix has held", () => {
  const cameBack = withEpisodeKept(item(), "2026-09-12T12:00:00.000Z");
  const view = v6FixesView(fixQueueView([]), [{ ...cameBack, state: "FIXED", fixedAt: "2026-09-13T00:00:00.000Z" }], "2026-09-15T00:00:00.000Z");
  assert.equal(view.closed.length, 1);
  assert.match(view.closed[0].history ?? "", /held 10 days\. Broke again/);
  assert.equal(view.closed[0].since, "Holding for 2 days");
});

test("a method going from working to failing in a place opens a fix item; working again completes it", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  const attempt = (id: string, outcome: "SUCCEEDED" | "FAILED", at: string) => ({ kind: "ROUTE_RUN" as const, attemptId: id, placeId: "place-1", methodIds: ["m-1"], outcome, cause: outcome === "FAILED" ? "The page moved." : null, at });
  let out = await recordAttemptsKeepingHistory(map, repos, [attempt("a1", "FAILED", "2026-09-01T00:00:00.000Z")]);
  assert.equal(out.broke, 0, "a first failure with nothing known to work is not a break");
  out = await recordAttemptsKeepingHistory(map, repos, [attempt("a2", "SUCCEEDED", "2026-09-02T00:00:00.000Z"), attempt("a3", "FAILED", "2026-09-03T00:00:00.000Z")]);
  assert.deepEqual([out.written, out.broke], [2, 1]);
  const config = () => repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { fixList: true }).then((r) => r.value as AdminConfig);
  const where = methodBreakFixWords("m-1", "place-1").where;
  assert.deepEqual(fixItems(await config()).filter((i) => i.where === where).map((i) => [i.state, i.addedBy]), [["OPEN", "The fix map"]]);
  out = await recordAttemptsKeepingHistory(map, repos, [attempt("a4", "SUCCEEDED", "2026-09-04T00:00:00.000Z")]);
  assert.equal(out.fixed, 1);
  const done = fixItems(await config()).find((i) => i.where === where)!;
  assert.equal(done.state, "FIXED");
  assert.equal(done.fixedAt, "2026-09-04T00:00:00.000Z");
  out = await recordAttemptsKeepingHistory(map, repos, [attempt("a0", "FAILED", "2026-08-01T00:00:00.000Z")]);
  assert.equal(out.broke, 0, "an older replay does not reopen it");
});
