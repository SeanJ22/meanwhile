/**
 * `pnpm method:learn-legistar-insite` — **THE CORRECTION.** (2026-08-28.)
 *
 * ## What is being superseded, and what survives
 *
 * On 2026-08-28 `scripts/learn-schedule-vs-events.mts` taught this project two
 * routes off one investigation, and recorded a conclusion inside them that is
 * false:
 *
 * > the September sittings … **are published on the county's own site as a
 * > RULE** — 'Meetings Beginning at 5 p.m. 2nd and 4th Tuesdays of the month'
 *
 * > webapi.legistar.com/v1/pima/events over 2026-08-01 to 2026-11-01 returned 7
 * > events … **confirming the snapshot's 16-fetched-16-normalized as complete
 * > for the window** rather than truncated.
 *
 * **The measurements were right and reproduce exactly.** `/events` really does
 * return zero September rows over that window, and the denominators really do
 * reconcile. The word that is wrong is **complete**: reconciling proves nothing
 * was DROPPED. It never proves enough was ASKED FOR. (RULING 100 says this in
 * as many words, and it was quoted in the very route that then went on to call
 * a single route's answer complete.)
 *
 * And the sittings are not only a rule. Pima publishes all three individually
 * on its own portal, with a date, a room and a meeting kind — including a **1:00
 * PM study session on 8 September** which the committed rule text could not have
 * produced, because that text gives study sessions no time at all.
 *
 * ## Nothing is edited in place
 *
 * `data/method/knowledge.json` is append-only by design and the audit trail is
 * the point: the two original routes keep their text, their origin and their
 * outcomes exactly as recorded. What this run adds is
 *
 * - three NEW routes carrying the corrected, portable lesson, and
 * - a dated **sub-branch** on each superseded route naming what replaced it —
 *   the schema's own supersession record ("a branch that stops working is
 *   evidence the tree needs another limb, never evidence the fact is
 *   unobtainable … it is never DELETED").
 *
 * A later session reading the store sees both the conclusion and its
 * correction, in order, with dates. That is what makes the correction
 * checkable rather than merely newer.
 *
 * ## The corrected lesson, in one sentence
 *
 * **A vendor's public API and its public web UI are DIFFERENT RECORDS WITH
 * DIFFERENT PUBLICATION CLOCKS.** When the API's forward horizon runs dry, walk
 * the vendor's OWN UI calendar filter before concluding anything about the body
 * OR about the vendor.
 *
 * ## The clocks, measured
 *
 * | route | what it knew, and when |
 * | --- | --- |
 * | InSite calendar RSS | the 22 September sitting, `pubDate` **2026-06-15** — 74 days ahead |
 * | `webapi /events` | lead time over **32 Pima 2026 events**: max **5** days, median **0**, min **-2** |
 *
 * The Legistar adapter's forward window is 60 days. It has been asking that
 * route for roughly ten times more than it can ever return, and no amount of
 * asking it harder changes that.
 *
 * Idempotent: `learnRoute` refuses a duplicate id and the sub-branch append
 * below refuses a duplicate `(jurisdiction, failedOn, replacedBy)`, so a re-run
 * cannot inflate the method version or deepen the record.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { learnBatch, type LearnedRoute } from "../lib/method/learn-batch.ts";
import type { MethodKnowledge, SubBranch } from "../lib/method/knowledge.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "vendor-api-and-vendor-web-ui-are-different-records",
    title:
      "a vendor's public API and its own public web UI publish the same meetings on different clocks — ask the UI before concluding",
    tier: "A0",
    fields: ["meeting", "agenda"],
    note:
      "THE CLASS, AND IT IS THE VENDOR'S BEHAVIOUR RATHER THAN ANY ONE TENANT'S CONFIGURATION. webapi.legistar.com/v1/{client}/events returns ONLY the sittings whose InSite meeting-detail page is publicly viewable. It is not an agenda-status filter and it is not missing data: the omitted events have no WebAPI record at all (40 of 40 probed ids 404 on the item endpoint), and the two routes number their meetings in DISJOINT ID SPACES — EventInSiteURL points at MeetingDetail.aspx?LEGID=<apiEventId> while the portal grid's own links carry ID=1381575. MEASURED 2026-08-28 ON ONE 'Next Month' FILTER, THREE TENANTS: Mesa 15 grid rows, 12 carrying class=\"meeting_NotViewable\", and /events returned EXACTLY the other 3 (3 of 3 matched, 12 of 12 missed); Phoenix 8 rows, 8 not viewable, 0 returned; Pima 3 rows, 3 not viewable, 0 returned. THE CLOCKS, MEASURED THE SAME DAY: the InSite calendar RSS carries pubDate, and Pima's 22 September sitting was published 2026-06-15 — 74 days of notice — while the WebAPI's lead time across 32 Pima 2026 events (EventDate against EventAgendaLastPublishedUTC/EventLastModifiedUtc) is max 5 days, median 0, min -2. An adapter with a 60-day forward window is therefore asking that route for about ten times more than it can ever return. THE DIAGNOSTIC: when a vendor API's forward horizon runs dry, drive the vendor's OWN UI calendar filter before concluding anything about the body OR about the vendor — and expect the UI to hold rows the API cannot see, not merely the same rows sooner.",
    origin:
      "found 2026-08-28 re-walking a conclusion recorded the same day. The prior session measured /events correctly, reconciled the adapter's denominators correctly, and inferred from the pair that Pima's September sittings existed only as a recurring rule. Driving the tenant's own Calendar.aspx date-range postback returned all three as individually published records, and running the same filter against two tenants nobody had named turned the finding from an instance into a class.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      readerIntegrityRepair: true,
      note:
        "One adapter per vendor UI, then free per tenant. The comparison that proves the gap is two requests: the API over a window, and the UI's own filter over the same window.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 26,
      outcome: "YIELDED",
      note:
        "26 future sittings visible in the vendor's UI and invisible to its API on one 'Next Month' filter, 2026-08-28: Pima 3 of 3, Mesa 12 of 15, Phoenix 8 of 8. Pima's three are 2026-09-08 1:00 PM Study Session, 2026-09-08 5:00 PM and 2026-09-22 5:00 PM, all in the Board of Supervisors' Hearing Room, agenda status 'Not Available' on all three.",
    },
  },
  {
    id: "legistar-insite-calendar-postback-enumeration",
    title:
      "driving Legistar InSite's own Calendar.aspx date-range postback — the only complete enumeration of a tenant's sittings",
    tier: "A1",
    fields: ["meeting", "agenda"],
    note:
      "THE MECHANICS, WRITTEN DOWN SO THE WALL NEVER COSTS A SECOND SESSION. (1) GET https://{tenant}.legistar.com/Calendar.aspx and keep EVERY form field it rendered. (2) POST back with __EVENTTARGET=ctl00$ContentPlaceHolder1$lstYears and the range in BOTH ctl00$ContentPlaceHolder1$lstYears and the Telerik hidden ctl00_ContentPlaceHolder1_lstYears_ClientState — the control is a RadComboBox, not a <select>, and posting only the visible text input is a SILENT NO-OP that answers HTTP 200 with 231 KB of correct markup and the previous range still selected. Read the rendered selection back out of ctl00_ContentPlaceHolder1_lstYears_Input to prove the filter took. The dropdown's own vocabulary is This/Next Week, Month, Year, All Years and every year back to 2013. (3) Parse rows on class=\"rgRow\"/\"rgAltRow\" and key cells on their ASP.NET control-id suffixes (hypBody, lblTime, hypiCal, hypMeetingDetail, hypAgenda, hypAccessibleAgendaHTML, hypMinutes, hypAccessibleMinutesHTML) rather than on column position, which a tenant can reorder. The meeting KIND is the <em> under the location. THE DISCRIMINATOR for what the API cannot see is class=\"meeting_NotViewable\" with title=\"Not viewable by the public\" and NO href. TWO SUPPORTING ROUTES, both weaker alone: Feed.ashx?M=Calendar&ID=..&GUID=.. is RSS carrying pubDate (the publication clock) but no location and no kind, and its ID/GUID pair is minted PER TENANT AND PER RANGE so it must be read off the page rather than stored; View.ashx?M=IC&ID=..&GUID=.. is one VEVENT per meeting whose DTSTART is FLOATING (20260908T130000, no Z, no TZID) and must be combined with the body's own zone — and the GUID is MANDATORY, because ID alone answers 200 with a 19 KB HTML confirmation page rather than an error. PERMISSION: legistar.com's apex robots.txt publishes Crawl-delay: 2 and disallows only *?wtime, *?wmediaid and *?wchannelid; the tenant hosts return 404 for robots.txt, which publishes no rules and is not licence to go faster than the vendor asked on its own name.",
    origin:
      "built 2026-08-28 to recover the Pima County sittings the WebAPI does not return. The RSS and the per-meeting iCalendar export were tried first and are both insufficient on their own — the feed has no location or kind, and the .ics needs an ID and GUID pair that only the grid publishes — which is what makes the grid the enumeration rather than a convenience.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "One adapter, then two requests per tenant per range at the vendor's stated two-second spacing. No credential, no session beyond the one the page issues itself.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 25,
      outcome: "YIELDED",
      note:
        "25 rows enumerated across three tenants on one 'Next Month' filter, 2026-08-28 — Pima 3, Mesa 15, Phoenix 8 (counted; Pima and Mesa recorded as fixtures) — each with body, date, local time, room, meeting kind, the four document statuses, the View.ashx ID+GUID pair and the viewability flag.",
    },
  },
  {
    id: "reconciled-is-not-complete",
    title:
      "a reconciled denominator answers whether rows were LOST; it says nothing about whether enough was ASKED FOR",
    tier: "A1",
    fields: ["meeting", "agenda", "roster", "candidate"],
    note:
      "THE CORRECTION, AND IT IS AN ACCOUNTING LESSON RATHER THAN A RETRIEVAL ONE. 'fetched 16, normalized 16, drops accounted' is a strong, true statement about ONE ROUTE'S ANSWER: nothing between that source and the screen was dropped. It is not a statement about the body's calendar, and the two get confused because the reconciliation feels like a proof and there is nothing else in view to compare it against. THE FAILURE MODE, OBSERVED: a session read a per-source denominator that reconciled exactly, queried the primary API by hand over the same window, got the same answer, and recorded the snapshot as 'complete for the window' — then inferred from the API's silence a fact about the government (that it publishes September only as a recurring rule). Every measurement in that chain was correct; the inference was false, and the portal published all three sittings individually. THE DISCRIMINATOR THAT IS MISSING FROM A RECONCILED DENOMINATOR IS A SECOND ROUTE. Until a second independent route has been asked the same question, a reconciled count has a denominator of ONE ROUTE'S OPINION, and the honest sentence is 'this route returned N and nothing was lost', never 'there are N'. THE CHEAP SECOND ROUTE for a vendor-backed body is the vendor's own web UI (see vendor-api-and-vendor-web-ui-are-different-records); for a body's own site it is the sitemap. RULING 100 already says a partial that reconciles is still a wrong answer — this is that ruling meeting a real reconciliation and losing.",
    origin:
      "generalised 2026-08-28 from correcting a conclusion recorded earlier the same day by a session that had quoted RULING 100 in the very route where it then called one route's answer complete. That is the evidence that the written rule is not enough on its own and the discriminator has to be a habit: ask a second route before writing the word.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "REAPPLIED_KNOWN_METHOD",
      readerIntegrityRepair: true,
      note:
        "No new retrieval. It is a rule about which sentence a reconciled count licenses, and it costs one extra route before the word 'complete' may be written.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 3,
      outcome: "YIELDED",
      note:
        "Three published Pima County sittings recovered from behind a denominator that reconciled perfectly: 2026-09-08 1:00 PM Study Session, 2026-09-08 5:00 PM, 2026-09-22 5:00 PM. The 1:00 PM study session is the one that could not have been synthesised from the recurrence rule, which gives study sessions no time at all.",
    },
  },
];

/**
 * The supersession record: which earlier route's conclusion this run replaces,
 * and with what.
 *
 * A `SubBranch` is the schema's own shape for exactly this — "a branch that
 * stops working is evidence the tree needs another limb, never evidence the
 * fact is unobtainable … it is never DELETED, because deleting it would let a
 * later session rediscover it as new" (RULING 60). The superseded routes keep
 * every word they were written with.
 */
