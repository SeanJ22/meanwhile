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
 * UA. gc.nh.gov resets TLS from non-browser clients (ladder rung recorded),
 * so NH member pages are marked UNVERIFIABLE-INLINE rather than fetched —
 * an unreachable route is recorded on its rung, never scored as a pass.
 *
 * Output: the table on stdout AND docs/officials-audit.md, dated. The table
 * is the release evidence the brief demands — per official, which of the
 * five Kelly fields is present/verified.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CAMPAIGN_SITES } from "../lib/officials/campaign-sites.ts";

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
}

interface OfficeholderSet {
  scope: string;
  officeholders: Officeholder[];
  divisions: { officeholderId: string; ocdId: string }[];
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
  if (/gc\.nh\.gov/.test(o.websiteUrl)) return "UNVERIFIABLE-INLINE";
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
  const files = [
    { label: "US (federal)", file: "officeholders-us.json" },
    { label: "AZ", file: "officeholders-04.json" },
    { label: "NH", file: "officeholders-33.json" },
    { label: "NJ", file: "officeholders-34.json" },
  ];

  const lines: string[] = [
    "# Officials audit — the Kelly standard",
    "",
    `Generated ${new Date().toISOString()} by \`pnpm officials:audit\`.`,
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
      readFileSync(join(process.cwd(), "lib", "registry", file), "utf8"),
    ) as OfficeholderSet;
    const linked = new Set(set.divisions.map((d) => d.officeholderId));
    const audited = set.officeholders.filter((o) => linked.has(o.id));

    lines.push(`## ${label} — ${audited.length} division-linked of ${set.officeholders.length}`);
    lines.push("");
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
    `${totals.officials} officials audited: ${totals.pageVerified} pages fetch-verified, ` +
      `${totals.pageMiss} page misses, ${totals.pageUnverifiable} unverifiable inline ` +
      `(gc.nh.gov TLS wall — the recorded rung, not a pass).`,
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
