/**
 * **RULING 61 — THE BRANCH MANIFEST** (2026-08-21, NH Hunt 6 item 2).
 *
 * The manifest decides whether this product may say a Kelly field does not
 * exist for a named person, which makes it the highest-consequence list in the
 * repo after the ladder itself. Three things are guarded here, and they are
 * different from one another:
 *
 * 1. **Append-only.** The `v1` roster is written out below by hand. A route
 *    disappearing from `MANIFEST_ROUTES` fails, because a deleted route is one
 *    the next session rediscovers as new — RULING 63's duplication defect — and
 *    because deleting one silently lowers the exhaustion bar for every field it
 *    served.
 * 2. **The document and the module name the same routes.** A hand-kept second
 *    copy of a list is a copy that goes wrong.
 * 3. **The verdict is right**, including the cases it is supposed to refuse:
 *    a short walk, a stale manifest version, a branch that actually found the
 *    thing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MANIFEST_FIELDS,
  MANIFEST_INCOMPLETENESS_NOTE,
  MANIFEST_ROUTES,
  MANIFEST_VERSION,
  judgeManifestWalk,
  requiredRouteIds,
  routeCounts,
  routesFor,
  routesForTier,
  tierCounts,
  judgeTierOrder,
  nextTierOwed,
  MANIFEST_TIERS,
  type ManifestBranch,
  type ManifestField,
} from "../lib/hunt/branch-manifest.ts";
import { rendered } from "../scripts/branch-manifest-doc.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATH = join(ROOT, "docs", "branch-manifest.md");
const DOC = readFileSync(DOC_PATH, "utf8");

/**
 * **The `v1` roster, written out.** This is the append-only guard, and it is
 * deliberately a hand-kept literal rather than a snapshot the tooling can
 * regenerate: a list that rewrites itself cannot notice a deletion.
 *
 * Adding a route means adding its id here in the same commit. Removing one is
 * refused — a route that stops working grows `retiredOn` and keeps its place.
 */
const V1_ROUTES = [
  "alumni-obituary-archive",
  "announcement-archive",
  "bar-directory",
  "body-roster-page",
  "business-registry",
  "campaign-site",
  "campaign-social",
  "candidate-interview",
  "chamber-directory",
  "civic-organisation",
  "congregation-listing",
  "domain-search",
  "donation-platform",
  "employer-listing",
  "filing-campaign-finance-state",
  "filing-county",
  "filing-ethics-disclosure",
  "filing-fec",
  "filing-prior-candidacy",
  "filing-state",
  "filing-town-clerk",
  "gov-staff-directory",
  "legislative-directory",
  "licensing-board",
  "local-newspaper",
  "lwv-questionnaire",
  "minutes-naming-them",
  "nonprofit-filing",
  "party-committee-roster",
  "prior-employer-release",
  "professional-directory",
  "records-request",
  "search-index",
  "town-report",
  "voter-file-extract",
  "web-archive",
  /*
   * ── ADDED IN v2 (2026-08-22, NJ Hunt items 2.3 and 5.7) ──────────────────
   *
   * Four under RULING 66, because `campaign-social` is walled to every client
   * this project has and RULING 12 says such a wall is named rather than
   * defeated; one from New Jersey, which imposes a campaign-finance filing
   * obligation on LOCAL candidates that New Hampshire has no equivalent of.
   *
   * They join this list in the same commit that adds them to the manifest, so
   * the append-only guard above can see any of them leave later. The list is
   * named V1_ROUTES for its origin and is really "every route that has ever
   * existed" — renaming it would break nothing and explain nothing.
   */
  "filing-campaign-finance-local",
  "ad-library",
  "social-archive",
  "social-mirror",
  "news-embed",
  /* v3, NJ Hunt 4 (2026-08-22): the civic platform carrying a page per candidate. */
  "candidate-platform",
  /* v4, NJ Hunt 5 (2026-08-22): the four Tier A routes RULING 84 and RULING 87 added. */
  "wikipedia-municipality",
  "wikipedia-election",
  "press-outlet-map",
  "nces-district-directory",
  /* v5, NJ Hunt 5 (2026-08-22): the graph crawler and every held credential. */
  "wikipedia-government-graph",
  "congress-api",
  "fec-committee-contact",
  "openstates-bulk",
  "govinfo-cdir",
  "census-acs-api",
  "lda-filings",
];

