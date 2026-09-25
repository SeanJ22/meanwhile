#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — `attemptedAt` is minted by the code path that performs the read,
 * in the run that fetched the page it describes.
 */
/**
 * **A DIRECTORY, INVERTED: whose page is this?**
 * (The final pass, 2026-08-25, item 7. The portable form of the route that
 * worked for New Jersey's committee sites.)
 *
 * ```
 * pnpm directory:invert --zip=03255
 * pnpm directory:invert --zip=03255 --write
 * pnpm directory:invert --zip=03255 --pages=20
 * ```
 *
 * ## Why this exists as its own tool rather than a third copy
 *
 * Three hunts this session asked the same question of a page — *which of the
 * candidates on this ballot does it name, and is it about standing for office* —
 * and the third would have been a third implementation. RULING 60 says a route
 * proven in one place is proven for that SHAPE, and RULING 63 says a session
 * that rebuilds a branch which already exists has committed a defect. So the
 * seeds are data and the machinery is one thing.
 *
 * **And RULING 60's caveat is the reason the seeds are per-state.** New England
 * is one of the stranger shapes in the country: New Hampshire's ballot at 03255
 * is federal, statewide and COUNTY, with no municipal layer on it at all, and
 * its state legislators live on a General Court roster that has no New Jersey
 * equivalent. The technique travels; the addresses do not.
 *
 * ## The seeds, and who publishes each
 *
 * RULING 93: ask what the tier ABOVE publishes about the tier below. Every seed
 * names its publisher and what it is a directory OF, so a reader can see the
 * hierarchy being descended rather than a list of URLs somebody collected.
 *
 * ## The bar is unchanged
 *
 * `verdictFor` and `classifyCampaignPage` decide, exactly as they do everywhere
 * else. A `.gov` or a legislature's own host publishing a member's page is that
 * member's VERIFIED PAGE — a read from the subject's own official source IS the
 * verification, on the date it was read. A surname alone never promotes.
 *
 * This supplies no photo. Portraits are a separate walk with its own door.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  flattenForEvidence,
  matchNameForms,
  officeEvidenceIn,
} from "../lib/hunt/candidate-evidence.ts";
import { CONTROL_IDENTIFIER, beyondControl } from "../lib/hunt/control-query.ts";
import { conserve } from "../lib/sources/normalize-account.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=03255").slice(6);
const PAGES = Number((process.argv.find((a) => a.startsWith("--pages=")) ?? "--pages=25").slice(8));
const TODAY = today();

interface Seed {
  url: string;
  publisher: string;
  /** What tier this is a directory OF — RULING 93's descent, stated. */
  about: string;
  /** Is a page on this host an OFFICIAL source for the person it names? */
  official: boolean;
}

const SEEDS: Record<string, { ballot: string; seeds: Seed[] }> = {
  "03255": {
    ballot: "nh-merrimack-2026.json",
    seeds: [
      {
        url: "https://gc.nh.gov/house/members/default.aspx",
        publisher: "the New Hampshire General Court",
        about: "the House of Representatives — the state publishing its own legislators",
        official: true,
      },
      {
        url: "https://gc.nh.gov/Senate/members/senate_roster.aspx",
        publisher: "the New Hampshire General Court",
        about: "the State Senate — the state publishing its own legislators",
        official: true,
      },
      {
        url: "https://www.merrimackcounty.net/",
        publisher: "Merrimack County",
        about: "the county's own elected officers — sheriff, attorney, treasurer, registers",
        official: true,
      },
      {
        url: "https://www.governor.nh.gov/",
        publisher: "the Office of the Governor of New Hampshire",
        about: "the state's own executive",
        official: true,
      },
      {
        url: "https://www.nh.gov/governor/executive-council/",
        publisher: "the State of New Hampshire",
        about: "the Executive Council — a body New Hampshire has and almost nowhere else does",
        official: true,
      },
    ],
  },
};

const chosen = SEEDS[ZIP];
if (!chosen) {
  console.error(`pnpm directory:invert --zip=<${Object.keys(SEEDS).join("|")}>`);
  process.exit(1);
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", chosen.ballot), "utf8")) as {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName?: string; familyName?: string; name?: string }[];
};
const contestTitle = new Map(ballot.contests.map((c) => [c.id, c.title]));
const nameOf = (c: (typeof ballot.candidacies)[number]) =>
  (c.name ?? `${c.givenName ?? ""} ${c.familyName ?? ""}`).replace(/\s+/g, " ").trim();

const links = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8")) as {
  links: Record<string, { official?: unknown }>;
};

/** Links worth following, as a shape (RULING 110), and links that cost a fetch for nothing. */
const WORTH_FOLLOWING = /(member|roster|senator|representative|council|sheriff|attorney|treasurer|register|deeds|probate|commissioner|official|about|staff|department|governor)/i;
const NEVER_FOLLOW =
  /(\.(jpe?g|png|gif|webp|svg|pdf|zip|ics|css|js|xml)($|\?)|mailto:|tel:|javascript:|\/search|\/login|calendar)/i;

interface Row {
  seed: string;
  publisher: string;
  url: string;
  status: number;
  bytes: number;
  beyondControl: boolean;
  officeEvidence: string[];
  names: { candidacyId: string; subject: string; contestTitle: string; strong: boolean; forms: string[] }[];
  verifiedPageFor: string[];
  attemptedAt: string;
  note: string;
}

