/**
 * `pnpm method:learn-statute` — THE STATUTE IS A DISCOVERY ROUTE, AND IT IS THE
 * ONE THIS PROJECT KEPT WALKING PAST. (2026-08-27. **RULING 178**.)
 *
 * M62's own rule already said where to look first: *"a local office is partisan
 * or nonpartisan BY LAW OR CHARTER FIRST, and only a partisan office gets a
 * party, read from the certified result."* Twelve rosters were then settled
 * from certified canvasses — from what an election authority PRINTED — because
 * that is the record the project had learned how to reach.
 *
 * CAWCD could not be settled that way. Its contest is in no partisan primary
 * filing, in no county primary candidate list, and the one certified county
 * canvass read in full contains it nowhere. Four documents, none decisive, and
 * the deciding portal behind bot protection.
 *
 * The statute answered it in two requests. **A.R.S. § 48-3709(B)** requires the
 * names on "the general election ballot of the county in which the candidate
 * resides, WITHOUT PARTY DESIGNATION" — which settles partisanship by LAW
 * rather than by what a canvass happened to print, and settles it more strongly.
 * **§ 48-3708(A)** sizes each county's delegation by population and reproduces
 * the 10/4/1 split read independently off fifteen member pages.
 *
 * Idempotent: `learnRoute` refuses a duplicate id and says so.
 *
 * NOT `method:ingest` — that rebuilds the store from the legacy manifest and
 * takes it from 88 routes at version 27 down to 62 at version 0 while reporting
 * success (NH254).
 */

import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "state-statute-for-office-character",
    title:
      "the STATUTE that creates an office — for whether it is partisan, how its seats are apportioned, what its term is, and which ballot it appears on",
    tier: "A0",
    fields: ["partisanship", "body", "contest", "incumbency"],
    note:
      "The SHAPE is as portable as anything this project holds: every elected office in the United States is created by a statute or a charter, and that instrument — not a canvass — is what says whether the office carries a party. It is also cheap, stable and citable: a canvass answers for ONE election and has to be re-read every cycle, while the statute answers for the office until the legislature changes it. Proved on A.R.S. 48-3708 and 48-3709 for the Central Arizona Water Conservation District, where four election-authority documents had failed to settle the same question. The limits are real and worth stating: a statute says what MUST happen and never what DID, so it can establish partisanship, apportionment and term but can never establish that a particular contest appeared on a particular ballot or who filed for it.",
    origin:
      "conceived 2026-08-27 after four documents failed. The AZ SOS 2026 partisan filing, the Pima 2026 primary candidate list, the Pima 2020 general official canvass read in full at 1,852 pages, and the Pima 2020 general sample ballot all contain no CAWCD contest, and the deciding SOS portal is behind bot protection at three client classes. M62's own rule had said to read the law FIRST and the project had been reading canvasses instead, because canvass-reading was the skill it had built.",
    effort: {
      /* The statute is written once per STATE and then answers for every office
         that state creates — the cheapest class of knowledge this project buys. */
      repeats: "PER_STATE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "Two plain fetches of azleg.gov/ars/ answered what four election-authority documents could not. The expensive part was realising the law was the instrument, not reading it.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note:
        "A.R.S. 48-3709(B) — candidates appear on the county general election ballot 'without party designation', which settled CAWCD as NONPARTISAN from law. A.R.S. 48-3708(A) — delegation size by county population, reproducing the Maricopa 10 / Pima 4 / Pinal 1 split read independently off fifteen member pages, and 48-3708(D) confirming that a vacancy is filled by gubernatorial appointment, which is how Justin Manuel holds a Pima seat. azleg.gov permits /ars/ and asks for a 120-second crawl delay.",
    },
  },
  {
    id: "cancelled-uncontested-district-election",
    title:
      "an expiring term is a POSITION TO BE FILLED and never a ballot contest — check the county board's cancellation resolution before recording either a contest or an absence",
    tier: "A0",
    fields: ["contest", "candidacy", "incumbency"],
    note:
      "A.R.S. 16-410 lets a county board of supervisors cancel any Title 15 or Title 48 district election where the people who filed are fewer than or equal to the positions, appoint them 'fully vested ... as if elected', and forbids the cancelled election from appearing on ANY ballot. So a seat can turn over on schedule while its contest exists in no ballot, no sample ballot and no canvass. THE SHAPE TRAVELS EVEN WHERE THE SECTION NUMBER DOES NOT: uncontested-election cancellation is common across states for school and special districts, and it is the standing explanation for the puzzle 'a term expires this year and we can find no contest'. Do not read that silence as our own retrieval failing, and do not read it as the government failing to hold an election. Read the county's own cancellation resolution. THE COROLLARY THAT BITES: an ABSENCE may not be recorded either, because a true absence now requires knowing an election was cancelled rather than merely not finding one.",
    origin:
      "conceived 2026-08-27 to reconcile what looked like two authoritative sources contradicting each other. CAWCD's own member pages say three Pima directors were elected or re-elected on 2020-11-03; Pima County's certified canvass of that election, which certifies itself complete for all valid ballots cast, contains no CAWCD contest across 1,852 pages under seven name variants and none of their surnames. 16-410 explains both at once. The ballot corpus already held three unnamed instances of the same mechanism for 2026 — Vail Unified cancelled and appointed, Empire Elementary cancelled with three vacancies recorded, Sahuarita not cancelled because contested — all citing Pima Board of Supervisors matter 21690.",
    effort: {
      /* The 16-410 SHAPE is national; the section number and the cancelling
         authority are per-state, and the resolution itself is per-county. */
      repeats: "PER_COUNTY",
      execution: "MACHINE_AFTER_HUMAN_SETUP",
      discovery: "NEW_METHOD",
      readerIntegrityRepair: true,
      note:
        "Reading a county cancellation resolution is machine work once the county publishes one somewhere reachable — Pima does, through the Legistar Web API. Maricopa does not: its archive is JavaScript off a robots-Disallowed /api/, so that county needs a records request first. Flagged as integrity repair because it disproved a standing claim rather than adding a fact.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 3,
      outcome: "YIELDED",
      note:
        "Reconciled the CAWCD 2020 disagreement and DISPROVED the standing inference on NH244 that four expiring Pima seats are therefore four 2026 ballot contests. Pima matter 21690 covers Title 15 school districts only; a Legistar Web API sweep of Pima's whole record for 'Water Conservation' and 'Central Arizona' returns no 2026 CAWCD election or cancellation, so the multi-county question moves to Maricopa and Pinal.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