const ids = MANIFEST_ROUTES.map((r) => r.id);

test("RULING 61 — the manifest is append-only: no v1 route has been deleted", () => {
  const gone = V1_ROUTES.filter((id) => !ids.includes(id));
  assert.deepEqual(
    gone,
    [],
    "these routes left the manifest. A route is NEVER removed — it grows " +
      "`retiredOn` and `retiredBecause` and keeps its id. Deleting one lowers " +
      "the exhaustion bar for every field it served, silently.",
  );
});

test("RULING 61 — every route added since v1 is recorded in this guard too", () => {
  const unrecorded = ids.filter((id) => !V1_ROUTES.includes(id));
  assert.deepEqual(
    unrecorded,
    [],
    "a route was added to lib/hunt/branch-manifest.ts without being added to " +
      "V1_ROUTES in this file. Add it in the same commit, or the append-only " +
      "guard cannot see it leave later.",
  );
});

test("RULING 61 — route ids are unique and stable-shaped", () => {
  assert.equal(new Set(ids).size, ids.length, "two routes share an id");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${id} is not a stable kebab-case id`);
  }
});

test("RULING 61 — every route names what it is, how, what it yields, its rung and its dependency", () => {
  for (const r of MANIFEST_ROUTES) {
    for (const key of ["what", "how", "yields", "rung", "through", "expectedToTravel"] as const) {
      assert.ok(
        typeof r[key] === "string" && r[key].trim().length > 0,
        `${r.id} has no ${key} — a route a later session cannot re-walk is not a route`,
      );
    }
    assert.ok(r.fields.length > 0, `${r.id} produces no field`);
    for (const f of r.fields) {
      assert.ok(MANIFEST_FIELDS.includes(f), `${r.id} names a field that does not exist: ${f}`);
    }
  }
});

test("RULING 61 — a retired route keeps its id, carries a date and a reason, and stops counting", () => {
  for (const r of MANIFEST_ROUTES) {
    if (r.retiredOn === undefined) {
      assert.equal(
        r.retiredBecause,
        undefined,
        `${r.id} says why it retired but not when — an undated retirement is not a record`,
      );
      continue;
    }
    assert.match(r.retiredOn, /^\d{4}-\d{2}-\d{2}$/, `${r.id} has an unstamped retirement date`);
    assert.ok(
      typeof r.retiredBecause === "string" && r.retiredBecause.trim() !== "",
      `${r.id} retired without saying why`,
    );
    for (const f of MANIFEST_FIELDS) {
      assert.ok(
        !requiredRouteIds(f).includes(r.id),
        `${r.id} is retired but still counts toward ${f}'s bar`,
      );
    }
  }
});

/* ========================================================================== */
/* The photo doors reach into the manifest, and they may not be widened here   */
/* ========================================================================== */

test("RULING 61 — no press, social or employer route may supply a photo", () => {
  // The four doors govern the SOURCE BASIS. A door the campaign-site rule opens
  // is not a door into the photo rule, and a working photographer's copyright
  // is not narrowed by where the image was reposted.
  const mustNotSupplyPhoto = [
    "local-newspaper",
    "candidate-interview",
    "announcement-archive",
    "campaign-social",
    "employer-listing",
    "professional-directory",
    "lwv-questionnaire",
    "prior-employer-release",
  ];
  const photoRoutes = requiredRouteIds("photo");
  for (const id of mustNotSupplyPhoto) {
    assert.ok(
      !photoRoutes.includes(id),
      `${id} is listed as a photo route. Press, wire, photographer-credited and ` +
        "social-media images are prohibited at EVERY door.",
    );
  }
});