console.log(`\nDIRECTORY INVERSION — ${ZIP}, ${TODAY}\n`);
console.log(`  seeds                     ${chosen.seeds.length}`);
console.log(`  pages per seed (cap)      ${PAGES}`);
console.log(`  candidates tested per page ${ballot.candidacies.length}\n`);

const rows: Row[] = [];
let fetched = 0;
let refused = 0;

for (const seed of chosen.seeds) {
  let origin: string;
  try {
    origin = new URL(seed.url).origin;
  } catch {
    continue;
  }
  let control = -1;
  try {
    const c = await politeGetText(`${origin}/${CONTROL_IDENTIFIER}`, {});
    control = c.status === 200 ? c.text.length : -1;
  } catch {
    control = -1;
  }

  const queue = [seed.url];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    fetched += 1;
    let status = 0;
    let text = "";
    try {
      const r = await politeGetText(url, {});
      status = r.status;
      text = r.text;
    } catch {
      status = 0;
    }
    if (status !== 200 || text.length === 0) {
      refused += 1;
      rows.push({
        seed: seed.url,
        publisher: seed.publisher,
        url,
        status,
        bytes: 0,
        beyondControl: false,
        officeEvidence: [],
        names: [],
        verifiedPageFor: [],
        attemptedAt: TODAY,
        note: `HTTP ${status || "network"} — a wall on ${TODAY}, never an absence`,
      });
      continue;
    }

    const past = beyondControl(text.length, control);
    const flat = flattenForEvidence(text);
    const office = officeEvidenceIn(flat);

    const names: Row["names"] = [];
    if (past) {
      for (const c of ballot.candidacies) {
        const subject = nameOf(c);
        if (!subject) continue;
        const forms = matchNameForms(subject, flat);
        const matched = forms.filter((f) => f.matched);
        if (matched.length === 0) continue;
        names.push({
          candidacyId: c.id,
          subject,
          contestTitle: contestTitle.get(c.contestId) ?? "",
          strong: matched.some((f) => f.kind !== "surname"),
          forms: matched.map((f) => f.form),
        });
      }
    }

    /*
     * A READ FROM THE SUBJECT'S OWN OFFICIAL SOURCE IS THE VERIFICATION.
     *
     * That is the standing rule and it is why `official` sits on the seed
     * rather than being inferred from the URL: the New Hampshire General Court
     * publishing a sitting legislator's page is the state identifying its own
     * member, and requiring campaign vocabulary on top of that would be asking
     * a legislature to talk like a campaign.
     *
     * A page naming ONE person is that person's page; a page naming twelve is
     * the roster they are listed on, and the roster is not any one of their
     * pages. The distinction is what keeps a directory index from being
     * recorded as forty people's verified page.
     */
    const strong = names.filter((n) => n.strong);
    const verifiedPageFor = seed.official && strong.length === 1 ? [strong[0].candidacyId] : [];

    rows.push({
      seed: seed.url,
      publisher: seed.publisher,
      url,
      status,
      bytes: text.length,
      beyondControl: past,
      officeEvidence: office,
      names,
      verifiedPageFor,
      attemptedAt: TODAY,
      note: !past
        ? `200 with ${text.length} B, indistinguishable from this host's answer for a path that cannot exist (${control} B)`
        : strong.length === 1
          ? `names exactly one candidate on this ballot — their own page on ${seed.publisher}'s site`
          : strong.length > 1
            ? `names ${strong.length} candidates — a roster, which is nobody's own page`
            : "names none of the candidates on this ballot",
    });

    if (strong.length > 0) {
      console.log(
        `  ${String(strong.length).padStart(2)} name(s) ${strong.length === 1 ? "PAGE" : "list"}  ${url.slice(0, 78)}`,
      );
    }

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

const verified = new Map<string, { url: string; publisher: string }>();
for (const r of rows) {
  for (const id of r.verifiedPageFor) {
    if (!verified.has(id) && !links.links[id]?.official) {
      verified.set(id, { url: r.url, publisher: r.publisher });
    }
  }
}
const naming = rows.filter((r) => r.names.length > 0);
const accounting = conserve("directory-inversion", {
  logicalInput: fetched,
  produced: naming.length,
  dropped: fetched - naming.length,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  pages fetched            ${fetched}`);
console.log(`  refused                  ${refused} — walls on this date, never absences`);
console.log(`  naming somebody          ${naming.length}`);
console.log(`  accounting               ${accounting.outcome}, ${accounting.accountedFor} of ${fetched}`);
console.log(`\n  NEW verified pages       ${verified.size} of ${ballot.candidacies.length}`);
for (const [id, v] of verified) {
  const c = ballot.candidacies.find((x) => x.id === id);
  console.log(`    ${(c ? nameOf(c) : id).padEnd(28)} ${v.url}`);
}

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", `directory-inversion-${ZIP}-0825.json`);
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "A tier-above directory, read by INVERSION: each page tested against every candidate on the " +
          "ballot, rather than each candidate searched for separately. A page naming exactly ONE " +
          "candidate on an official host is that candidate's verified page; a page naming several is " +
          "the roster they are listed on, and a roster is nobody's own page. The technique travels; " +
          "the seeds are per-state, because New England's shape is not New Jersey's (RULING 60). " +
          "Written by scripts/directory-inversion-0825.mts.",
        zip: ZIP,
        walkedAt: TODAY,
        route: "tier-above-directory-inversion",
        tier: "A",
        seeds: chosen.seeds,
        totals: {
          seeds: chosen.seeds.length,
          pagesFetched: fetched,
          refused,
          namingSomebody: naming.length,
          newVerifiedPages: verified.size,
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
void existsSync;
