#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — `attemptedAt` is minted by the code path that performs the read.
 */
/**
 * **THE HYPERLOCAL PRESS, WALKED PER MUNICIPALITY.**
 * (The final pass, 2026-08-25, item 4.)
 *
 * ```
 * pnpm press:surface                # walk and report, write nothing
 * pnpm press:surface --write
 * ```
 *
 * The outlets, their kinds and their READ-AND-DATED terms are
 * `lib/hunt/press-surface.ts`. An outlet whose `robots.txt` could not be read is
 * not walked — `www.tapinto.net` answers 403 on its own policy, and a 403 on a
 * policy is not an implied yes.
 *
 * ## The inversion again, and what a press page can and cannot give
 *
 * Each page is tested against every candidate on the ballot at once. A press
 * page NAMING a candidate is evidence they are covered; it is never their
 * verified page, for the same reason `huffpost.com` is not a comedian's campaign
 * site. What it yields is:
 *
 * - **outbound hosts** the article links to, which go to the campaign-site
 *   adjudicator and face `classifyCampaignPage` there like everything else, and
 * - a measured answer to *who covers these races*, per town.
 *
 * **No press route supplies a photo, at any outlet.** Press photos are the
 * demand-letter class and no door in the photo rule reaches them. This script
 * does not read images at all, which is the cheapest way to be unable to.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { flattenForEvidence, matchNameForms } from "../lib/hunt/candidate-evidence.ts";
import { PRESS_OUTLETS, townSlugs, walkableOutlets } from "../lib/hunt/press-surface.ts";
import { conserve } from "../lib/sources/normalize-account.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const TODAY = today();

const MUNICIPALITIES: string[] = (
  JSON.parse(readFileSync(join(ROOT, "data", "hunt", "roster-pages-muni-sites-nj-morris.json"), "utf8")) as {
    sites: { municipality: string }[];
  }
).sites.map((s) => s.municipality);

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
};

/** Hosts that are the outlet's own furniture, never a lead. */
const CHROME = /(patch\.com|gannett|usatoday|dailyrecord|northjersey|facebook|twitter|x\.com|instagram|linkedin|youtube|google|doubleclick|gstatic|cloudfront|w3\.org|schema\.org)/i;

interface Row {
  outlet: string;
  host: string;
  municipality: string | null;
  url: string;
  status: number;
  bytes: number;
  namesStrong: { candidacyId: string; subject: string }[];
  outboundHosts: string[];
  attemptedAt: string;
  note: string;
}

console.log(`\nTHE HYPERLOCAL PRESS SURFACE — ${TODAY}\n`);
console.log(`  outlets enumerated   ${PRESS_OUTLETS.length}`);
for (const o of PRESS_OUTLETS) {
  console.log(`    ${o.permission.padEnd(11)} ${o.id.padEnd(20)} ${o.kind}`);
}
const walkable = walkableOutlets();
console.log(`\n  walkable             ${walkable.length} of ${PRESS_OUTLETS.length} — terms read and dated on every one`);
console.log(`  municipalities       ${MUNICIPALITIES.length}`);
console.log(`  candidates per page  ${ballot.candidacies.length}\n`);

const rows: Row[] = [];
let attempted = 0;
let refused = 0;

