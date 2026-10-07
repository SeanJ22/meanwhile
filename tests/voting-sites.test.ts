import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  censusOf,
  heldVotingSiteCoordinates,
  votingSiteAddressKey,
  directionsUrl,
  modelSentence,
  narrowingFor,
  refusalLine,
  type VotingSitesFile,
} from "../lib/ballot/voting-sites.ts";

const site = (id: string, address: string, lat: number | null, lng: number | null, election: string | null) =>
  ({ id, name: `Site ${id}`, address, room: null, lat, lng, kind: "ELECTION_DAY" as const, election, serves: null });

const file: VotingSitesFile = {
  generatedAt: "2026-08-19",
  jurisdictions: [
    {
      ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County", state: "AZ", model: "VOTE_CENTER",
      election: "2026 General",
      sites: [
        site("vc-1", "100 Main Street, Exampleville, AZ 85000", 32.2, -110.9, "2026 General"),
        site("vc-2", "200 Oak Avenue, Exampleville, AZ 85000", null, null, null),
      ],
      sourceOrg: "Example County Elections", sourceUrl: "https://elections.example.gov/az", collectedAt: "2026-08-19", refusal: null,
    },
    {
      ocdId: "ocd-division/country:us/state:nj/place:example_one", name: "Town of Example One", state: "NJ", model: "ASSIGNED",
      election: "2026 General Election",
      sites: [site("one-1", "1 Elm Street, Example One, NJ 07000", 40.9, -74.4, "2026 General Election")],
      sourceOrg: "Example County Board of Elections", sourceUrl: "https://elections.example.gov/nj/one", collectedAt: "2026-08-19", refusal: null,
    },
    {
      ocdId: "ocd-division/country:us/state:nj/place:example_two", name: "Borough of Example Two", state: "NJ", model: "ASSIGNED",
      election: "2026 General Election",
      sites: [
        site("two-1", "2 Pine Street, Example Two, NJ 07001", 40.8, -74.5, "2026 General Election"),
        site("two-2", "3 Pine Street, Example Two, NJ 07001", 40.81, -74.51, "2026 General Election"),
      ],
      sourceOrg: "Example County Board of Elections", sourceUrl: "https://elections.example.gov/nj/two", collectedAt: "2026-08-19", refusal: null,
    },
    {
      ocdId: "ocd-division/country:us/state:nh/place:example_three", name: "Example Three", state: "NH", model: "ASSIGNED",
      election: null, sites: [],
      sourceOrg: "Example Three Town Clerk", sourceUrl: "https://elections.example.gov/nh/three", collectedAt: "2026-08-19",
      refusal: { wall: "source unavailable", rungs: [{ rung: 2, what: "official page", result: "HTTP 503", attemptedAt: "2026-08-19" }] },
    },
  ],
};

test("B19: the retrieval is not an empty success", () => {
  const census = censusOf(file);
  assert.ok(census.sites > 0, "no voting sites at all");
  assert.ok(census.jurisdictions > 0, "no jurisdictions at all");
  assert.equal(
    census.sites,
    file.jurisdictions.reduce((n, j) => n + j.sites.length, 0),
    "the census disagrees with the rows it counts",
  );
});

test("B19: every jurisdiction with no sites carries a refusal with its rungs", () => {
  for (const j of file.jurisdictions) {
    if (j.sites.length > 0) continue;
    assert.ok(
      j.refusal,
      `${j.name} has no sites and no refusal — absence asserted`,
    );
    assert.ok(
      j.refusal.rungs.length > 0,
      `${j.name}'s refusal lists no rungs walked`,
    );
    for (const rung of j.refusal.rungs) {
      assert.match(
        rung.attemptedAt,
        /^\d{4}-\d{2}-\d{2}$/,
        `${j.name} rung ${rung.rung} has no attemptedAt date`,
      );
      assert.ok(rung.result.length > 0, "a rung with no recorded result");
    }
    const line = refusalLine(j);
    assert.match(line, /could not retrieve/i);
    assert.ok(
      !/no polling|there are none|publishes nothing/i.test(
        line.replace(/not a statement that there are none/i, ""),
      ),
      "a retrieval failure rendered as an absence claim",
    );
  }
});

test("B19: the model sentence says which model, in plain words", () => {
  const voteCenter = file.jurisdictions.find((j) => j.model === "VOTE_CENTER");
  const assigned = file.jurisdictions.find((j) => j.model === "ASSIGNED");
  assert.ok(voteCenter, "no vote-center jurisdiction");
  assert.ok(assigned, "no assigned jurisdiction");
  assert.match(modelSentence(voteCenter), /any of these locations/i);
  assert.match(modelSentence(assigned), /assigns you/i);
  for (const j of file.jurisdictions) {
    assert.ok(
      !modelSentence(j).includes("ocd-division"),
      "an OCD-ID reached a reader-facing sentence",
    );
  }
});

test("B19: a jurisdiction with no sites never points at 'these locations'", () => {
  for (const j of file.jurisdictions) {
    if (j.sites.length > 0) continue;
    assert.ok(
      !/these locations/i.test(modelSentence(j)),
      `${j.name} has no sites but its model sentence points at "these locations"`,
    );
  }
});

