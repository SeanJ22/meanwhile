#!/usr/bin/env tsx
/**
 * **THE MUNICIPAL COMMITTEE SITES, CRAWLED FOR CANDIDATE PAGES.**
 * (The final pass, 2026-08-25, items 3 and 5. The consumer of
 * `pnpm party:directory`.)
 *
 * ```
 * pnpm party:pages                  # walk and report, write nothing
 * pnpm party:pages --write
 * pnpm party:pages --pages=12       # internal pages per site (default 12)
 * ```
 *
 * ## The route, and why it ends at a field the item list already owes
 *
 * `pnpm party:directory` produced the authoritative municipal committee website
 * for each Morris municipality, named by the county party rather than guessed.
 * This walks those sites and the internal pages most likely to be about the
 * people they run, and asks of every page: **whose page is this?**
 *
 * That is the same inversion `scripts/adjudicate-leads-0825.mts` uses and for
 * the same reason. A committee's candidate page names several candidates at
 * once; asking each candidate about each page separately would cost one fetch
 * per pair and find strictly less.
 *
 * ## RULING 122 IS THE BAR, AND IT IS NOT THE CAMPAIGN-SITE BAR
 *
 * A page a party publishes ABOUT a candidate is the candidate's **verified
 * page** when it carries their name, the office, their own words and a contact —
 * rendered with the host labelled plainly, because presenting a party's website
 * under a bare "Campaign site" label would blur the line the
 * organisations-render-as-filed rule draws. It is NOT automatically a campaign
 * site, and this records the two separately so a later surface cannot conflate
 * them.
 *
 * **It never supplies a photo.** A party's site is not one of the four doors,
 * and a door the campaign-site rule opens is not a door into the photo rule.
 * This script does not read images at all, which is the cheapest possible way
 * to be unable to break that rule.
 *
 * ## Every page is control-checked and every count is stated
 *
 * A 200 that is not about the thing asked for is not a document. Each host's own
 * answer for a path that cannot exist is measured once and every real page is
 * compared against it (RULING 68). The run states pages fetched, pages refused,
 * pages naming somebody and pages naming nobody, and they sum.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  flattenForEvidence,
  matchNameForms,
  officeEvidenceIn,
  partyOrganSelfIdIn,
} from "../lib/hunt/candidate-evidence.ts";
import { CONTROL_IDENTIFIER, beyondControl } from "../lib/hunt/control-query.ts";
import { conserve } from "../lib/sources/normalize-account.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const PAGES = Number((process.argv.find((a) => a.startsWith("--pages=")) ?? "--pages=12").slice(8));

const DIRECTORY = join(ROOT, "data", "hunt", "nj-morris-party-directory-0825.json");
if (!existsSync(DIRECTORY)) {
  console.error("run `pnpm party:directory --write` first — this consumes its output");
  process.exit(1);
}

interface DirRow {
  party: string;
  org: string;
  municipality: string;
  committeeWebsite: string | null;
  url: string;
}
const directory = JSON.parse(readFileSync(DIRECTORY, "utf8")) as { rows: DirRow[] };

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8"),
) as {
  contests: { id: string; title: string }[];
  candidacies: {
    id: string;
    contestId: string;
    givenName: string;
    familyName: string;
    partyLabel: string | null;
  }[];
};
const contestTitle = new Map(ballot.contests.map((c) => [c.id, c.title]));

/**
 * Which internal links are worth following, as a SHAPE rather than a list of
 * paths (RULING 110). A committee names its candidate pages a dozen ways —
 * `/candidates`, `/meet-us`, `/our-team`, `/2026`, `/goddard-verga` — and a
 * fixed path list would have found `mpdems.org/candidates` and missed
 * `mpdems.org/goddard-verga`, which is the page that actually names the people.
 */
const WORTH_FOLLOWING =
  /(candidate|meet|team|slate|who-?we-?are|about|elect|vote|2026|our-|for-|ticket|nominee)/i;

/** Never followed: these cost a fetch and cannot name a candidate. */
const NEVER_FOLLOW =
  /(\.(jpe?g|png|gif|webp|svg|pdf|zip|ics|css|js)($|\?)|actblue|winred|paypal|donate|\/wp-|\/feed|\/tag\/|\/category\/|mailto:|tel:)/i;

