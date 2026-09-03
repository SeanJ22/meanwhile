import { rosterPath } from "../lib/holdings/files.ts";
/**
 * Enrich the committed state officeholder rosters from the legislatures' OWN
 * member rosters — the Kelly-standard fix for the wrong-URL and dead-email
 * diseases (session 2026-08-16, item 2a).
 *
 *   pnpm officials:enrich
 *
 * Why this exists: the Plural CC-0 bulk CSV carries member-page URLs frozen at
 * the legislature that was sitting when the row was written. Arizona URLs
 * shipped pointing at legislature=55/56 while the 57th sits — the author
 * verified Lupe Diaz's link lands wrong — and New Jersey rows mix caucus sites
 * with official pages. The legislature's live roster is the authority on its
 * own members' pages, so this script reads it and rewrites the contact fields
 * of every member it can match.
 *
 * What it changes, per matched member:
 *   - AZ: websiteUrl (current-legislature member page), phone, contactFormUrl
 *     (the legislature's own email form), email set to null — the roster
 *     publishes a form, not an address, and the CSV address was reported dead.
 *   - NJ: websiteUrl (the njleg.state.nj.us bio page — official, never a
 *     caucus site), contactFormUrl (the roster's ContactLink). Phone and
 *     email stay from the CSV (the njleg.org pattern the legislature itself
 *     publishes).
 *   - NH (2026-08-18, the long way): phone and email from the General
 *     Court's OWN downloadable member directory — gc.nh.gov/downloads/
 *     members.txt — read through the Internet Archive's capture of
 *     2026-04-07, because gc.nh.gov resets TLS handshakes from every
 *     client this environment has (all rungs in docs/source-ladder.md).
 *     The file is the legislature's published directory: name, chamber,
 *     county, district, address, phone, email, party, committees. Members
 *     are matched on chamber + county + district (via the registry's own
 *     Census labels — "State House District Merrimack 08") + name; rows
 *     the directory marks "Former" never match; misses are reported with
 *     the denominator. Photos stay a recorded miss — the member pages
 *     that host them are behind the wall.
 *
 * Matched members get provenance pointing at the roster (which names the
 * member, district, and party — everything rendered), with the Plural CSV
 * remaining the identity source recorded by the builder. Unmatched members
 * keep their Plural fields untouched and are REPORTED with the denominator —
 * an enrichment that edits nothing must say so, never exit 0 silently.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "we-the-people civic meeting index (contact: seanj22@gmail.com)";

interface Officeholder {
  id: string;
  name: string;
  officeTitle: string;
  websiteUrl: string | null;
  contactFormUrl: string | null;
  phone: string | null;
  email: string | null;
  provenance: {
    sourceUrl: string | null;
    sourceOrg: string;
    collectedAt: string;
    verifiedAt: string | null;
  };
}

interface OfficeholderSet {
  officeholders: Officeholder[];
  divisions: { officeholderId: string; ocdId: string }[];
}

/**
 * Normalize for comparison only: lowercase, diacritics stripped (the CSV
 * writes "Hernández", the roster "Hernandez"), suffixes and punctuation
 * dropped. Never used for display — names render exactly as the source
 * publishes them.
 */
function norm(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function surname(name: string): string {
  const parts = norm(name).split(" ");
  return parts[parts.length - 1] ?? "";
}

function firstName(name: string): string {
  return norm(name).split(" ")[0] ?? "";
}

function districtOf(set: OfficeholderSet, id: string): string | null {
  const link = set.divisions.find((d) => d.officeholderId === id);
  const m = link?.ocdId.match(/sld[ul]:(\d+)/);
  return m ? String(Number(m[1])) : null;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (r.status !== 200) throw new Error(`${r.status} from ${url}`);
  return r.text();
}

interface RosterRow {
  memberUrl: string;
  chamber: "upper" | "lower";
  name: string;
  district: string;
  contactFormUrl: string | null;
  phone: string | null;
}

/** Parse www.azleg.gov/memberroster/ — server-rendered, one <tr> per member. */
function parseAzRoster(html: string): RosterRow[] {
  const rows: RosterRow[] = [];
  for (const tr of html.split("<tr").slice(1)) {
    const member = tr.match(
      /href="(https:\/\/www\.azleg\.gov\/(House|Senate)\/[^"]*legislator=\d+)"[^>]*>([^<]+)</,
    );
    if (!member) continue;
    const district = tr.match(/title="District (\d+)"/);
    const emailForm = tr.match(/href="(https:\/\/www\.azleg\.gov\/emailazleg\/\?legislatorId=\d+)"/);
    const phone = tr.match(/\((\d{3})\) (\d{3})-(\d{4})/);
    if (!district) continue;
    rows.push({
      memberUrl: member[1],
      chamber: member[2] === "Senate" ? "upper" : "lower",
      name: member[3].trim(),
      district: String(Number(district[1])),
      contactFormUrl: emailForm ? emailForm[1] : null,
      phone: phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : null,
    });
  }
  return rows;
}

