import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import {
  BODY_ROSTERS,
  governingRosterHoldersForDivision,
  rosterHoldersForBody,
} from "../lib/registry/body-rosters.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import { normalizeName } from "../lib/routing/exact-name.ts";

/** Rosters are sourced, dated, keyed to real registry bodies, and actually rendered. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every roster keys to a real body — a roster for nothing is a curation error", () => {
  // A roster may belong to a known registry body whose calendar is not wired yet; a roster keyed to nothing is forbidden.
  const wiredIds = new Set(SOURCE_WIRING.map((r) => r.bodyId));
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
  ) as { bodies: { id: string }[] };
  const registryIds = new Set(registry.bodies.map((b) => b.id));
  for (const roster of BODY_ROSTERS) {
    assert.ok(
      wiredIds.has(roster.bodyId) || registryIds.has(roster.bodyId),
      `${roster.bodyName}: bodyId matches neither a source-wiring row nor a registry body`,
    );
  }
});

/** No two rosters share a body: the lookup returns the first match, so a second roster on one bodyId would render nowhere. */
test("no two rosters claim the same body", () => {
  const byId = new Map<string, string[]>();
  for (const roster of BODY_ROSTERS) {
    byId.set(roster.bodyId, [...(byId.get(roster.bodyId) ?? []), roster.bodyName]);
  }
  const clashes = [...byId.entries()].filter(([, names]) => names.length > 1);
  assert.deepEqual(
    clashes.map(([id, names]) => `${id} — ${names.join(" | ")}`),
    [],
    "a second roster on one bodyId renders nowhere and drifts from the one that does",
  );
  assert.equal(byId.size, BODY_ROSTERS.length);

  // And every member id is unique across the WHOLE register, not only within
  // its own roster — two people sharing an id is the same defect one level in.
  const memberIds = BODY_ROSTERS.flatMap((r) => r.members.map((m) => m.id));
  const seen = new Set<string>();
  const dupes = memberIds.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(dupes, []);
});

test("every roster cites the body's own page, never a vendor's", () => {
  const vendorHosts = /legistar|civicplus|hylandcloud|diligent|civicweb|apptegy|iqm2|revize/i;
  for (const roster of BODY_ROSTERS) {
    assert.match(roster.sourceUrl, /^https:\/\//);
    assert.ok(
      !vendorHosts.test(new URL(roster.sourceUrl).hostname),
      `${roster.bodyName}: roster cited to a vendor host — rosters come from the body's own page`,
    );
    assert.match(
      roster.collectedAt,
      /^\d{4}-\d{2}-\d{2}$/,
      `${roster.bodyName}: collectedAt must be a date — sourced AND dated`,
    );
  }
});

test("every member has a name and a published title", () => {
  for (const roster of BODY_ROSTERS) {
    assert.ok(roster.members.length >= 3, `${roster.bodyName}: suspiciously thin roster`);
    const ids = new Set<string>();
    for (const member of roster.members) {
      assert.ok(member.name.length >= 5, `${roster.bodyName}: bad name "${member.name}"`);
      assert.ok(member.officeTitle.length >= 4, `${member.name}: no title`);
      assert.ok(!ids.has(member.id), `duplicate member id ${member.id}`);
      ids.add(member.id);
    }
  }
});

/** The sourced roster name and the name the identity layer serves are one name. */
test("NH288: every roster's sourced bodyName is the name the identity layer serves", () => {
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
  ) as { bodies: { id: string; name: string | null }[] };
  const registryName = new Map(registry.bodies.map((b) => [b.id, b.name]));

  for (const roster of BODY_ROSTERS) {
    const identity = canonicalBodyIdentity(roster.bodyId);
    assert.ok(
      identity,
      `${roster.bodyName}: ${roster.bodyId} resolves to no canonical identity at all`,
    );

    /* A roster is the body's own page read on a stated date; a body it names
       may never report that nothing has named it. */
    assert.ok(
      identity.nameIsBodysOwn,
      `${roster.bodyName}: nameIsBodysOwn is false while a sourced roster names the body`,
    );

    if (!registryName.get(roster.bodyId)) {
      /* The registry row holds no name (a derived row is FORBIDDEN to mint
         one), so the roster is the body's only sourced name and the identity
         layer must serve exactly it — never the division's label. */
      assert.equal(
        identity.name,
        roster.bodyName,
        `${roster.bodyId}: the identity layer serves "${identity.name}" while the ` +
          `roster's sourced name is "${roster.bodyName}" — a geography is standing ` +
          "in for a government again",
      );
    } else {
      /* The registry named the body itself and wins; the roster may qualify it with the town, so the served name appears whole inside the roster's. */
      assert.ok(
        ` ${normalizeName(roster.bodyName)} `.includes(` ${normalizeName(identity.name)} `),
        `${roster.bodyId}: registry name "${identity.name}" and roster name ` +
          `"${roster.bodyName}" disagree about what this body is called`,
      );
    }
  }
});

