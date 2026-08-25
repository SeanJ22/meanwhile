#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — every clock stamp in this file is minted by the code path that
 * performs the read. `attemptedAt` and `walkedAt` are taken in the same run
 * that fetched the page they describe, which is what the ruling asks for rather
 * than what it forbids: a READ stamp from evidence of a read, never a RUN stamp
 * written into a freshness field. Declared rather than inferred, because a
 * carve-out nobody has to write down is a carve-out that grows.
 */
/**
 * **THE REPUBLICAN MUNICIPAL COMMITTEES, BY DOMAIN SHAPE.**
 * (The final pass, 2026-08-25 — the equal-effort obligation made operational.)
 *
 * ```
 * pnpm gop:shape                 # probe and report, write nothing
 * pnpm gop:shape --write
 * ```
 *
 * ## Why this exists, and it is the equal-effort rule doing work
 *
 * `pnpm party:directory` walked both county parties at the same depth on the
 * same day. The Morris County Democratic Committee publishes a page per
 * municipality naming each committee's website; the Morris County Republican
 * Committee publishes no such directory. The consequence, measured: **17
 * Democratic verified pages and 0 Republican.**
 *
 * That number is not a fact about the candidates. It is a fact about which
 * county organisation publishes a directory, and shipping it would put the
 * information asymmetry the equal-effort rule exists to catch straight onto the
 * ballot page — every Democrat with a page, every Republican without one.
 *
 * **The correct response to an incomplete hunt is more hunting**, so this is the
 * second branch to the same fact: RULING 94's third move, *what did entities of
 * this same shape do?* A general search found `randolphrepublicans.org` — the
 * Randolph Republican Club, with `/campaigns` and `/elected-officials` pages.
 * If one town's Republican committee is at that shape, the other thirty-eight
 * may be.
 *
 * The literal query that produced the seed, recorded per RULING 88:
 *
 *     Randolph NJ Republican Committee 2026 council candidates
 *
 * ## A GUESSED DOMAIN IS NOT A GUESSED IDENTITY, AND THE DIFFERENCE IS THE PAGE
 *
 * RULING 68 makes a page found at a GUESSED handle a `LEAD`, because whose page
 * it is remains unestablished. That reasoning is about a handle on a platform,
 * where any account could sit behind any name.
 *
 * A domain is different, and the difference is what the page itself says. This
 * records the shape as the DISCOVERY method and lets the CONTENT decide: a page
 * that names itself the town's Republican organisation, names candidates the
 * county clerk certified for that town, and carries a paid-for-by disclaimer has
 * established what it is regardless of how its URL was arrived at. A page that
 * does not is a `LEAD` and stays one.
 *
 * Every probe is control-checked first — this host's own answer for a path that
 * cannot exist — because a parked domain and a squatter's page both answer 200.
 *
 * ## This supplies NO PHOTO
 *
 * A party's site is not one of the four doors.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyCampaignPage,
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

const MUNICIPALITIES: string[] = (
  JSON.parse(
    readFileSync(join(ROOT, "data", "hunt", "roster-pages-muni-sites-nj-morris.json"), "utf8"),
  ) as { sites: { municipality: string }[] }
).sites.map((s) => s.municipality);

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string; partyLabel: string | null }[];
};
const contestById = new Map(ballot.contests.map((c) => [c.id, c]));

/**
 * The shapes, seeded by the one that was FOUND rather than invented.
 *
 * `randolphrepublicans.org` is the proven instance. The rest are the same shape
 * over the alternatives a small committee actually registers. Each is probed and
 * the result recorded whether it answers or not — a shape that returns nothing
 * across thirty-nine towns is a reported finding about how those committees
 * publish, not a failure (RULING 88).
 */
const SHAPES = [
  (t: string) => `https://${t}republicans.org/`,
  (t: string) => `https://${t}republicans.com/`,
  (t: string) => `https://${t}gop.org/`,
  (t: string) => `https://${t}gop.com/`,
  (t: string) => `https://${t}njgop.org/`,
];

/** `boonton_township` -> `boonton`, which is how these domains are actually named. */
function token(slug: string): string {
  return slug.replace(/_(township|borough|town)$/, "").replace(/_/g, "");
}

interface Row {
  municipality: string;
  url: string;
  shape: string;
  status: number;
  bytes: number;
  control: number;
  beyondControl: boolean;
  selfId: string[];
  officeEvidence: string[];
  pageKind: string;
  pageKindWhy: string;
  /** Republican candidacies from THIS municipality that the page names strongly. */
  namesOwnTownCandidates: { candidacyId: string; subject: string }[];
  attemptedAt: string;
  note: string;
}