/* ========================================================================== */
/* The document and the module say the same thing                             */
/* ========================================================================== */

test("RULING 61 — docs/branch-manifest.md is current with the module", () => {
  assert.equal(
    rendered(),
    DOC,
    "docs/branch-manifest.md is behind lib/hunt/branch-manifest.ts. " +
      "Run: corepack pnpm manifest:doc",
  );
});

test("RULING 61 — every route id appears in the document", () => {
  const absent = ids.filter((id) => !DOC.includes(`\`${id}\``));
  assert.deepEqual(absent, [], "routes the module names and the document does not");
});

test("RULING 61 — the document states plainly that the manifest is incomplete", () => {
  assert.ok(
    DOC.includes(MANIFEST_INCOMPLETENESS_NOTE),
    "the standing incompleteness note is missing from the document",
  );
  assert.match(
    DOC,
    /THIS MANIFEST IS INCOMPLETE, AND ALWAYS WILL BE/,
    "being at the end of the manifest is not proof of absence, and the document " +
      "has to say so where a reader lands first",
  );
});

test("RULING 63 — the document is indexed by question, not read front to back", () => {
  assert.match(DOC, /## Index by question/);
  const index = DOC.slice(DOC.indexOf("## Index by question"), DOC.indexOf("## What exhaustion"));
  const questions = index.split("\n").filter((l) => l.startsWith("| ") && l.includes("?"));
  assert.ok(
    questions.length >= 8,
    `the question index carries ${questions.length} questions; a session in ` +
      "another state has to be able to find a route by asking for it",
  );
  // The questions RULING 63 names by name.
  for (const q of [/town clerk record/i, /candidate's phone/i, /enumerate a town's boards/i]) {
    assert.match(index, q, `the question index is missing: ${q}`);
  }
});

/* ========================================================================== */
/* The verdict                                                                 */
/* ========================================================================== */

function branch(route: string, over: Partial<ManifestBranch> = {}): ManifestBranch {
  const r = MANIFEST_ROUTES.find((x) => x.id === route);
  return {
    branch: `walked ${route}`,
    attemptedAt: "2026-08-21",
    result: "nothing",
    found: false,
    route,
    through: r?.through,
    ...over,
  };
}

function fullWalk(field: ManifestField, over: Partial<ManifestBranch> = {}): ManifestBranch[] {
  return requiredRouteIds(field).map((id) => branch(id, over));
}

test("RULING 61 — a full walk of every named route is exhaustion", () => {
  const v = judgeManifestWalk({
    field: "photo",
    branches: fullWalk("photo"),
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.exhausted, true, v.reason);
  assert.deepEqual(v.missing, []);
});

test("RULING 61 — two independent branches is NOT exhaustion any more", () => {
  // This is the whole of what RULING 61 changed. RULING 58's bar passes here
  // and this one does not.
  const walked = requiredRouteIds("photo").slice(0, 2);
  const v = judgeManifestWalk({
    field: "photo",
    branches: walked.map((id) => branch(id)),
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.ok(v.independent >= 2, "the fixture must clear the old two-branch bar");
  assert.equal(v.exhausted, false);
  assert.ok(v.missing.length > 0, "and the verdict must hand back a work list");
  assert.match(v.reason, /not yet walked/);
});

test("RULING 61 — the verdict names the routes still owed, as a work list", () => {
  const all = requiredRouteIds("campaignSite");
  const skipped = ["web-archive", "records-request"].filter((id) => all.includes(id));
  const v = judgeManifestWalk({
    field: "campaignSite",
    branches: all.filter((id) => !skipped.includes(id)).map((id) => branch(id)),
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.exhausted, false);
  assert.deepEqual(v.missing, skipped.slice().sort());
});

test("RULING 61 — a branch that FOUND the thing forecloses the absence claim", () => {
  const branches = fullWalk("photo");
  branches[0] = { ...branches[0], found: true, result: "a door-2 portrait" };
  const v = judgeManifestWalk({
    field: "photo",
    branches,
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.found, true);
  assert.equal(v.exhausted, false);
  assert.match(v.reason, /found the thing/);
});

test("RULING 61 — a walk judged against an older manifest is re-openable, not exhausted", () => {
  // The retroactive half of the ruling: a new route reopens everything already
  // marked absent. Nothing has to remember to do that — the version does it.
  const v = judgeManifestWalk({
    field: "photo",
    branches: fullWalk("photo"),
    checkedAt: "2026-08-21",
    manifestVersion: "v0",
  });
  assert.equal(v.staleManifest, true);
  assert.equal(v.exhausted, false);
  assert.match(v.reason, /re-openable/);
});

test("RULING 61 — a route walked that the manifest does not name is surfaced, never counted", () => {
  const v = judgeManifestWalk({
    field: "photo",
    branches: [...fullWalk("photo"), branch("photo", { route: "a-route-nobody-named" })],
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.deepEqual(v.unnamed, ["a-route-nobody-named"], "it is a candidate for the next version");
  assert.equal(v.exhausted, true, "and it neither helps nor hurts the verdict");
});

test("RULING 61 — an empty walk is never exhaustion", () => {
  const v = judgeManifestWalk({
    field: "photo",
    branches: [],
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.exhausted, false);
});

test("RULING 61 — a malformed branch cannot pad a walk", () => {
  const branches = fullWalk("photo").map((b, i) =>
    i === 0 ? ({ ...b, attemptedAt: "yesterday" } as ManifestBranch) : b,
  );
  const v = judgeManifestWalk({
    field: "photo",
    branches,
    checkedAt: "2026-08-21",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.exhausted, false, "a branch with a plausible date instead of a stamped one");
  assert.ok(v.missing.includes(requiredRouteIds("photo")[0]));
});

test("RULING 61 — the reported counts are read from the module, never transcribed", () => {
  const counts = routeCounts();
  for (const f of MANIFEST_FIELDS) {
    assert.equal(counts[f], routesFor(f).length);
    assert.ok(counts[f] > 0, `${f} has no routes at all, which cannot be right`);
  }
  // And the document's table is the same numbers.
  assert.match(DOC, new RegExp(`\\| Photo \\| ${counts.photo} \\|`));
  assert.match(DOC, new RegExp(`\\| Contact \\| ${counts.contact} \\|`));
});

/* ── RULING 84 — the manifest is tiered, and walked in order ─────────────── */

test("RULING 84 — every live route carries a tier, and it is one of the three", () => {
  const untiered = MANIFEST_ROUTES.filter(
    (r) => !MANIFEST_TIERS.includes(r.tier as (typeof MANIFEST_TIERS)[number]),
  ).map((r) => r.id);
  assert.deepEqual(
    untiered,
    [],
    "a route was added without a tier, or with one that is not A, B or C. " +
      "RULING 84: a route with no tier silently re-flattens the list, which is " +
      "the exact shape that let 124 candidates be searched one at a time while " +
      "a templated encyclopedia page listed nine council members outright.",
  );
});

test("RULING 84 — the tier counts are read from the module, never transcribed", () => {
  const { overall, byField } = tierCounts();
  const live = MANIFEST_ROUTES.filter((r) => r.retiredOn === undefined);
  assert.equal(
    overall.A + overall.B + overall.C,
    live.length,
    "every live route lands in exactly one tier",
  );
  for (const f of MANIFEST_FIELDS) {
    const summed = byField[f].A + byField[f].B + byField[f].C;
    assert.equal(summed, routesFor(f).length, `${f}'s tiers must sum to its route count`);
    for (const t of MANIFEST_TIERS) {
      assert.equal(byField[f][t], routesForTier(f, t).length);
    }
  }
});

test("RULING 84 — every field has at least one Tier A route to walk first", () => {
  for (const f of MANIFEST_FIELDS) {
    assert.ok(
      routesForTier(f, "A").length > 0,
      `${f} has no Tier A route at all. That is not automatically wrong — not ` +
        `every field has a broad source — but it means the first thing a hunt ` +
        `does for this field is spend a per-entity query, and RULING 85 says ` +
        `check the obvious route before accepting that.`,
    );
  }
});

test("RULING 84 — nextTierOwed returns A until every Tier A route is walked", () => {
  const field: ManifestField = "contact";
  assert.equal(nextTierOwed(field, []), "A", "nothing walked, so tier A is owed");

  const tierA = routesForTier(field, "A").map((r) => r.id);
  assert.equal(
    nextTierOwed(field, tierA.slice(0, -1)),
    "A",
    "one Tier A route still unwalked is still tier A owed — not 'close enough'",
  );
  assert.equal(nextTierOwed(field, tierA), "B", "tier A complete, so tier B is next");

  const all = routesFor(field).map((r) => r.id);
  assert.equal(nextTierOwed(field, all), null, "every tier walked, nothing left to permit");
});

test("RULING 84 — a Tier C walk with Tier A unwalked is OUT OF ORDER, and says which routes were skipped", () => {
  const field: ManifestField = "campaignSite";
  const c = routesForTier(field, "C")[0];
  assert.ok(c, "campaignSite must have a Tier C route for this guard to mean anything");

  const v = judgeTierOrder(field, [c.id]);
  assert.equal(v.inOrder, false, "reaching per-entity search first is the defect RULING 84 names");
  assert.equal(v.reached, "C");
  const skippedA = v.skipped.find((s) => s.tier === "A");
  assert.ok(skippedA, "the verdict must name the Tier A routes that were skipped");
  assert.deepEqual(
    skippedA.routes,
    routesForTier(field, "A")
      .map((r) => r.id)
      .sort(),
    "the skipped list is the work list — every unwalked cheaper route, named",
  );
  assert.match(v.reason, /cheaper route/);
});

test("RULING 84 — a walk taken in tier order is in order, and an empty walk is not a violation", () => {
  const field: ManifestField = "campaignSite";
  assert.equal(judgeTierOrder(field, []).inOrder, true, "nothing walked is not out of order");
  assert.equal(judgeTierOrder(field, []).reached, null);

  const inOrder = [
    ...routesForTier(field, "A").map((r) => r.id),
    ...routesForTier(field, "B").map((r) => r.id),
    routesForTier(field, "C")[0].id,
  ];
  const v = judgeTierOrder(field, inOrder);
  assert.equal(v.inOrder, true, v.reason);
  assert.equal(v.reached, "C");
  assert.deepEqual(v.skipped, []);
});

test("RULING 84 — the verdict carries the tier order and the next tier owed", () => {
  const v = judgeManifestWalk({
    field: "photo",
    branches: [],
    checkedAt: "2026-08-22",
    manifestVersion: MANIFEST_VERSION,
  });
  assert.equal(v.nextTier, "A", "a walk that has done nothing owes tier A first");
  assert.equal(v.tierOrder.inOrder, true);
  assert.match(v.reason, /tier A is owed next/);
});

test("RULING 87 — the Wikipedia routes are Tier A, and may never supply a photo or a blurb", () => {
  for (const id of ["wikipedia-municipality", "wikipedia-election"]) {
    const r = MANIFEST_ROUTES.find((x) => x.id === id);
    assert.ok(r, `${id} must be in the manifest — it is the route six sessions never walked`);
    assert.equal(r.tier, "A", `${id} is Tier A by definition: one read, many entities`);
    assert.ok(
      (r.forbiddenFor ?? []).includes("photo"),
      `${id} may not supply a photo — RULING 87 makes it a DISCOVERY source, and ` +
        `the photo doors do not open onto an encyclopedia`,
    );
    assert.ok(
      (r.forbiddenFor ?? []).includes("blurb"),
      `${id} may not supply a blurb — a description of a real person needs its ` +
        `own source class, and 'an encyclopedia said so' is not one`,
    );
  }
});
