import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { refreshMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor, installDoorHosts } from "../lib/civic-data/source-authority.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import { refreshCuratedBodyStatus } from "../lib/registry/curated-bodies.ts";
import { installRegistryWiring, SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";

const code = SOURCE_WIRING.slice();
const AT = "2026-10-04T12:00:00.000Z";
const NEW_URL = "https://calendar.new-door-host.invalid/events/feed";

function restore(): void {
  installDoorHosts(null);
  installRegistryWiring(null);
  refreshMeetingPartitions(code);
  refreshCuratedBodyStatus(code);
}

describe("DB-16: allowed hosts come from each door", () => {
  afterEach(restore);

  it("a door with a new host is read on the next pass with no edit to a host list, and is refused again on the code's list", async () => {
    const repos = createMemoryRepositories();
    const example = code[0]!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row`, noticeUrl: NEW_URL };
    await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
    const refused = authorityFor("meetings-public-bodies", "MEETING", NEW_URL);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.code : "", "FINAL_ROUTE_NOT_REGISTERED");

    const pass = await refreshDoorsForPass(repos.doors, { mode: "registry" });
    assert.equal(pass.reading, "registry", pass.reason ?? "");
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL).ok, true);
    // Only HTTPS, only this source, only a host a door names.
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL.replace("https:", "http:")).ok, false);
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", "https://unnamed-host.invalid/x").ok, false);

    await refreshDoorsForPass(repos.doors, { mode: "code" });
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL).ok, false);
  });
});
