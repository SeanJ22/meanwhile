#!/usr/bin/env tsx
/**
 * **WIRING THE FINAL PASS'S FINDS ONTO THE CARDS THAT RENDER THEM.**
 * (2026-08-25. Serves the campaign-site and verified-page fields at 07866.)
 *
 * ```
 * pnpm wire:0825            # report what would change, write nothing
 * pnpm wire:0825 --write
 * ```
 *
 * ## Collection and rendering are a PAIR
 *
 * A session that promotes ten sites and wires none has moved one number and not
 * the other, and a report stating only the first is describing work a reader
 * cannot see. So this is its own step, it prints both numbers, and it refuses
 * rather than guessing when the two sides do not line up.
 *
 * ## No new surface
 *
 * `data/ballot/candidate-links-2026.json` already carries `official` and
 * `campaign` slots per candidacy and `lib/ballot/candidate-sites.ts` already
 * reads them — checked before writing anything, because RULING 63 makes
 * building a route that already exists a reported defect.
 *
 * ## THE THREE KINDS, AND WHY THEY DO NOT SHARE A SLOT
 *
 * - A **campaign site** — the candidate's own domain, carrying a paid-for-by
 *   disclaimer — goes to `campaign` with no label. The card's default reads
 *   "campaign site", and that is exactly what it is.
 * - A **page the candidate's own party publishes about them** goes to
 *   `official` **with the host named in the label**. RULING 122: it renders as
 *   the page their party publishes about them, never dressed as their own site.
 *   A reader is told what they are being sent to and left to judge it.
 * - A page an **opposing** party publishes about them is neither, and is not
 *   written at all. It is a real document and it is not that candidate's page,
 *   and rendering it as one would be this product characterising a person by
 *   way of who wrote about them.
 *
 * ## The join is asserted, never trusted
 *
 * Every id written must resolve to a candidacy on the committed ballot, and this
 * REFUSES to write when one does not, naming it (RULING 111). Both source
 * artifacts carry the candidacy id directly — they were built by testing against
 * the ballot — so a mismatch means the ballot moved underneath them and the
 * right answer is to re-run the hunts rather than to write a dangling key.
 *
 * ## Nothing here supplies a PHOTO
 *
 * A party's site is not one of the four doors, and a door the campaign-site rule
 * opens is not a door into the photo rule.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");

const LINKS = join(ROOT, "data", "ballot", "candidate-links-2026.json");
const ADJUDICATION = join(ROOT, "data", "hunt", "lead-adjudication-07866-0825.json");
const PARTY_PAGES = join(ROOT, "data", "hunt", "nj-morris-party-pages-0825.json");

for (const f of [LINKS, ADJUDICATION, PARTY_PAGES]) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — run the hunts first`);
    process.exit(1);
  }
}

interface VerifiedLink {
  url: string;
  verification: string;
  attemptedAt: string;
  label?: string;
}
interface LinksFile {
  curatedAt: string;
  note: string;
  links: Record<string, { official?: VerifiedLink | null; campaign?: VerifiedLink | null }>;
  hunts: { key: string; name: string; note: string; attemptedAt: string }[];
}

const linksFile = JSON.parse(readFileSync(LINKS, "utf8")) as LinksFile;
const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
  candidacies: { id: string; givenName: string; familyName: string; partyLabel: string | null }[];
};
const onBallot = new Map(ballot.candidacies.map((c) => [c.id, c]));

const adjudication = JSON.parse(readFileSync(ADJUDICATION, "utf8")) as {
  walkedAt: string;
  verdicts: {
    host: string;
    url: string;
    outcome: string;
    detail: string;
    subject: string | null;
    candidacyId: string | null;
  }[];
};
const partyPages = JSON.parse(readFileSync(PARTY_PAGES, "utf8")) as {
  walkedAt: string;
  verifiedPages: { candidacyId: string; url: string; org: string }[];
  rows: { url: string; municipality: string; party: string; verifiedPageFor: string[] }[];
};

/** `morris_plains` + `democratic` -> `the Morris Plains Democratic committee's page`. */
function committeeLabel(municipality: string, party: string): string {
  const place = municipality
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const p = party === "republican" ? "Republican" : "Democratic";
  return `the ${place} ${p} committee's page`;
}

