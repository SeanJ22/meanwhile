import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { seedMeetingDoors } from "../lib/doors/seed-meetings.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

const code = FIXTURE_DOOR_ROWS.slice();
const AT = "2026-10-04T12:00:00.000Z";
const NEW_URL = "https://calendar.new-door-host.invalid/events/feed";

describe("DB-16: allowed hosts come from each door", () => {
  afterEach(() => installFixtureDoors());

  it("a door with a new host is read on the next pass with no edit to a host list, and refused once the door is gone", async () => {
    const repos = createMemoryRepositories();
    const example = code[0]!;
    const added: BodySourceWiring = { ...example, bodyId: `${example.bodyId}-added-by-a-door-row`, noticeUrl: NEW_URL };
    await seedMeetingDoors({ repo: repos.doors, wiring: [...code, added], derived: [], deriveInputAt: AT, at: AT });
    const refused = authorityFor("meetings-public-bodies", "MEETING", NEW_URL);
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false ? refused.code : "", "FINAL_ROUTE_NOT_REGISTERED");

    const pass = await refreshDoorsForPass(repos.doors, { state: "AZ" });
    assert.equal(pass.reason, null);
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL).ok, true);
    // Only HTTPS, only this source, only a host a door names.
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL.replace("https:", "http:")).ok, false);
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", "https://unnamed-host.invalid/x").ok, false);

    installFixtureDoors();
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", NEW_URL).ok, false);
  });
});
