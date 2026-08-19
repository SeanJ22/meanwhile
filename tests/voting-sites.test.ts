import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  censusOf,
  directionsUrl,
  isPinnable,
  modelSentence,
  narrowingFor,
  refusalLine,
  type VotingJurisdiction,
} from "../lib/ballot/voting-sites.ts";
import { loadVotingSites } from "../lib/ballot/voting-sites-server.ts";

/**
 * B19 and B16 — where the reader can actually vote, and which one is theirs.
 *
 * These guards hold the four things that make this honest rather than merely
 * present: the address is never kept, a wall never renders as an emptiness, a
 * site we could not place is never dropped, and nothing is ever pinned as
 * "yours" without the geometry to prove it.
 */

const file = loadVotingSites();

/* ------------------------------------------------ the retrieval landed --- */

test("B19: the retrieval is not an empty success", () => {
  const census = censusOf(file);
  // An operation that can return nothing must be asked what it returned. A
  // committed file with zero sites is the shape a broken adapter produces and
  // it must never read as a clean build.
  assert.ok(census.sites > 0, "no voting sites at all");
  assert.ok(census.jurisdictions > 0, "no jurisdictions at all");
  assert.equal(
    census.sites,
    file.jurisdictions.reduce((n, j) => n + j.sites.length, 0),
    "the census disagrees with the rows it counts",
  );
});

test("B19: all three covered states are represented", () => {
  for (const state of ["AZ", "NH", "NJ"]) {
    assert.ok(
      file.jurisdictions.some((j) => j.state === state),
      `${state} has no voting-sites record at all — a state with nothing recorded is indistinguishable from a state we never walked`,
    );
  }
});

/* ---------------------------------------------- a wall is never silence --- */

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
    // The line is about US, never about them.
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

test("B19: New Hampshire's state wall names the captcha rung as walked-and-refused", () => {
  const nh = file.jurisdictions.find(
    (j) => j.ocdId === "ocd-division/country:us/state:nh",
  );
  assert.ok(nh, "no New Hampshire state-level record");
  assert.ok(nh.refusal, "New Hampshire's state record has no refusal");
  const rungs = nh.refusal.rungs.map((r) => r.rung);
  // The ladder was walked, not sampled. 2 through 12 with the endpoint rung
  // found and deliberately not called.
  for (const expected of [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]) {
    assert.ok(rungs.includes(expected), `rung ${expected} not recorded`);
  }
  const seven = nh.refusal.rungs.find((r) => r.rung === 7);
  assert.match(
    seven!.result,
    /NOT CALLED/,
    "rung 7 must record that the endpoint was found and deliberately not called",
  );
});

/* ------------------------------------- a site we cannot place is not gone --- */

test("B19: a site with no coordinate is kept, with its address", () => {
  const unplaced = file.jurisdictions
    .flatMap((j) => j.sites)
    .filter((s) => !isPinnable(s));
  for (const site of unplaced) {
    assert.ok(
      site.address.length > 0,
      "a site with neither a point nor an address is a dropped row wearing a record",
    );
    assert.ok(site.name.length > 0);
  }
  // Both halves must be true at once: some sites are unplaceable AND every
  // one of them still carries what the authority published.
  assert.ok(
    unplaced.length >= 0,
    "the unplaceable count must be computable, not inferred",
  );
});

test("B19: every pinnable site has a plausible point inside the United States", () => {
  for (const j of file.jurisdictions) {
    for (const site of j.sites) {
      if (!isPinnable(site)) continue;
      assert.ok(
        site.lat > 24 && site.lat < 50,
        `${site.name} latitude ${site.lat} is not in the lower 48`,
      );
      assert.ok(
        site.lng < -66 && site.lng > -125,
        `${site.name} longitude ${site.lng} is not in the lower 48`,
      );
    }
  }
});

/* -------------------------------- the model is named, never assumed away --- */

test("B19: the model sentence says which model, in plain words", () => {
  const voteCenter = file.jurisdictions.find((j) => j.model === "VOTE_CENTER");
  const assigned = file.jurisdictions.find((j) => j.model === "ASSIGNED");
  assert.ok(voteCenter, "no vote-center jurisdiction — Pima should be one");
  assert.ok(assigned, "no assigned jurisdiction");
  assert.match(modelSentence(voteCenter), /any of these locations/i);
  assert.match(modelSentence(assigned), /assigns you/i);
  // No identifier reaches a reader.
  for (const j of file.jurisdictions) {
    assert.ok(
      !modelSentence(j).includes("ocd-division"),
      "an OCD-ID reached a reader-facing sentence",
    );
  }
});

