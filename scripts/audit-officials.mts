import { rosterPath } from "../lib/holdings/files.ts";
/**
 * The Kelly-standard audit (session 2026-08-16, item 2a).
 *
 *   pnpm officials:audit
 *
 * The Mark Kelly card is the standard: photo, phone, working contact (form or
 * email), the SPECIFIC official page, campaign site — all present and correct.
 * This script audits every DIVISION-LINKED officeholder (the ones a reader
 * can actually open) across the federal roster and the three state files,
 * checks the five fields, and FETCH-VERIFIES the official page: a URL that
 * 404s, or that returns a page not containing the member's surname, is a
 * MISS, not a citation.
 *
 * Requests are serialized with a delay, sent with the project's identified
 * UA. **No host is skipped.** Until 2026-08-21 this script refused to fetch
 * gc.nh.gov at all, on the strength of a TLS refusal measured 2026-08-17, and
 * reported 84 New Hampshire officials as unverifiable on every run without
 * asking. RULING 52: a wall is a measurement with a date, never a standing
 * property — and a wall compiled into a skip can never be disproved by the
 * instrument that records it. Every page is now requested; a refusal is
 * recorded as the failure it was, on the day it happened.
 *
 * Output: the table on stdout AND docs/officials-audit.md, dated. The table
 * is the release evidence the brief demands — per official, which of the
 * five Kelly fields is present/verified.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COVERED, rosterFile } from "../lib/coverage/artifacts.ts";
import { CAMPAIGN_SITES } from "../lib/officials/campaign-sites.ts";
import { generatedAtEastern } from "./generated-at.mjs";
import { today } from "./doc-dates.mjs";

const UA = "we-the-people civic meeting index (contact: seanj22@gmail.com)";
const DELAY_MS = 250;

interface Officeholder {
  id: string;
  name: string;
  officeTitle: string;
  websiteUrl: string | null;
  contactFormUrl: string | null;
  phone: string | null;
  email: string | null;
  campaignUrl: string | null;
  photo: { url: string; license: string | null } | null;
  /** Two-letter USPS code, for naming an unlinked member by where they serve. */
  state?: string;
}