test("NH288: the named example — the Board of Supervisors is not 'Pima'", () => {
  const identity = canonicalBodyIdentity(
    "ocd-division/country:us/state:az/county:pima#governing",
  );
  assert.equal(identity?.name, "Pima County Board of Supervisors");
  assert.equal(identity?.nameIsBodysOwn, true);
  /* The division stays CONTEXT, carried separately — the repair adds the
     body's name and removes nothing sourced. */
  assert.equal(identity?.divisionLabel, "Pima");
});

test("the author's named example is covered: TUSD renders a full board", () => {
  const holders = rosterHoldersForBody(
    "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
  );
  /* The superintendent is in the roster array because the body card's superintendent slot resolves from it; he is hired by the board and does not sit on it. */
  const seated = holders.filter((h) => !/superintendent/i.test(h.officeTitle));
  const hired = holders.filter((h) => /superintendent/i.test(h.officeTitle));
  assert.equal(seated.length, 5, "TUSD's board has five ELECTED seats");
  assert.equal(hired.length, 1, "and one hired superintendent");
  assert.equal(holders.length, 6);
  assert.ok(seated.some((h) => h.officeTitle.includes("President")));
  for (const holder of holders) {
    assert.ok(holder.sourceUrl, `${holder.name}: no source — a name without one may not render`);
  }

  // The hired executive must never be labelled as a board seat. A reader who
  // reads "Governing Board Member" beside the superintendent's name has been
  // told something false about how the district is governed.
  assert.equal(hired[0].officeTitle, "Superintendent");
  assert.ok(
    !/board member|board president|board clerk/i.test(hired[0].officeTitle),
    "the superintendent must not wear a board title",
  );
});

/** The seated/hired split, held at the render: one person never appears under both. */
test("F01 1.2: the superintendent is pulled out of the seated list, not duplicated", () => {
  const entry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.match(
    entry,
    /const seated = superintendent\s*\n?\s*\? roster\.filter\(\(h\) => h\.id !== superintendent\.id\)\s*\n?\s*: roster;/,
    "the seated list must exclude the hired superintendent",
  );
  assert.match(entry, /representation: seated,/);
});

test("the mayor joins the model (5b): Tucson's roster includes the Mayor", () => {
  const holders = rosterHoldersForBody(
    "ocd-division/country:us/state:az/place:tucson#governing",
  );
  const mayor = holders.find((h) => h.officeTitle === "Mayor");
  assert.ok(mayor, "no Mayor on the Tucson Mayor & Council roster");
  assert.ok(mayor.email && mayor.phone, "the mayor's published contact must ride along");
  // 7 = the mayor plus six ward members — Tucson's actual council.
  assert.equal(holders.length, 7);
});

test("an unwired body renders the honest absence, not an invented roster", () => {
  assert.deepEqual(rosterHoldersForBody("no-such-body"), []);
  assert.deepEqual(rosterHoldersForBody(null), []);
});

test("the surfaces render the rosters — the register is not shelf-ware", () => {
  const mapEntry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.ok(
    mapEntry.includes("projectedBodyRoster"),
    "map-entry must render the roster projection supplied by the server",
  );
});

test("the division lookup finds both registry suffixes — school boards are #board", () => {
  // A #governing-only lookup would miss every school-board roster.
  const tusd = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:tucson_unified_district",
  );
  assert.ok(tusd.length >= 5, "TUSD board roster unreachable by division");
  const sunnyside = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
  );
  assert.ok(sunnyside.length === 5, "Sunnyside board roster unreachable by division");
  assert.ok(sunnyside.some((m) => m.name === "Beki Quintero"));
  const amphi = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
  );
  assert.ok(amphi.length === 5, "Amphitheater board roster unreachable by division");
  const tucson = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/place:tucson",
  );
  assert.ok(tucson.length > 0, "#governing bodies must still resolve");
  assert.equal(governingRosterHoldersForDivision(null).length, 0);
});