test("B16: a vote-center county is NOT_NEEDED, never a gap", () => {
  const voteCenter = file.jurisdictions.find((j) => j.model === "VOTE_CENTER")!;
  const n = narrowingFor(voteCenter);
  assert.equal(n.kind, "NOT_NEEDED");
  assert.ok(
    !/could not|we don't know|unable/i.test(n.sentence),
    "a different model rendered as our failure",
  );
});

test("B16: a jurisdiction with one location narrows exactly", () => {
  const single = file.jurisdictions.find(
    (j) => j.model === "ASSIGNED" && j.sites.length === 1,
  );
  assert.ok(single, "no single-location jurisdiction to check");
  const n = narrowingFor(single);
  assert.equal(n.kind, "EXACT");
  assert.equal(n.kind === "EXACT" ? n.siteId : null, single.sites[0].id);
});

test("B16: several locations and no current geometry REFUSES, with rungs", () => {
  const many = file.jurisdictions.find(
    (j) => j.model === "ASSIGNED" && j.sites.length > 1 && j.state === "NJ",
  );
  assert.ok(many, "no multi-location NJ jurisdiction to check");
  const n = narrowingFor(many);
  assert.equal(n.kind, "REFUSED");
  assert.ok(n.kind === "REFUSED" && n.rungs.length > 0, "refused with no rungs");
  assert.ok(
    !/probably|likely|closest|nearest/i.test(n.sentence),
    "a refusal that hints at an answer is a guess with a disclaimer",
  );
});

test("B19: nothing a browser imports may reach the filesystem", () => {
  for (const file of [
    join("lib", "ballot", "voting-sites.ts"),
    join("components", "map", "voting-sites-panel.tsx"),
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const server of ["node:fs", "node:path", "./voting-sites-server.ts"]) {
      assert.ok(
        !imported.includes(server),
        `${file} imports "${server}" — a browser cannot, and a client component pulls it in transitively`,
      );
    }
  }
  const panel = readFileSync(
    join(process.cwd(), "components", "map", "voting-sites-panel.tsx"),
    "utf8",
  );
  assert.ok(
    !panel.includes("@/app/api/"),
    "the panel imports a route module — that drags the server graph into the client bundle",
  );
});

test("B19: the route writes nothing — a source scan for every write primitive", () => {
  const source = readFileSync(
    join(process.cwd(), "app", "api", "voting-sites", "route.ts"),
    "utf8",
  );
  const forbidden = [
    "logEvent",
    "insert(",
    "console.log",
    "console.error",
    "cookies(",
    "headers(",
    "localStorage",
    "searchLog",
    "reactions",
  ];
  for (const primitive of forbidden) {
    assert.ok(
      !source.includes(primitive),
      `the voting-sites route contains "${primitive}" — the address must never be written anywhere`,
    );
  }
  assert.ok(source.includes("no-store"), "the response must never be cached");
  assert.ok(
    source.includes("export async function POST"),
    "a GET would put a home address in a URL",
  );
  assert.ok(
    !source.includes("export async function GET"),
    "no GET on this route",
  );
});

test("B19: the panel says what happens to the address, where the reader types it", () => {
  const panel = readFileSync(
    join(process.cwd(), "components", "map", "voting-sites-panel.tsx"),
    "utf8",
  );
  assert.match(panel, /passes through\s+our server/);
  assert.match(panel, /Census Bureau/);
  assert.ok(
    !/never (store|log)/i.test(panel),
    "the struck never-store/never-log promise is back on the voting panel",
  );
});

test("B19: directions are the only external handoff, built from the site's own address", () => {
  const site = file.jurisdictions.flatMap((j) => j.sites)[0];
  const url = directionsUrl(site);
  assert.ok(url.startsWith("https://www.google.com/maps/dir/"));
  assert.ok(
    url.includes(encodeURIComponent(site.address).slice(0, 20)),
    "the handoff must carry the published address, not a coordinate we derived",
  );
});

test("automatic refresh reuses exact held addresses but retries missing or conflicting points", () => {
  const jurisdiction = file.jurisdictions.find(row => row.sites.some(site => site.lat !== null && site.lng !== null))!;
  const site = jurisdiction.sites.find(row => row.lat !== null && row.lng !== null)!;
  const held = { generatedAt: file.generatedAt, jurisdictions: [{ ...jurisdiction, sites: [site] }] };
  assert.deepEqual(heldVotingSiteCoordinates(held).get(votingSiteAddressKey(site.address.toUpperCase())), { lat: site.lat, lng: site.lng });
  assert.equal(heldVotingSiteCoordinates({ ...held, jurisdictions: [{ ...jurisdiction, sites: [{ ...site, lat: null }] }] }).size, 0);
  assert.equal(heldVotingSiteCoordinates({ ...held, jurisdictions: [{ ...jurisdiction, sites: [site, { ...site, lat: site.lat! + 1 }] }] }).size, 0);
  assert.equal(heldVotingSiteCoordinates(held).has(votingSiteAddressKey(site.address + " different")), false);
});