const SUPERSESSIONS: { routeId: string; branch: Omit<SubBranch, "failedOn"> }[] = [
  {
    routeId: "body-publishes-its-schedule-separately-from-its-agendas",
    branch: {
      jurisdiction: "az",
      reason:
        "SUPERSEDED IN PART, and the surviving half is the larger one. The publishing-practice observation stands: a body's schedule and its agendas really are different records on different clocks, and Vail remains the control. What is withdrawn is the conclusion drawn about Pima — that its September sittings existed ONLY as the recurring rule at www.pima.gov/2599. They did not. All three were individually published on the county's own Legistar InSite portal at the time that route was recorded, with a date, a room and a meeting kind, and the 2026-09-08 1:00 PM Study Session among them could not have been derived from the rule text, which gives study sessions no time at all. The route's diagnostic — ask the body's own site — was too narrow: the vendor's own web UI is a third record again, and it is the one that held these.",
      replacedBy: "vendor-api-and-vendor-web-ui-are-different-records",
    },
  },
  {
    routeId: "reconcile-the-adapter-before-suspecting-it",
    branch: {
      jurisdiction: "az",
      reason:
        "SUPERSEDED IN ITS CONCLUSION, NOT IN ITS METHOD. Reading the per-source denominators before opening the adapter is still the right first move and still exonerated the pipeline by observation. What is withdrawn is one word in its recorded outcome: the seven events over 2026-08-01 to 2026-11-01 confirmed the snapshot as UNTRUNCATED, never as 'complete for the window'. Reconciling proves nothing was DROPPED; it never proves enough was ASKED FOR. Twenty-six future sittings were sitting behind that reconciliation on three tenants, and the route as recorded would have stopped a session before it looked.",
      replacedBy: "reconciled-is-not-complete",
    },
  },
];