interface Change {
  candidacyId: string;
  subject: string;
  slot: "campaign" | "official";
  url: string;
  label?: string;
  replaced: string | null;
  /** What the HTTPS measurement found, appended to the verification sentence. */
  httpsNote?: string;
}
const changes: Change[] = [];
const refused: string[] = [];

/* ── campaign sites, from the inversion ─────────────────────────────────── */
for (const v of adjudication.verdicts) {
  if (v.outcome !== "HIT" || !v.candidacyId) continue;
  const c = onBallot.get(v.candidacyId);
  if (!c) {
    refused.push(`${v.candidacyId} (${v.subject}) — promoted for ${v.host} but not on the committed ballot`);
    continue;
  }
  const existing = linksFile.links[v.candidacyId]?.campaign?.url ?? null;
  /*
   * SAME SITE, DIFFERENT SPELLING, IS NOT A FIND.
   *
   * The inversion normalises hosts by stripping `www.`, so it returns
   * `https://analiliafornj.com/` where the committed link reads
   * `https://www.analiliafornj.com`. Writing that would restamp a verification
   * date on a link nobody re-derived anything about, and churn a diff for a
   * slash — RULING 107's shape, one layer over: a stamp that moves without the
   * fact behind it moving.
   */
  const sameHost = (a: string | null, b: string): boolean => {
    if (!a) return false;
    try {
      return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");
    } catch {
      return a === b;
    }
  };
  if (sameHost(existing, v.url)) continue;
  changes.push({
    candidacyId: v.candidacyId,
    subject: `${c.givenName} ${c.familyName}`,
    slot: "campaign",
    url: v.url,
    replaced: existing,
  });
}

/* ── party-hosted pages, RULING 122, with the host named ────────────────── */
const pageOf = new Map<string, { municipality: string; party: string }>();
for (const r of partyPages.rows) {
  for (const id of r.verifiedPageFor) {
    if (!pageOf.has(id)) pageOf.set(id, { municipality: r.municipality, party: r.party });
  }
}
for (const v of partyPages.verifiedPages) {
  const c = onBallot.get(v.candidacyId);
  if (!c) {
    refused.push(`${v.candidacyId} — a party page named them but they are not on the committed ballot`);
    continue;
  }
  const existing = linksFile.links[v.candidacyId]?.official?.url ?? null;
  if (existing) continue; // an official page already held is the better claim
  const where = pageOf.get(v.candidacyId);
  changes.push({
    candidacyId: v.candidacyId,
    subject: `${c.givenName} ${c.familyName}`,
    slot: "official",
    url: v.url,
    label: where ? committeeLabel(where.municipality, where.party) : "their party's page about them",
    replaced: null,
  });
}

console.log(`\nWIRING THE FINAL PASS — ${today()}\n`);
console.log(`  campaign sites promoted by the inversion   ${adjudication.verdicts.filter((v) => v.outcome === "HIT").length}`);
console.log(`  party pages meeting RULING 122's bar       ${partyPages.verifiedPages.length}`);
console.log(`  changes to write                           ${changes.length}`);
console.log(`  refused — not on the committed ballot      ${refused.length}`);
for (const r of refused) console.log(`      ${r}`);

if (refused.length > 0) {
  console.error(
    "\n  REFUSING TO WRITE. A promoted row does not resolve to a candidacy on the committed ballot, " +
      "which means the ballot moved underneath the hunts. Re-run them rather than writing a dangling key.",
  );
  process.exit(1);
}

console.log("");
for (const ch of changes) {
  console.log(
    `  ${ch.slot.padEnd(9)} ${ch.subject.padEnd(26)} ${ch.url}${ch.label ? `  [${ch.label}]` : ""}${ch.replaced ? `  (was ${ch.replaced})` : ""}`,
  );
}

if (!WRITE) {
  console.log("\n  report only — pass --write to wire these onto the cards");
  process.exit(0);
}

