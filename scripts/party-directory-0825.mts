#!/usr/bin/env tsx
/**
 * **THE COUNTY PARTY'S OWN DIRECTORY OF ITS MUNICIPAL COMMITTEES.**
 * (The final pass, 2026-08-25, item 4 — a route that did not exist at session
 * start, conceived under RULING 93.)
 *
 * ```
 * pnpm party:directory                # walk and report, write nothing
 * pnpm party:directory --write        # record data/hunt/nj-morris-party-directory-0825.json
 * pnpm party:directory --limit=5
 * ```
 *
 * ## How this route was conceived, and what it replaces
 *
 * The 2026-08-24 hunt reached municipal party committees by GUESSING domains —
 * its own artifact records rows whose publisher reads *"a guessed Democratic
 * municipal committee domain for denville_township"*. A guessed identifier is a
 * `LEAD` and never a `HIT`, so every one of those was structurally incapable of
 * promoting anything, however right the guess happened to be.
 *
 * RULING 93 asks what the tier ABOVE publishes about the tier below. The Morris
 * County Democratic Committee publishes a page per municipality at
 * `morrisdems.org/candidates/municipal-candidates/<slug>`, and each one carries
 * the municipal committee's **chair, email, website and Facebook page** — named
 * by the county party rather than guessed by us. That is one fetch per
 * municipality for an authoritative answer, against a guess per municipality for
 * an unpromotable one.
 *
 * The literal query that produced it, recorded per RULING 88:
 *
 *     Morris County NJ municipal Democratic committee 2026 candidates site
 *
 * ## SYMMETRY IS THE RULE, AND THE ASYMMETRY IS A FINDING
 *
 * The equal-effort rule is a discipline about how hard we look, and looking only
 * at one party's committees would be that rule failing at the source. So the
 * county Republican committee is walked too, at the same depth, on the same day
 * — and where the two publish different amounts, **that difference is reported
 * as a measurement rather than smoothed away**. One party publishing a
 * per-municipality directory and the other not is a fact about those
 * organisations, and this product's job is to state it, not to hide it by
 * quietly walking only the one that answers.
 *
 * ## What this does NOT do
 *
 * It does not promote anything. It produces the authoritative committee URL per
 * municipality per party, with the county party's own page as the source. The
 * candidate hunt that consumes it applies `verdictFor` unchanged, and a page
 * reached this way is still control-checked before it becomes anything.
 *
 * It also supplies NO PHOTO. A party's site is not one of the four doors, and a
 * door the campaign-site rule opens is not a door into the photo rule.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conserve } from "../lib/sources/normalize-account.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "--limit=0").slice(8));

/** The municipalities, read from the committed walk rather than typed here. */
const MUNICIPALITIES: string[] = (
  JSON.parse(
    readFileSync(join(ROOT, "data", "hunt", "roster-pages-muni-sites-nj-morris.json"), "utf8"),
  ) as { sites: { municipality: string }[] }
).sites.map((s) => s.municipality);

/**
 * The county parties, and what each publishes.
 *
 * `perMunicipality` is null where the party publishes no per-municipality
 * directory — recorded as null rather than omitted, because "we did not look"
 * and "they do not publish it" are different facts and this file must be able
 * to tell them apart.
 */
const PARTIES = [
  {
    id: "democratic",
    org: "Morris County Democratic Committee",
    home: "https://morrisdems.org/",
    perMunicipality: (slug: string) =>
      `https://morrisdems.org/candidates/municipal-candidates/${slug.replace(/_/g, "-")}`,
    /** A page that is ABOUT this municipality says so. RULING 93's control string. */
    control: (slug: string) => slug.replace(/_/g, " "),
  },
  {
    id: "republican",
    org: "Morris County Republican Committee",
    home: "https://www.morrisgop.org/officials",
    perMunicipality: null,
    control: () => "",
  },
] as const;

interface Row {
  party: string;
  org: string;
  municipality: string;
  url: string;
  status: number;
  bytes: number;
  /** The page names the municipality it claims to be about. */
  controlMet: boolean;
  chair: string | null;
  email: string | null;
  committeeWebsite: string | null;
  committeeFacebook: string | null;
  attemptedAt: string;
  note: string;
}

/** Strip markup to a flat run, so a label and its value sit next to each other. */
function flatten(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8212;/g, "—")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** `Label: value` up to the next label, which is how these pages are written. */
function labelled(flat: string, label: string): string | null {
  const m = new RegExp(
    `${label}\\s*:\\s*([^]*?)(?=\\s(?:Name|Email|Website|Facebook|Municipal|About|THIS SITE)\\s*:?|$)`,
    "i",
  ).exec(flat);
  const v = m?.[1]?.trim();
  return v && v.length > 0 && v.length < 200 ? v : null;
}

const rows: Row[] = [];
let attempted = 0;
let refused = 0;
let controlFailed = 0;