function applySupersessions(
  knowledge: MethodKnowledge,
  stamp: string,
): { knowledge: MethodKnowledge; log: string[] } {
  const log: string[] = [];
  let k = knowledge;

  for (const { routeId, branch } of SUPERSESSIONS) {
    const route = k.routes.find((r) => r.id === routeId);
    if (!route) {
      // Named, never silent: a supersession that cannot find what it supersedes
      // has not happened, and the run says so rather than reporting a success.
      log.push(`  NOT SUPERSEDED  ${routeId} — no such route in project knowledge`);
      continue;
    }
    const already = route.subBranches.some(
      (b) => b.jurisdiction === branch.jurisdiction && b.replacedBy === branch.replacedBy,
    );
    if (already) {
      log.push(`  already recorded ${routeId} -> ${branch.replacedBy}`);
      continue;
    }
    k = {
      ...k,
      routes: k.routes.map((r) =>
        r.id === routeId
          ? { ...r, subBranches: [...r.subBranches, { ...branch, failedOn: stamp }] }
          : r,
      ),
    };
    log.push(`  SUPERSEDED      ${routeId} -> ${branch.replacedBy}`);
  }

  return { knowledge: k, log };
}

const stamp = today();
const store = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
const batch = learnBatch(store, ROUTES, stamp);
for (const line of batch.log) console.log(line);

const superseded = applySupersessions(batch.knowledge, stamp);
for (const line of superseded.log) console.log(line);

writeFileSync(
  STORE,
  `${JSON.stringify({ ...superseded.knowledge, updatedOn: stamp }, null, 2)}\n`,
  "utf8",
);

console.log(
  `\nmethod version ${batch.versionBefore} -> ${superseded.knowledge.version}   ` +
    `(${batch.learned} learned, ${batch.already} already known)`,
);
console.log(
  `routes known now: ${superseded.knowledge.routes.length}  — WHAT THE PROJECT KNOWS NOW, never a cap`,
);
console.log(
  `  ${floorLine(
    floored(
      "routes new to the project",
      "the routes this session conceived",
      batch.offered,
      batch.learned,
    ),
  )}`,
);
console.log(
  `  ${floorLine(
    floored(
      "earlier conclusions superseded",
      "the conclusions this session set out to correct",
      SUPERSESSIONS.length,
      superseded.log.filter((l) => l.includes("SUPERSEDED  ")).length,
    ),
  )}`,
);