console.log(`\nREPUBLICAN MUNICIPAL COMMITTEES, BY SHAPE — ${today()}\n`);
console.log(`  municipalities   ${MUNICIPALITIES.length}`);
console.log(`  shapes per town  ${SHAPES.length}`);
console.log(`  probes           ${MUNICIPALITIES.length * SHAPES.length}\n`);

const rows: Row[] = [];
let attempted = 0;
let answered = 0;
let refused = 0;

for (const slug of MUNICIPALITIES) {
  const t = token(slug);
  /* This town's own Republican candidacies, from the certified filing. */
  const own = ballot.candidacies.filter((c) => {
    if (c.partyLabel !== "Republican") return false;
    const ct = contestById.get(c.contestId);
    return Boolean(ct && ct.ocdId.includes(`place:${t}`));
  });

  for (const shape of SHAPES) {
    const url = shape(t);
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
      continue;
    }
    answered += 1;

    let control = -1;
    try {
      const c = await politeGetText(`${new URL(url).origin}/${CONTROL_IDENTIFIER}`, { profile: "browser" });
      control = c.status === 200 ? c.text.length : -1;
    } catch {
      control = -1;
    }
    const past = beyondControl(text.length, control);
    const flat = flattenForEvidence(text);
    const selfId = partyOrganSelfIdIn(flat);
    const office = officeEvidenceIn(flat);
    const kind = classifyCampaignPage({ officeEvidence: office, partyOrganSelfId: selfId });

    const named = own
      .filter((c) =>
        matchNameForms(`${c.givenName} ${c.familyName}`.trim(), flat).some(
          (f) => f.matched && f.kind !== "surname",
        ),
      )
      .map((c) => ({ candidacyId: c.id, subject: `${c.givenName} ${c.familyName}` }));

    rows.push({
      municipality: slug,
      url,
      shape: shape("<town>"),
      status,
      bytes: text.length,
      control,
      beyondControl: past,
      selfId,
      officeEvidence: office,
      pageKind: kind.kind,
      pageKindWhy: kind.why,
      namesOwnTownCandidates: named,
      attemptedAt: today(),
      note: !past
        ? `200 with ${text.length} B, indistinguishable from this host's answer for a path that cannot exist (${control} B) — a parked or catch-all domain`
        : named.length > 0
          ? `names ${named.length} of this town's ${own.length} filed Republican candidate(s)`
          : `a live page at this shape, naming none of this town's ${own.length} filed Republican candidate(s)`,
    });
    console.log(
      `  ${slug.padEnd(22)} ${String(text.length).padStart(7)} B  ${past ? "doc " : "PARK"} ${named.length ? `${named.length} name(s)` : ""}  ${url}`,
    );
  }
}

const documents = rows.filter((r) => r.beyondControl);
const naming = rows.filter((r) => r.namesOwnTownCandidates.length > 0);
const namedIds = new Set(naming.flatMap((r) => r.namesOwnTownCandidates.map((n) => n.candidacyId)));

const accounting = conserve("gop-municipal-shape", {
  logicalInput: attempted,
  produced: answered,
  dropped: refused,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  probes attempted        ${attempted}`);
console.log(`  answered 200            ${answered}`);
console.log(`  did not answer          ${refused}`);
console.log(`  accounting              ${accounting.outcome}, ${accounting.accountedFor} of ${attempted}`);
console.log(`\n  live documents          ${documents.length}`);
console.log(`  parked or catch-all     ${answered - documents.length}`);
console.log(`  naming a filed Republican from their own town  ${naming.length} page(s), ${namedIds.size} candidate(s)`);

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", "nj-morris-gop-municipal-shape-0825.json");
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "The Republican municipal committees of Morris County, reached by DOMAIN SHAPE because the " +
          "county Republican committee publishes no per-municipality directory and the county " +
          "Democratic committee does. Seeded by randolphrepublicans.org, found with the literal query " +
          '"Randolph NJ Republican Committee 2026 council candidates". Every probe is control-checked; ' +
          "the shape is the DISCOVERY method and the page's own content is what establishes it. A " +
          "shape returning nothing is a reported finding about how these committees publish, not a " +
          "failure. Written by scripts/gop-municipal-shape-0825.mts.",
        walkedAt: today(),
        route: "party-municipal-committee-gop-shape",
        tier: "B",
        symmetricWith: "party-county-directory",
        totals: {
          municipalities: MUNICIPALITIES.length,
          shapes: SHAPES.length,
          attempted,
          answered,
          refused,
          documents: documents.length,
          parked: answered - documents.length,
          pagesNamingOwnTownCandidates: naming.length,
          candidatesNamed: namedIds.size,
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
  console.log("\n  report only — pass --write to record the probe");
}