/** Parse the njleg.state.nj.us roster's embedded page data. */
function parseNjRoster(html: string): RosterRow[] {
  const m = html.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("njleg roster: no embedded page data found");
  const data = JSON.parse(m[1]) as {
    props: {
      pageProps: {
        legrosterData: {
          Full_Name: string;
          First_Name: string;
          RosterHouseCode: string;
          Roster_District: number;
          Last_Name: string;
          BioLink: string;
          ContactLink: string | null;
          VacantSort: number;
        }[][];
      };
    };
  };
  const flat = data.props.pageProps.legrosterData.flat();
  return flat
    .filter((r) => r.BioLink && r.VacantSort === 0)
    .map((r) => ({
      memberUrl: `https://www.njleg.state.nj.us${r.BioLink}`,
      chamber: (r.RosterHouseCode === "S" ? "upper" : "lower") as "upper" | "lower",
      name: `${r.First_Name} ${r.Last_Name}`,
      district: String(r.Roster_District),
      contactFormUrl: r.ContactLink ? r.ContactLink.trim() : null,
      phone: null,
    }));
}

function chamberOf(o: Officeholder): "upper" | "lower" {
  return /senator/i.test(o.officeTitle) ? "upper" : "lower";
}

async function enrich(
  fips: string,
  rosterUrl: string,
  rosterOrg: string,
  parse: (html: string) => RosterRow[],
  apply: (o: Officeholder, row: RosterRow) => void,
) {
  const path = join(process.cwd(), rosterPath(`officeholders-${fips}.json`));
  const set = JSON.parse(readFileSync(path, "utf8")) as OfficeholderSet & Record<string, unknown>;
  const rows = parse(await fetchText(rosterUrl));
  if (rows.length === 0) throw new Error(`${rosterUrl}: parsed ZERO roster rows — refusing to write`);

  const now = new Date().toISOString();
  let matched = 0;
  const misses: string[] = [];
  for (const o of set.officeholders) {
    const district = districtOf(set, o.id);
    let candidates = rows.filter(
      (r) =>
        r.chamber === chamberOf(o) &&
        (district === null || r.district === district) &&
        (norm(r.name) === norm(o.name) ||
          surname(r.name) === surname(o.name) ||
          norm(o.name).includes(norm(r.name))),
    );
    if (candidates.length > 1) {
      // Same surname twice in a chamber (Contreras, Carter, Rodriguez):
      // prefer an exact full-name match, then a unique first-name match.
      const exact = candidates.filter((r) => norm(r.name) === norm(o.name));
      const byFirst = candidates.filter((r) => firstName(r.name) === firstName(o.name));
      if (exact.length === 1) candidates = exact;
      else if (byFirst.length === 1) candidates = byFirst;
      else {
        // "Gabe" vs the roster's "Gabriel": a unique prefix match either way.
        const byPrefix = candidates.filter(
          (r) =>
            firstName(r.name).startsWith(firstName(o.name)) ||
            firstName(o.name).startsWith(firstName(r.name)),
        );
        if (byPrefix.length === 1) candidates = byPrefix;
      }
    }
    if (candidates.length === 1) {
      apply(o, candidates[0]);
      o.provenance = {
        sourceUrl: rosterUrl,
        sourceOrg: rosterOrg,
        collectedAt: now,
        verifiedAt: now,
      };
      matched++;
    } else {
      misses.push(`${o.name} (${o.officeTitle}${district ? ` D${district}` : ""}): ${candidates.length} roster matches`);
    }
  }

  writeFileSync(path, `${JSON.stringify(set, null, 1)}\n`, "utf8");
  console.log(`${fips}: ${matched} of ${set.officeholders.length} enriched from ${rosterUrl} (${rows.length} roster rows)`);
  if (misses.length > 0) {
    console.log(`  unmatched (fields left as the CSV had them):`);
    for (const miss of misses) console.log(`    ${miss}`);
  }
  return { matched, total: set.officeholders.length };
}

