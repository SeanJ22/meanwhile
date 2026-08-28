/**
 * `pnpm method:learn-ask-entity` — PUT THE ask-entity SESSION'S ROUTE INTO
 * PROJECT MEMORY. (2026-08-27. **RULING 178**, **RULING 182**, **RULING 184**.)
 *
 * One route, and its headline result is a WALL rather than a fact. That is
 * worth recording precisely because a wall costs a session every time it is
 * rediscovered: the next session to ask which nonpartisan or special-district
 * contests are on a general ballot will reach for the same document, try the
 * same three clients, and spend the same hour learning that none of them works.
 *
 * **A blocked route is not a blocked fact** (RULING 184), and a 403 on a host's
 * `robots.txt` is not a disallow (RULING 182). Both distinctions are carried in
 * the note rather than left to a later reader to re-derive.
 *
 * Idempotent: `learnRoute` refuses a duplicate id and says so, so re-running
 * cannot inflate the method version or deepen the route's evidence.
 *
 * ## Why this is a `learn` script and not an edit to the branch manifest
 *
 * `pnpm method:ingest` reads `lib/hunt/branch-manifest.ts` and REBUILDS the
 * store from it. Run today it takes the store from 88 routes at method version
 * 27 down to 62 routes at version 0 — it is a one-time bootstrap, not an
 * incremental add, and it reports success while doing it. Adding a route here
 * is additive and leaves every learned route and every recorded outcome alone.
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "sos-general-election-candidate-listing",
    title:
      "the state election authority's own candidate listing for a GENERAL election — the record that answers which NONPARTISAN and special-district contests are actually on a ballot",
    tier: "A1",
    fields: ["contest", "candidacy", "incumbency"],
    note:
      "The SHAPE is general: a partisan primary filing cannot show a nonpartisan district office, and a PRIMARY candidate list cannot either, because a district office with no primary is not on a primary ballot. So the general-election listing is the right document and it is a different document from both. THE ARIZONA HOST IS WALLED: on 2026-08-27 apps.arizona.vote answered HTTP 403 to curl, to a bare node fetch carrying a browser user agent, and to a real Playwright browser at rung 6 alike — Cloudflare bot protection, not a rule. Its own robots.txt is 403 too, so permission is CANNOT_TELL and is NOT a disallow (RULING 182). Bypassing bot detection is prohibited, so this is BLOCKED_CURRENTLY rather than exhausted (RULING 184). Do not re-walk it with a fourth HTTP client and expect a different answer: vary the SOURCE, not the client. The untried branches are the COUNTY election authority's own general-election candidate list or sample ballot, the printed sample ballot when published, and a public-records request.",
    origin:
      "conceived 2026-08-27 for NH244. The Central Arizona Water Conservation District's four Pima seats carry terms expiring 2026-12-31, read off the district's own member pages, and the ballot corpus holds no CAWCD contest. Two documents were read in full and neither settles whether the contest is on the November 3 2026 general ballot — the Secretary of State's 2026 partisan filing (no CAWCD contest, which is expected for a nonpartisan office and proves nothing) and Pima County's Official Candidate List for the July 21 primary (no CAWCD contest either, though it does carry nonpartisan municipal offices). Neither a contest nor an absence may be written into the ballot corpus until a deciding document is read.",
    outcome: {
      jurisdiction: "az",
      walkedOn: "2026-08-27",
      rows: 0,
      outcome: "BLOCKED",
      note:
        "apps.arizona.vote/electioninfo/Election/69 — HTTP 403 at rungs 2, 3 and 6. robots.txt also 403, so permission is CANNOT_TELL. The fact remains owed and is tracked as NH244.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