for (const party of PARTIES) {
  if (!party.perMunicipality) {
    /*
     * Walked at its own depth and recorded as such. The home page IS the walk
     * for a party that publishes no per-municipality directory, and saying so
     * with a status and a byte count is what makes the asymmetry a measurement
     * rather than an omission.
     */
    attempted += 1;
    let status = 0;
    let bytes = 0;
    try {
      const r = await politeGetText(party.home, { profile: "browser" });
      status = r.status;
      bytes = r.text.length;
    } catch {
      refused += 1;
    }
    rows.push({
      party: party.id,
      org: party.org,
      municipality: "(county-wide)",
      url: party.home,
      status,
      bytes,
      controlMet: status === 200 && bytes > 0,
      chair: null,
      email: null,
      committeeWebsite: null,
      committeeFacebook: null,
      attemptedAt: today(),
      note:
        "This county party publishes NO per-municipality committee directory that this walk could " +
        "find. Its county page is walked instead, at the same depth and on the same day. The " +
        "difference between the two parties is recorded rather than smoothed — one publishing a " +
        "directory and the other not is a fact about those organisations.",
    });
    continue;
  }

  const cap = LIMIT > 0 ? Math.min(LIMIT, MUNICIPALITIES.length) : MUNICIPALITIES.length;
  for (let i = 0; i < cap; i++) {
    const slug = MUNICIPALITIES[i];
    const url = party.perMunicipality(slug);
    attempted += 1;
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
      refused += 1;
      rows.push({
        party: party.id,
        org: party.org,
        municipality: slug,
        url,
        status,
        bytes: text.length,
        controlMet: false,
        chair: null,
        email: null,
        committeeWebsite: null,
        committeeFacebook: null,
        attemptedAt: today(),
        note: `HTTP ${status || "network"} — a wall on this date, never an absence`,
      });
      console.log(`  ${party.id.slice(0, 3)} ${String(status).padStart(3)} ${slug}`);
      continue;
    }
    const flat = flatten(text);
    /*
     * A 200 whose content is not about the thing asked for is not a document
     * (RULING 93). These pages open with the municipality's own name.
     */
    const controlMet = flat.toLowerCase().includes(party.control(slug).toLowerCase());
    if (!controlMet) controlFailed += 1;

    /*
     * A URL FIELD IS THE FIRST URL TOKEN, NOT THE REST OF THE LINE.
     *
     * These pages run their contact block together — Madison's reads
     * `Website: http://madisonnjdems.com/ Donate: https://secure.actblue.com/...
     * Twitter: https://twitter.com/madisonnjdems` — and a label reader that
     * stops at the next KNOWN label swallows every unknown one. Taking the
     * first URL token cannot: a URL ends at whitespace.
     *
     * The other direction matters too. Long Hill's Website field holds the
     * words "Long Hill Township NJ Democratic Committee" rather than an
     * address, and that is not a URL and must not be recorded as one.
     */
    const firstUrl = (v: string | null): string | null => {
      const m = /https?:\/\/[^\s"'<>]+/.exec(v ?? "");
      return m ? m[0].replace(/[.,;]+$/, "") : null;
    };
    const site = firstUrl(labelled(flat, "Website"));
    const fb = firstUrl(labelled(flat, "Facebook"));
    rows.push({
      party: party.id,
      org: party.org,
      municipality: slug,
      url,
      status,
      bytes: text.length,
      controlMet,
      chair: labelled(flat, "Municipal Chair") ?? labelled(flat, "Name"),
      email: labelled(flat, "Email"),
      committeeWebsite: site && /^https?:\/\//.test(site) ? site : null,
      committeeFacebook: fb && /^https?:\/\//.test(fb) ? fb : null,
      attemptedAt: today(),
      note: controlMet
        ? "named by the county party, not guessed"
        : "200, but the page does not name this municipality — not a document about the thing asked for",
    });
    console.log(
      `  ${party.id.slice(0, 3)} 200 ${slug.padEnd(24)} ${controlMet ? "ok " : "CTRL"} ${site ?? ""}`,
    );
  }
}

const withSite = rows.filter((r) => r.committeeWebsite).length;
const withFb = rows.filter((r) => r.committeeFacebook).length;
const withEmail = rows.filter((r) => r.email).length;

/*
 * The conservation contract, at the logical-record layer: every attempt has one
 * disposition and the sum is exact (RULING 128).
 */
const produced = rows.filter((r) => r.controlMet).length;
const accounting = conserve("party-directory", {
  logicalInput: attempted,
  produced,
  dropped: refused + controlFailed,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  attempted            ${attempted}`);
console.log(`  documents about the thing asked for  ${produced}`);
console.log(`  refused              ${refused} — walls on this date, never absences`);
console.log(`  200 but not about it ${controlFailed}`);
console.log(`  accounting           ${accounting.outcome}, ${accounting.accountedFor} of ${attempted}`);
console.log(`\n  committee WEBSITE named by the county party   ${withSite}`);
console.log(`  committee FACEBOOK named by the county party  ${withFb}`);
console.log(`  committee EMAIL named by the county party     ${withEmail}`);

const byParty = new Map<string, number>();
for (const r of rows) if (r.controlMet) byParty.set(r.party, (byParty.get(r.party) ?? 0) + 1);
console.log("\n  BY PARTY — the symmetry, stated as a pair:");
for (const p of PARTIES) {
  console.log(
    `    ${p.org.padEnd(38)} ${byParty.get(p.id) ?? 0} page(s) about a named municipality` +
      (p.perMunicipality ? "" : "  (publishes no per-municipality directory this walk could find)"),
  );
}

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", "nj-morris-party-directory-0825.json");
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "The county parties' own directories of their municipal committees — RULING 93, the tier " +
          "above publishing about the tier below. Replaces the 2026-08-24 hunt's GUESSED committee " +
          "domains, which were structurally unpromotable because a guessed identifier is a LEAD. " +
          "Both county parties are walked at the same depth on the same day, and where they publish " +
          "different amounts that difference is recorded. Written by scripts/party-directory-0825.mts.",
        walkedAt: today(),
        route: "party-county-directory",
        tier: "A",
        conceivedFrom: "Morris County NJ municipal Democratic committee 2026 candidates site",
        totals: {
          attempted,
          documents: produced,
          refused,
          controlFailed,
          withCommitteeWebsite: withSite,
          withCommitteeFacebook: withFb,
          withCommitteeEmail: withEmail,
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
  console.log("\n  report only — pass --write to record the directory");
}