interface PageRow {
  party: string;
  org: string;
  municipality: string;
  site: string;
  url: string;
  status: number;
  bytes: number;
  control: number;
  beyondControl: boolean;
  /** Candidates on the ballot this page names, with the forms that matched. */
  names: {
    candidacyId: string;
    subject: string;
    contestTitle: string;
    forms: string[];
    strong: boolean;
    /** The page's publisher is this candidate's OWN party. RULING 122. */
    ownParty: boolean;
  }[];
  officeEvidence: string[];
  partyOrganSelfId: string[];
  /** RULING 122: name + office + a contact on a page the party publishes. */
  verifiedPageFor: string[];
  attemptedAt: string;
  note: string;
}

const seeds = directory.rows.filter((r) => r.committeeWebsite);
console.log(`\nCOMMITTEE SITES, CRAWLED FOR CANDIDATE PAGES — ${today()}\n`);
console.log(`  committee sites from the county party's directory  ${seeds.length}`);
console.log(`  internal pages followed per site (cap)            ${PAGES}`);
console.log(`  candidates tested per page                        ${ballot.candidacies.length}\n`);

const rows: PageRow[] = [];
let fetched = 0;
let refusedPages = 0;
const seenSite = new Set<string>();

for (const seed of seeds) {
  const site = seed.committeeWebsite!;
  let origin: string;
  try {
    origin = new URL(site).origin;
  } catch {
    continue;
  }
  if (seenSite.has(origin)) continue;
  seenSite.add(origin);

  /* This host's own answer for a path that cannot exist. RULING 68. */
  let control = -1;
  try {
    const c = await politeGetText(`${origin}/${CONTROL_IDENTIFIER}`, { profile: "browser" });
    control = c.status === 200 ? c.text.length : -1;
  } catch {
    control = -1;
  }

  /* "democratic" / "republican", from the county party's own directory row. */
  const partyName = seed.party.toLowerCase();

  const queue = [site];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    fetched += 1;
    let status = 0;
    let text = "";
    try {
      const r = await politeGetText(url, { profile: "browser" });
      status = r.status;
      text = r.text;
    } catch {
      status = 0;
    }
    if (status !== 200 || text.length === 0) {
      refusedPages += 1;
      rows.push({
        party: seed.party,
        org: seed.org,
        municipality: seed.municipality,
        site,
        url,
        status,
        bytes: text.length,
        control,
        beyondControl: false,
        names: [],
        officeEvidence: [],
        partyOrganSelfId: [],
        verifiedPageFor: [],
        attemptedAt: today(),
        note: `HTTP ${status || "network"} — a wall on this date, never an absence`,
      });
      continue;
    }

    const past = beyondControl(text.length, control);
    const flat = flattenForEvidence(text);
    const office = officeEvidenceIn(flat);
    const organ = partyOrganSelfIdIn(flat);

    /* THE INVERSION: every candidate on the ballot, against this one page. */
    const names: PageRow["names"] = [];
    if (past) {
      for (const c of ballot.candidacies) {
        const forms = matchNameForms(`${c.givenName} ${c.familyName}`.trim(), flat);
        const matched = forms.filter((f) => f.matched);
        if (matched.length === 0) continue;
        names.push({
          candidacyId: c.id,
          subject: `${c.givenName} ${c.familyName}`,
          contestTitle: contestTitle.get(c.contestId) ?? "",
          forms: matched.map((f) => f.form),
          strong: matched.some((f) => f.kind !== "surname"),
          /*
           * IS THIS THE CANDIDATE'S OWN PARTY'S SITE?
           *
           * RULING 122 says *their party's* site, and the first run of this
           * script did not check. It counted Mendham Borough Democrats' page as
           * Thomas H. Kean, Jr.'s verified page and Morris Plains Democrats'
           * page as the Independent incumbent's, because both are NAMED there —
           * as opponents. A page an opposing party publishes about a candidate
           * is a real document and it is not that candidate's page, and
           * rendering it as one would be this product characterising a person
           * by way of who wrote about them.
           *
           * A candidate with no party on the filing (an Independent, or a
           * school-board race the clerk files without one) can never match a
           * party committee, which is the correct answer: their verified page
           * has to come from somewhere else.
           */
          ownParty: Boolean(c.partyLabel) && c.partyLabel!.toLowerCase() === partyName,
        });
      }
    }

    /*
     * RULING 122's bar, applied per candidate named on the page. A SURNAME
     * alone never qualifies — a page about any relative or namesake would match
     * it — and the page must both be about standing for office and carry a way
     * to reach somebody.
     */
    const hasContact = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(flat) || /\bcontact\b/i.test(flat);
    const verifiedPageFor = names
      .filter((n) => n.strong && office.length > 0 && hasContact && n.ownParty)
      .map((n) => n.candidacyId);

    rows.push({
      party: seed.party,
      org: seed.org,
      municipality: seed.municipality,
      site,
      url,
      status,
      bytes: text.length,
      control,
      beyondControl: past,
      names,
      officeEvidence: office,
      partyOrganSelfId: organ,
      verifiedPageFor,
      attemptedAt: today(),
      note: past
        ? names.length > 0
          ? `names ${names.length} candidate(s) on this ballot`
          : "cleared the control and names none of the candidates on this ballot"
        : `200 with ${text.length} B, indistinguishable from this host's answer for a path that cannot exist (${control} B) — the host talking about itself`,
    });

    if (names.length > 0) {
      console.log(
        `  ${seed.municipality.padEnd(22)} ${String(names.length).padStart(2)} name(s)  ${url.slice(0, 72)}`,
      );
    }

    /* Follow internal links worth following, same origin only. */
    for (const m of text.matchAll(/href="([^"]+)"/g)) {
      const raw = m[1];
      if (NEVER_FOLLOW.test(raw)) continue;
      let next: string;
      try {
        next = new URL(raw, url).toString().split("#")[0];
      } catch {
        continue;
      }
      if (!next.startsWith(origin)) continue;
      if (seen.has(next) || queue.includes(next)) continue;
      if (!WORTH_FOLLOWING.test(next)) continue;
      queue.push(next);
    }
  }
}