/**
 * Federal records the bulk file ships incomplete, each verified by fetching
 * the URL and reading the page. Applied after officials:build the same way
 * the state enrichment is — re-running this script re-applies them.
 */
const FEDERAL_FIXUPS: Record<string, { websiteUrl: string; verification: string }> = {
  // The bulk file carries no URL for him; fetched 2026-08-16, page titled
  // "Congressman James Gallagher | Representing California's 1st District".
  "James Gallagher": {
    websiteUrl: "https://gallagher.house.gov",
    verification: "fetched 2026-08-16, page names James Gallagher (CA-1)",
  },
};

function applyFederalFixups() {
  const path = join(process.cwd(), "lib", "registry", "officeholders-us.json");
  const set = JSON.parse(readFileSync(path, "utf8")) as OfficeholderSet & Record<string, unknown>;
  let applied = 0;
  for (const o of set.officeholders) {
    const fix = FEDERAL_FIXUPS[o.name];
    if (fix && !o.websiteUrl) {
      o.websiteUrl = fix.websiteUrl;
      applied++;
    }
  }
  if (applied > 0) writeFileSync(path, `${JSON.stringify(set, null, 2)}\n`, "utf8");
  console.log(`US: ${applied} federal fixup(s) applied of ${Object.keys(FEDERAL_FIXUPS).length} recorded`);
}

// ── NH: the General Court's member directory, via the Archive ─────────────

/** The capture pinned for reproducibility; the original URL rides in the
 *  provenance. Re-point at a newer capture (or the live file, the day the
 *  wall comes down) to refresh. */
const NH_MEMBERS_TXT_ARCHIVE =
  "https://web.archive.org/web/20260407184602id_/https://gc.nh.gov/downloads/members.txt";
const NH_MEMBERS_TXT_ORIGINAL = "https://gc.nh.gov/downloads/members.txt";

interface NhDirectoryRow {
  name: string;
  chamber: "upper" | "lower";
  county: string;
  district: string;
  phone: string | null;
  email: string | null;
  status: string;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
}

function parseNhMembersTxt(text: string): NhDirectoryRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const rows: NhDirectoryRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t").map(unquote);
    const last = cells[col("LastName")] ?? "";
    const first = cells[col("FirstName")] ?? "";
    if (!last || !first) continue;
    rows.push({
      name: `${first} ${last}`,
      chamber: cells[col("LegislativeBody")] === "S" ? "upper" : "lower",
      county: (cells[col("County")] ?? "").trim(),
      district: String(Number(cells[col("District")] ?? "")),
      phone: (cells[col("Phone")] ?? "").trim() || null,
      email: (cells[col("WorkEmail")] ?? "").trim() || null,
      status: (cells[col("electedStatus")] ?? "").trim(),
    });
  }
  return rows;
}

/**
 * NH House districts are county-scoped ("Merrimack 7"), and the registry's
 * Census-sourced division labels carry exactly that designation — the same
 * bridge the Plural builder uses. This maps each member to their county +
 * district so the directory match is scoped, not name-only.
 */
function nhDesignationOf(
  set: OfficeholderSet,
  registryLabels: Map<string, string>,
  id: string,
): { county: string | null; district: string | null } {
  const link = set.divisions.find((d) => d.officeholderId === id);
  if (!link) return { county: null, district: null };
  const label = registryLabels.get(link.ocdId) ?? "";
  const house = label.match(/State House District (\w+) 0*(\d+)/);
  if (house) return { county: house[1], district: house[2] };
  const senate = label.match(/State Senate District 0*(\d+)/);
  if (senate) return { county: null, district: senate[1] };
  return { county: null, district: null };
}

