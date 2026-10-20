import { ocdStateCode } from "../lib/ocd/state-of.ts";
import assert from "node:assert/strict";
import { beforeEach, afterEach, describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { allHistoryGaps } from "../lib/meetings/history-gaps.ts";
import { isWiredNoticePage } from "../lib/meetings/notice-pages.ts";
import { CURATED_BODIES, refreshCuratedBodyStatus } from "../lib/registry/curated-bodies.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const code = FIXTURE_DOOR_ROWS.slice();
const AT = "2026-10-04T12:00:00.000Z";

describe("DB-15: reader-side coverage follows the doors in use", () => {
  beforeEach(() => installFixtureDoors());
  afterEach(() => installFixtureDoors());

  it("with the installed doors, curated status is unchanged", () => {
    assert.equal(refreshCuratedBodyStatus(code), 0);
  });

  it("a board whose door is gone reads as known-uncovered, and live again when the door returns", () => {
    const board = code.find((row) => row.agendaSourceType === "CLERKSBOARDS");
    assert.ok(board);
    const without = code.filter((row) => row !== board);
    const before = CURATED_BODIES.filter((body) => body.coverageStatus === "LIVE").length;
    assert.equal(refreshCuratedBodyStatus(without), 1);
    assert.equal(CURATED_BODIES.filter((body) => body.coverageStatus === "LIVE").length, before - 1);
    assert.equal(refreshCuratedBodyStatus(code), 1);
    assert.equal(CURATED_BODIES.filter((body) => body.coverageStatus === "LIVE").length, before);
  });

  it("history gaps and notice pages are read from the doors a pass installed", async () => {
    const repos = createMemoryRepositories();
    const example = code[0]!;
    const added: BodySourceWiring = {
      ...example,
      bodyId: `${example.bodyId}-added-by-a-door-row`,
      noticeUrl: "https://example.invalid/notices-added-by-a-door-row",
      publishesHistory: false,
      historyGapReason: "added by a door row",
    };
    await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
    assert.equal(isWiredNoticePage(added.noticeUrl!), false);
    const pass = await refreshDoorsForPass(repos.doors, { state: ocdStateCode(added.ocdId)! });
    assert.equal(pass.reason, null);
    assert.equal(isWiredNoticePage(added.noticeUrl!), true);
    assert.ok(allHistoryGaps().some((gap) => gap.bodyId === added.bodyId));
    installFixtureDoors();
    assert.equal(isWiredNoticePage(added.noticeUrl!), false);
    assert.ok(!allHistoryGaps().some((gap) => gap.bodyId === added.bodyId));
  });
});