/**
 * HTTPS IS MEASURED, NEVER ASSUMED — in either direction.
 *
 * The county party's directory publishes some committee sites with an `http://`
 * spelling; `madisonnjdems.com` is written that way and answers HTTPS with 133 KB
 * of a real page. Writing the published spelling would send every reader to
 * plain HTTP for no reason, and `tests/candidate-links.test.ts` refuses an
 * `http://` link that does not RECORD that HTTPS was measured and refused.
 *
 * So it is measured, once per URL, and the answer decides. Where HTTPS answers,
 * the link is HTTPS. Where it genuinely refuses, the link stays HTTP and the
 * verification sentence says the measurement was made — which is the carve-out
 * the guard was built with, for `garykapner.com`, and not a loosening of it.
 */
async function preferHttps(url: string): Promise<{ url: string; note: string }> {
  if (!url.startsWith("http://")) return { url, note: "" };
  const https = url.replace(/^http:\/\//, "https://");
  try {
    const r = await fetch(https, {
      headers: { "user-agent": "we-the-people/1.0 (civic data; seanj22@gmail.com)" },
      redirect: "follow",
    });
    const body = await r.text();
    if (r.ok && body.length > 0) {
      return { url: https, note: ` HTTPS answered ${r.status} with ${body.length} B, so this is the HTTPS address.` };
    }
    return {
      url,
      note: ` HTTPS was measured on ${today()} and refused (HTTP ${r.status}), so the plain-HTTP address is what this site serves.`,
    };
  } catch (e) {
    return {
      url,
      note: ` HTTPS was measured on ${today()} and refused (${(e as Error).message}), so the plain-HTTP address is what this site serves.`,
    };
  }
}

for (const ch of changes) {
  const measured = await preferHttps(ch.url);
  ch.url = measured.url;
  ch.httpsNote = measured.note;
}

const before = {
  official: Object.values(linksFile.links).filter((l) => l.official).length,
  campaign: Object.values(linksFile.links).filter((l) => l.campaign).length,
};

for (const ch of changes) {
  const row = linksFile.links[ch.candidacyId] ?? {};
  const link: VerifiedLink = {
    url: ch.url,
    verification:
      ch.slot === "campaign"
        ? `Read ${adjudication.walkedAt}: the page names ${ch.subject}, is about standing for office, and carries a paid-for-by disclaimer — a campaign committee's own communication.${ch.httpsNote ?? ""}`
        : `Read ${partyPages.walkedAt}: ${ch.label} — it names ${ch.subject}, the office, and a way to reach them. RULING 122: rendered with the host named, never as their own site.${ch.httpsNote ?? ""}`,
    attemptedAt: ch.slot === "campaign" ? adjudication.walkedAt : partyPages.walkedAt,
    ...(ch.label ? { label: ch.label } : {}),
  };
  /*
   * BOTH SLOTS EXIST, AND THE ABSENT ONE IS `null` RATHER THAN MISSING.
   *
   * `tests/candidate-links.test.ts` reads `entry[side]` and skips on `=== null`
   * — an `undefined` slot falls straight through to `link.url` and throws. A
   * new row that carried only the slot being written produced exactly that.
   * The two states are not the same thing anywhere in this repo: `null` is "we
   * looked and there is none", missing is "nobody has said".
   */
  row.official = ch.slot === "official" ? link : (row.official ?? null);
  row.campaign = ch.slot === "campaign" ? link : (row.campaign ?? null);
  linksFile.links[ch.candidacyId] = row;
}
linksFile.curatedAt = today();

const after = {
  official: Object.values(linksFile.links).filter((l) => l.official).length,
  campaign: Object.values(linksFile.links).filter((l) => l.campaign).length,
};

writeFileSync(LINKS, `${JSON.stringify(linksFile, null, 2)}\n`, "utf8");

console.log(`\n  COLLECTION AND RENDERING, AS A PAIR:`);
console.log(`    official pages   ${before.official} -> ${after.official}`);
console.log(`    campaign sites   ${before.campaign} -> ${after.campaign}`);
console.log(`\n  written ${LINKS}`);