interface OfficeholderSet {
  scope: string;
  officeholders: Officeholder[];
  divisions: { officeholderId: string; ocdId: string }[];
  /** Links the build could not make, each with the division id it looked for. */
  unmatched?: { officeholderId: string; reason: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[.,'"]/g, "")
    .trim();
}

function surname(name: string): string {
  const parts = norm(name).split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

type PageVerdict =
  | "VERIFIED"
  | "VERIFIED-VIA-ROSTER"
  | "MISS-404"
  | "MISS-GENERIC"
  | "MISS-ABSENT"
  | "UNVERIFIABLE-INLINE"
  | "MISS-ERROR";

async function verifyPage(o: Officeholder): Promise<PageVerdict> {
  if (!o.websiteUrl) return "MISS-ABSENT";
  /*
   * **THE HARDCODED WALL, REMOVED** (RULING 52, 2026-08-21).
   *
   * This line read `if (/gc\.nh\.gov/.test(o.websiteUrl)) return
   * "UNVERIFIABLE-INLINE";` — 84 New Hampshire officials were reported as
   * unverifiable on every run without a request ever being made, on the
   * strength of a TLS measurement taken 2026-08-17. Re-walked 2026-08-21:
   * gc.nh.gov answers rung 2 at HTTP 200.
   *
   * A wall compiled into a skip is the worst form of the thing RULING 52 was
   * adopted over, because it cannot be disproved by the instrument that
   * records it: the audit could never notice the wall had fallen, since it had
   * stopped asking. Nothing here is special-cased now. If the host refuses, the
   * request fails and `MISS-ERROR` records the refusal on the day it happened,
   * which is a measurement rather than a property.
   */
  // njleg bio pages are client-rendered SPAs — the served HTML never contains
  // the member's name, so content-sniffing false-negatives every one. The
  // verification chain is the legislature's own server-rendered roster, which
  // names the member beside this exact link and is where the enrichment read
  // it from (scripts/enrich-officials.mts). Confirm the page still serves 200
  // and record the chain honestly rather than claiming a content match.
  if (/njleg\.state\.nj\.us\/legislative-roster\//.test(o.websiteUrl)) {
    try {
      const r = await fetch(o.websiteUrl, {
        headers: { "user-agent": UA },
        redirect: "follow",
      });
      return r.status === 200 ? "VERIFIED-VIA-ROSTER" : "MISS-404";
    } catch {
      return "MISS-ERROR";
    }
  }
  try {
    const r = await fetch(o.websiteUrl, {
      headers: { "user-agent": UA },
      redirect: "follow",
    });
    if (r.status !== 200) return "MISS-404";
    const text = await r.text();
    // The page must name the member — a 200 that lands on a generic index is
    // the author's Diaz defect, and it must not score as a citation.
    return new RegExp(surname(o.name), "i").test(norm(text)) ? "VERIFIED" : "MISS-GENERIC";
  } catch {
    return "MISS-ERROR";
  }
}

async function main() {
  // The manifest, not a fourth copy of it (AUD-06, g18).
  const files = [
    { label: "US (federal)", file: "officeholders-us.json" },
    ...COVERED.map((s) => ({ label: s.usps, file: rosterFile(s) })),
  ];

  const lines: string[] = [
    "# Officials audit — the Kelly standard",
    "",
    // R18: generated-at lines on generated documents carry Eastern.
    `Generated ${generatedAtEastern()} by \`pnpm officials:audit\`.`,
    "",
    "Five fields per official: **page** (specific official page, fetch-verified to",
    "name the member), **contact** (form or email present), **phone**, **photo**",
    "(cleared license only — state portraits are blocked on unhunted reuse terms,",
    "recorded in the ladder, so a state MISS here is the recorded rule working,",
    "not an oversight), **campaign** (verified campaign site). Only division-",
    "linked officials are audited — the ones a reader can open.",
    "",
  ];

  const totals = { officials: 0, pageVerified: 0, pageMiss: 0, pageUnverifiable: 0 };

  for (const { label, file } of files) {
    const set = JSON.parse(
      readFileSync(join(process.cwd(), rosterPath(file)), "utf8"),
    ) as OfficeholderSet;
    const linked = new Set(set.divisions.map((d) => d.officeholderId));
    const audited = set.officeholders.filter((o) => linked.has(o.id));

    lines.push(`## ${label} — ${audited.length} division-linked of ${set.officeholders.length}`);
    lines.push("");
    /*
     * **THE REMAINDER IS NAMED** (Prompt D item 5, 2026-08-20).
     *
     * "531 division-linked of 537" stood in this file since 2026-08-14 with
     * nothing saying what the six were, and a stated number with an
     * unexplained remainder is a margin. Six people could have been six
     * delegates or six members our own join dropped, and the document read
     * identically either way. The build already records WHY each link was
     * dropped, per the operation-count rule; this prints it.
     */
    const unlinked = set.officeholders.filter((o) => !linked.has(o.id));
    if (unlinked.length > 0) {
      const why = new Map(
        (set.unmatched ?? []).map((u) => [u.officeholderId, u.reason] as const),
      );
      lines.push(
        `**The ${unlinked.length} not audited, named** — a reader cannot open these, ` +
          `and the count above must not stand as an unexplained margin:`,
      );
      lines.push("");
      for (const o of unlinked) {
        lines.push(`- ${o.name} (${o.state ?? "?"}) — ${why.get(o.id) ?? "no reason recorded"}`);
      }
      lines.push("");
    }
    lines.push("| Official | Office | Page | Contact | Phone | Photo | Campaign |");
    lines.push("|---|---|---|---|---|---|---|");

    for (const o of audited) {
      const verdict = await verifyPage(o);
      await sleep(DELAY_MS);
      const contact = o.contactFormUrl ? "form" : o.email ? "email" : "MISS";
      const phone = o.phone ? "yes" : "MISS";
      const photo = o.photo && o.photo.license ? "yes" : "none (license rule)";
      const campaign = o.campaignUrl || CAMPAIGN_SITES[o.id] ? "yes" : "not found yet";
      lines.push(
        `| ${o.name} | ${o.officeTitle} | ${verdict} | ${contact} | ${phone} | ${photo} | ${campaign} |`,
      );
      totals.officials++;
      if (verdict === "VERIFIED" || verdict === "VERIFIED-VIA-ROSTER") {
        totals.pageVerified++;
      } else if (verdict === "UNVERIFIABLE-INLINE") totals.pageUnverifiable++;
      else totals.pageMiss++;
      process.stdout.write(
        `${label}  ${o.name.padEnd(28)} page:${verdict.padEnd(20)} contact:${contact.padEnd(6)} phone:${phone.padEnd(5)} campaign:${campaign}\n`,
      );
    }
    lines.push("");
  }

  lines.push("## Totals");
  lines.push("");
  lines.push(
    /*
     * RULING 52 (2026-08-21): a wall carries the date it was last tested. This
     * line used to end "(gc.nh.gov TLS wall — the recorded rung, not a pass)",
     * which stated a 2026-08-17 measurement as a standing property of the host
     * — and gc.nh.gov answers rung 2 at HTTP 200 as of 2026-08-21. Every run of
     * this script was re-publishing a wall that had fallen. It now names the
     * date the run happened and says nothing about why, because the reason is a
     * per-row fact and the rows above carry it.
     */
    `${totals.officials} officials audited: ${totals.pageVerified} pages fetch-verified, ` +
      `${totals.pageMiss} page misses, ${totals.pageUnverifiable} unverifiable inline ` +
      `as of ${today()} — see each row for the rung it stopped at.`,
  );
  lines.push("");

  const out = join(process.cwd(), "docs", "officials-audit.md");
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nwrote ${out}`);
  console.log(
    `totals: ${totals.officials} audited · ${totals.pageVerified} verified · ${totals.pageMiss} misses · ${totals.pageUnverifiable} unverifiable-inline`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
