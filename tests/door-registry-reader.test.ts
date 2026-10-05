import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { allHistoryGaps } from "../lib/meetings/history-gaps.ts";
import { isWiredNoticePage } from "../lib/meetings/notice-pages.ts";
import { CURATED_BODIES, refreshCuratedBodyStatus } from "../lib/registry/curated-bodies.ts";
import { installRegistryWiring, SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";

const code = SOURCE_WIRING.slice();
const AT = "2026-10-04T12:00:00.000Z";

function restore(): void {
  installRegistryWiring(null);
  refreshMeetingPartitions(code);
  refreshCuratedBodyStatus(code);
}

describe("DB-15: reader-side coverage follows the doors in use", () => {
  afterEach(restore);

  it("with the code's own list, curated status is unchanged", () => {
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
    const pass = await refreshDoorsForPass(repos.doors, { mode: "registry" });
    assert.equal(pass.reading, "registry", pass.reason ?? "");
    assert.equal(isWiredNoticePage(added.noticeUrl!), true);
    assert.ok(allHistoryGaps().some((gap) => gap.bodyId === added.bodyId));
    installRegistryWiring(null);
    assert.equal(isWiredNoticePage(added.noticeUrl!), false);
    assert.ok(!allHistoryGaps().some((gap) => gap.bodyId === added.bodyId));
  });
});