async function enrichNhFromArchive() {
  const path = join(process.cwd(), rosterPath("officeholders-33.json"));
  const set = JSON.parse(readFileSync(path, "utf8")) as OfficeholderSet &
    Record<string, unknown>;
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
  ) as { divisions: { ocdId: string; label: string }[] };
  const labels = new Map(registry.divisions.map((d) => [d.ocdId, d.label]));

  const text = await fetchText(NH_MEMBERS_TXT_ARCHIVE);
  const all = parseNhMembersTxt(text);
  // A row the directory itself marks "Former" is not a current member and
  // must never enrich one.
  const rows = all.filter((r) => !/former/i.test(r.status));
  if (rows.length === 0) throw new Error("NH members.txt: parsed ZERO current rows — refusing to write");
  console.log(`NH directory: ${all.length} rows, ${rows.length} current (${all.length - rows.length} marked Former)`);

  const now = new Date().toISOString();
  let matched = 0;
  let gotPhone = 0;
  let gotEmail = 0;
  const misses: string[] = [];
  for (const o of set.officeholders) {
    const want = nhDesignationOf(set, labels, o.id);
    let candidates = rows.filter(
      (r) =>
        r.chamber === chamberOf(o) &&
        (want.district === null || r.district === want.district) &&
        (want.county === null || r.county.toLowerCase() === want.county.toLowerCase()) &&
        (norm(r.name) === norm(o.name) ||
          surname(r.name) === surname(o.name) ||
          norm(o.name).includes(norm(r.name))),
    );
    if (candidates.length > 1) {
      const exact = candidates.filter((r) => norm(r.name) === norm(o.name));
      const byFirst = candidates.filter((r) => firstName(r.name) === firstName(o.name));
      if (exact.length === 1) candidates = exact;
      else if (byFirst.length === 1) candidates = byFirst;
      else {
        const byPrefix = candidates.filter(
          (r) =>
            firstName(r.name).startsWith(firstName(o.name)) ||
            firstName(o.name).startsWith(firstName(r.name)),
        );
        if (byPrefix.length === 1) candidates = byPrefix;
      }
    }
    if (candidates.length === 1) {
      const row = candidates[0];
      if (row.phone) {
        o.phone = row.phone;
        gotPhone++;
      }
      if (row.email) {
        // The directory publishes whichever address the member filed —
        // gc.nh.gov or personal. As published, never normalized.
        o.email = row.email;
        gotEmail++;
      }
      o.provenance = {
        sourceUrl: NH_MEMBERS_TXT_ARCHIVE,
        sourceOrg:
          "NH General Court member directory (members.txt), via Internet Archive capture 2026-04-07 of " +
          NH_MEMBERS_TXT_ORIGINAL,
        collectedAt: now,
        verifiedAt: now,
      };
      matched++;
    } else {
      misses.push(
        `${o.name} (${o.officeTitle}${want.county ? ` ${want.county}` : ""}${want.district ? ` D${want.district}` : ""}): ${candidates.length} directory matches`,
      );
    }
  }

  writeFileSync(path, `${JSON.stringify(set, null, 1)}\n`, "utf8");
  console.log(
    `33: ${matched} of ${set.officeholders.length} enriched from the archived directory — phone on ${gotPhone}, email on ${gotEmail}`,
  );
  if (misses.length > 0) {
    console.log(`  unmatched (fields left as the CSV had them): ${misses.length}`);
    for (const miss of misses) console.log(`    ${miss}`);
  }
  return { matched, total: set.officeholders.length };
}

async function main() {
  applyFederalFixups();
  const az = await enrich(
    "04",
    "https://www.azleg.gov/memberroster/",
    "Arizona State Legislature (member roster)",
    parseAzRoster,
    (o, row) => {
      o.websiteUrl = row.memberUrl;
      o.contactFormUrl = row.contactFormUrl;
      if (row.phone) o.phone = row.phone;
      // The roster publishes an email form, not an address; the CSV address
      // was verified dead by the author. Null is the honest value.
      o.email = null;
    },
  );

  const nj = await enrich(
    "34",
    "https://www.njleg.state.nj.us/legislative-roster",
    "New Jersey Legislature (legislative roster)",
    parseNjRoster,
    (o, row) => {
      o.websiteUrl = row.memberUrl;
      if (row.contactFormUrl) o.contactFormUrl = row.contactFormUrl;
      // Phone and email stay from the CSV — the njleg.org address pattern is
      // the legislature's own published scheme.
    },
  );

  const nh = await enrichNhFromArchive();
  console.log(
    `\ntotals: AZ ${az.matched}/${az.total} · NJ ${nj.matched}/${nj.total} · NH ${nh.matched}/${nh.total} (archived directory — the long way)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