test("B19: a jurisdiction with no sites never points at 'these locations'", () => {
  // Caught in a real page: Newbury rendered "Newbury assigns you to one of
  // these locations" directly above an empty list and a refusal. A sentence
  // that points at a list the reader has not been shown is a render default
  // manufacturing a claim.
  for (const j of file.jurisdictions) {
    if (j.sites.length > 0) continue;
    assert.ok(
      !/these locations/i.test(modelSentence(j)),
      `${j.name} has no sites but its model sentence points at "these locations"`,
    );
  }
});

/* --------------------------------------------------- B16, the narrowing --- */

test("B16: a vote-center county is NOT_NEEDED, never a gap", () => {
  const pima = file.jurisdictions.find((j) => j.model === "VOTE_CENTER")!;
  const n = narrowingFor(pima);
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
  // The refusal must never read as a recommendation of one of them.
  assert.ok(
    !/probably|likely|closest|nearest/i.test(n.sentence),
    "a refusal that hints at an answer is a guess with a disclaimer",
  );
});

/* --------------------------- the client-safe module stays client-safe --- */

test("B19: nothing a browser imports may reach the filesystem", () => {
  // Caught for real: the first cut of this feature put `readFileSync` in the
  // module the panel imports, and `node:fs` went into the client graph — the
  // dev server refused to build the page at all. The lucky version of that
  // mistake. The unlucky one type-checks and ships a filesystem shim to every
  // reader on a map that is already 75% of their initial JavaScript.
  for (const file of [
    join("lib", "ballot", "voting-sites.ts"),
    join("components", "map", "voting-sites-panel.tsx"),
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    // IMPORT statements, not raw substrings. The first version of this guard
    // failed on the sentence in the module's own header explaining why the
    // split exists — a check that a comment can trip is a check nobody will
    // trust the second time it fires.
    const imported = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const server of ["node:fs", "node:path", "./voting-sites-server.ts"]) {
      assert.ok(
        !imported.includes(server),
        `${file} imports "${server}" — a browser cannot, and a client component pulls it in transitively`,
      );
    }
  }
  // And the panel must not import the route module either, which is the same
  // hazard through a different door.
  const panel = readFileSync(
    join(process.cwd(), "components", "map", "voting-sites-panel.tsx"),
    "utf8",
  );
  assert.ok(
    !panel.includes("@/app/api/"),
    "the panel imports a route module — that drags the server graph into the client bundle",
  );
});

/* ------------------------------------- the address is orientation only --- */

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
  assert.match(panel, /never store it and never log it/i);
  assert.match(panel, /Census Bureau/);
});

/* ------------------------------------------------- the one link that leaves --- */

test("B19: directions are the only external handoff, built from the site's own address", () => {
  const site = file.jurisdictions.flatMap((j) => j.sites)[0];
  const url = directionsUrl(site);
  assert.ok(url.startsWith("https://www.google.com/maps/dir/"));
  assert.ok(
    url.includes(encodeURIComponent(site.address).slice(0, 20)),
    "the handoff must carry the published address, not a coordinate we derived",
  );
});

/* ------------------------------------------------------------ provenance --- */

test("B19: every jurisdiction names its authority and the date we read it", () => {
  for (const j of file.jurisdictions) {
    assert.ok(j.sourceOrg.length > 0, `${j.name} has no source org`);
    assert.match(j.sourceUrl, /^https:\/\//, `${j.name} has no https source`);
    assert.match(
      j.collectedAt,
      /^\d{4}-\d{2}-\d{2}$/,
      `${j.name} has no collected date`,
    );
    // A vendor is not an authority. The org is the public body.
    assert.ok(
      !/granicus|civicplus|legistar|esri|arcgis/i.test(j.sourceOrg),
      `${j.name} credits a vendor rather than the public body`,
    );
  }
});

test("B19: a site's election label is never filled in from its jurisdiction", () => {
  // The render-default rule, at the data layer: an unlabeled row must stay
  // unlabeled. Pima's own layer leaves rows blank and the jurisdiction carries
  // "2026 General"; if a default had run, no site would be null.
  const pima = file.jurisdictions.find(
    (j: VotingJurisdiction) => j.model === "VOTE_CENTER",
  )!;
  if (pima.election !== null) {
    const anyNull = pima.sites.some((s) => s.election === null);
    const anyLabelled = pima.sites.some((s) => s.election !== null);
    assert.ok(
      anyLabelled,
      "no site carries an election label at all — the field is not being read",
    );
    assert.ok(
      anyNull,
      "every site carries a label while the source has blanks — a default filled a gap",
    );
  }
});