async function read(outlet: (typeof PRESS_OUTLETS)[number], url: string, municipality: string | null) {
  attempted += 1;
  let status = 0;
  let text = "";
  try {
    const r = await politeGetText(url, { profile: "browser" });
    status = r.status;
    text = r.text;
  } catch (e) {
    status = Number(/HTTP (\d{3})/.exec((e as Error)?.message ?? "")?.[1] ?? 0);
  }
  if (status !== 200 || text.length === 0) {
    refused += 1;
    rows.push({
      outlet: outlet.id,
      host: outlet.host,
      municipality,
      url,
      status,
      bytes: 0,
      namesStrong: [],
      outboundHosts: [],
      attemptedAt: TODAY,
      note: `HTTP ${status || "network"} — a wall on ${TODAY}, never an absence`,
    });
    return;
  }
  const flat = flattenForEvidence(text);
  const namesStrong = ballot.candidacies
    .filter((c) =>
      matchNameForms(`${c.givenName} ${c.familyName}`.trim(), flat).some(
        (f) => f.matched && f.kind !== "surname",
      ),
    )
    .map((c) => ({ candidacyId: c.id, subject: `${c.givenName} ${c.familyName}` }));

  const outbound = new Set<string>();
  for (const m of text.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    let h: string;
    try {
      h = new URL(m[1]).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (CHROME.test(h)) continue;
    outbound.add(h);
    if (outbound.size >= 40) break;
  }

  rows.push({
    outlet: outlet.id,
    host: outlet.host,
    municipality,
    url,
    status,
    bytes: text.length,
    namesStrong,
    outboundHosts: [...outbound],
    attemptedAt: TODAY,
    note: namesStrong.length
      ? `names ${namesStrong.length} candidate(s) on this ballot`
      : "covers this town and names none of its candidates on this page",
  });
  if (namesStrong.length) {
    console.log(
      `  ${outlet.id.padEnd(18)} ${(municipality ?? "-").padEnd(22)} ${String(namesStrong.length).padStart(2)} name(s)  ${url.slice(0, 52)}`,
    );
  }
}

for (const outlet of walkable) {
  if (outlet.townUrl) {
    for (const m of MUNICIPALITIES) {
      /*
       * EVERY SPELLING, AND AN ABSENCE ONLY AFTER ALL OF THEM.
       *
       * The first run of this walk reported 4 of 39 Patch towns because it tried
       * one spelling: `parsippany-troy-hills` answers 404 and `parsippany`
       * answers 200. Three real hyperlocals were recorded as towns with no
       * press, which is a claim about a town made from a fact about our reader.
       */
      let found = false;
      for (const slug of townSlugs(m)) {
        const before = rows.length;
        await read(outlet, outlet.townUrl(slug), m);
        if (rows[before]?.status === 200) {
          found = true;
          break;
        }
      }
      void found;
    }
  } else if (outlet.entry) {
    await read(outlet, outlet.entry, null);
  }
}

const naming = rows.filter((r) => r.namesStrong.length > 0);
const named = new Set(naming.flatMap((r) => r.namesStrong.map((n) => n.candidacyId)));
const leadHosts = new Set(naming.flatMap((r) => r.outboundHosts));
const accounting = conserve("press-surface", {
  logicalInput: attempted,
  produced: rows.filter((r) => r.status === 200).length,
  dropped: refused,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  pages walked           ${attempted}`);
console.log(`  refused                ${refused} — walls on this date, never absences`);
console.log(`  accounting             ${accounting.outcome}, ${accounting.accountedFor} of ${attempted}`);
console.log(`\n  pages NAMING a candidate on this ballot   ${naming.length}`);
console.log(`  distinct candidates named                 ${named.size} of ${ballot.candidacies.length}`);
console.log(`  outbound hosts to adjudicate              ${leadHosts.size}`);
console.log(`\n  PHOTOS TAKEN FROM THE PRESS: 0. No door in the photo rule reaches a press image.`);

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", "nj-morris-press-surface-0825.json");
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "The hyperlocal press surface for Morris County, enumerated per municipality with each " +
          "outlet's OWN robots.txt read and dated BEFORE any page was fetched. An outlet whose policy " +
          "could not be read is not walked: www.tapinto.net answers 403 on its own robots.txt, and a " +
          "403 on a policy is not an implied yes. A press page naming a candidate is never their " +
          "verified page — what it yields is outbound hosts, which face classifyCampaignPage like " +
          "everything else. NO PHOTO is taken from any press outlet. Written by " +
          "scripts/press-surface-0825.mts.",
        walkedAt: TODAY,
        route: "press-outlet-town-page",
        tier: "A",
        outlets: PRESS_OUTLETS.map((o) => ({
          id: o.id,
          host: o.host,
          kind: o.kind,
          permission: o.permission,
          robots: o.robots,
        })),
        totals: {
          outletsEnumerated: PRESS_OUTLETS.length,
          walkable: walkable.length,
          municipalities: MUNICIPALITIES.length,
          pagesWalked: attempted,
          refused,
          pagesNamingACandidate: naming.length,
          candidatesNamed: named.size,
          outboundHostsToAdjudicate: leadHosts.size,
          photosTaken: 0,
        },
        accounting,
        rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  written ${out}`);
} else {
  console.log("\n  report only — pass --write to record the walk");
}