const naming = rows.filter((r) => r.names.length > 0);
const namingNobody = rows.filter((r) => r.beyondControl && r.names.length === 0);
const notADocument = rows.filter((r) => r.status === 200 && !r.beyondControl);

const verified = new Map<string, { url: string; org: string }>();
for (const r of rows) for (const id of r.verifiedPageFor) if (!verified.has(id)) verified.set(id, { url: r.url, org: r.org });

const strongNamed = new Set<string>();
const ownPartyNamed = new Set<string>();
for (const r of rows) {
  for (const n of r.names) {
    if (!n.strong) continue;
    strongNamed.add(n.candidacyId);
    if (n.ownParty) ownPartyNamed.add(n.candidacyId);
  }
}

const accounting = conserve("party-pages", {
  logicalInput: fetched,
  produced: naming.length,
  dropped: refusedPages + namingNobody.length + notADocument.length,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  pages fetched            ${fetched}`);
console.log(`  refused                  ${refusedPages} — walls on this date, never absences`);
console.log(`  200 but not a document   ${notADocument.length}`);
console.log(`  naming somebody          ${naming.length}`);
console.log(`  naming nobody            ${namingNobody.length}`);
console.log(`  accounting               ${accounting.outcome}, ${accounting.accountedFor} of ${fetched}`);
console.log(`\n  candidates NAMED on a party page (strong form)  ${strongNamed.size} of ${ballot.candidacies.length}`);
console.log(`  candidates meeting RULING 122's verified-page bar ${verified.size} of ${ballot.candidacies.length}`);

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", "nj-morris-party-pages-0825.json");
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "The municipal committee sites named by the county party, crawled and read by INVERSION: " +
          "each page tested against every candidate on the ballot rather than each candidate against " +
          "each page. RULING 122's bar for a verified page is name + office + contact on a page the " +
          "party publishes, rendered with the HOST LABELLED. This supplies NO PHOTO — a party site is " +
          "not one of the four doors. Written by scripts/hunt-party-pages-0825.mts.",
        walkedAt: today(),
        route: "party-committee-page",
        tier: "B",
        totals: {
          committeeSites: seeds.length,
          pagesFetched: fetched,
          refused: refusedPages,
          notADocument: notADocument.length,
          namingSomebody: naming.length,
          namingNobody: namingNobody.length,
          candidatesNamedStrong: strongNamed.size,
          candidatesNamedByOwnParty: ownPartyNamed.size,
          namedOnlyByAnOpposingParty: strongNamed.size - ownPartyNamed.size,
          verifiedPages: verified.size,
          ballotCandidacies: ballot.candidacies.length,
        },
        accounting,
        verifiedPages: [...verified].map(([candidacyId, v]) => ({ candidacyId, ...v })),
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
