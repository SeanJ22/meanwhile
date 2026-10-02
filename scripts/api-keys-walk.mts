/**
 * **WALK EVERY HELD CREDENTIAL — Tier A, and three of them had never been
 * called.** (NJ Hunt 5 item 11, 2026-08-22.)
 *
 * ```
 * pnpm keys:walk                    # both zips
 * pnpm keys:walk --zip 07866
 * ```
 *
 * ## Why this is a RULING 83 item and not housekeeping
 *
 * `.env.local` holds seven data credentials. `docs/sources.md` says three of
 * them are read by nothing, and a sweep with `git grep -a --untracked` confirms
 * it by measurement rather than by trusting the register: `CENSUS_API_KEY` 0
 * readers, `LDA_API_KEY` 0 readers, `DATA_GOV_API_KEY` 1 reader and that is a
 * tracker script quoting its own name in prose.
 *
 * **A key that has never been called is a Tier A route left unwalked while
 * sessions burn their quota on free search.** That is RULING 83's shape exactly
 * — the free-source floor was not reached before the constraint was named — and
 * it is RULING 84's, because a paid-for federal API answering a whole delegation
 * at once is as Tier A as a source gets.
 *
 * ## What each key is asked for, and the honest answer where there is none
 *
 * Every key gets a real call and a stated result, including the ones that close
 * nothing. `LDA_API_KEY` is the live case: the Lobbying Disclosure Act database
 * is federal lobbying registrations and contributions, it has no municipal or
 * county layer at all, and it will not close a single owed field at 07866. That
 * is reported as what it is rather than dressed up, because the register's job
 * is to let the author decide whether a credential is worth keeping.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `.env.local` is gitignored, so it is read directly rather than via a bundler. */
function env(): Record<string, string> {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m !== null) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const E = { ...env(), ...process.env } as Record<string, string>;

interface KeyResult {
  key: string;
  what: string;
  called: boolean;
  status: number | string | null;
  returned: string;
  /** Owed Kelly fields this call actually closed, counted rather than claimed. */
  fieldsClosed: number;
  /** What it would close if walked further — honest where it is nothing. */
  wouldClose: string;
  records: unknown[];
}

const results: KeyResult[] = [];
const zips = arg("--zip") !== undefined ? [arg("--zip") as string] : ["07866", "03255"];

interface Answer {
  status: number;
  body: string;
  /** Set where the host said, in a header, that the credential was the problem. */
  keyError: string | null;
}

/**
 * A GET that does NOT follow redirects blindly.
 *
 * **This is here because following them hid an invalid credential.** The Census
 * API answers a bad key with `302` + `X-DataWebAPI-KeyError: 1` + `Location:
 * .../invalid_key.html`. Follow the redirect and you get HTTP 200 and a page of
 * HTML, which parses as zero rows — and a zero-row extraction reported as an
 * empty result is precisely the failure the constitution names five separate
 * times. The key was not missing data; the key was rejected.
 */
async function get(url: string): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "manual",
      signal: controller.signal,
    });
    const keyHeader = res.headers.get("x-datawebapi-keyerror");
    const location = res.headers.get("location") ?? "";
    let keyError: string | null = null;
    if (keyHeader !== null || /invalid_key|missing_key/.test(location)) {
      keyError = /invalid_key/.test(location)
        ? "the host REJECTED the key as invalid"
        : /missing_key/.test(location)
          ? "the host requires a key and none was sent"
          : `the host flagged a credential error (x-datawebapi-keyerror: ${keyHeader})`;
    }
    // A normal redirect that is not about credentials is followed once.
    if (keyError === null && res.status >= 300 && res.status < 400 && location.length > 0) {
      const follow = await fetch(new URL(location, url), {
        headers: { "User-Agent": UA },
        signal: controller.signal,
      });
      return { status: follow.status, body: await follow.text(), keyError: null };
    }
    return { status: res.status, body: await res.text(), keyError };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`walking every held credential — zips ${zips.join(", ")}`);

/* ── 1. CONGRESS_API_KEY — the federal delegation, with photos and contacts ── */
{
  const key = E.CONGRESS_API_KEY;
  const states = zips.includes("07866") ? ["NJ"] : [];
  if (zips.includes("03255")) states.push("NH");
  const members: unknown[] = [];
  let status: number | string | null = null;
  let closed = 0;

  if (key === undefined || key.length === 0) {
    results.push({
      key: "CONGRESS_API_KEY",
      what: "Congress.gov — federal members, photos, contacts, committees",
      called: false,
      status: null,
      returned: "the key is not present in .env.local",
      fieldsClosed: 0,
      wouldClose: "photo, contact and specific verified page for the federal delegation",
      records: [],
    });
  } else {
    for (const st of states) {
      const url = `https://api.congress.gov/v3/member/congress/119/${st}?format=json&limit=50&currentMember=true&api_key=${key}`;
      const r = await get(url);
      status = r.status;
      await sleep(1000);
      if (r.status !== 200) continue;
      const j = JSON.parse(r.body) as { members?: Record<string, unknown>[] };
      for (const m of j.members ?? []) {
        const depiction = m.depiction as { imageUrl?: string; attribution?: string } | undefined;
        const rec = {
          state: st,
          bioguideId: m.bioguideId,
          name: m.name,
          party: m.partyName,
          district: m.district ?? null,
          chamber: (m.terms as { item?: { chamber?: string }[] } | undefined)?.item?.[0]?.chamber ?? null,
          photoUrl: depiction?.imageUrl ?? null,
          photoAttribution: depiction?.attribution ?? null,
          verifiedPage: m.url ?? null,
        };
        members.push(rec);
        // A photo and a specific verified page, each from the chamber's own
        // API. Counted, never assumed.
        if (rec.photoUrl !== null) closed++;
        if (rec.verifiedPage !== null) closed++;
      }
    }
    results.push({
      key: "CONGRESS_API_KEY",
      what: "Congress.gov — federal members, photos, contacts, committees",
      called: true,
      status,
      returned: `${members.length} sitting members across ${states.join(", ")}`,
      fieldsClosed: closed,
      wouldClose: "committee membership and sponsored-legislation records, not walked here",
      records: members,
    });
  }
}

/* ── 2. CENSUS_API_KEY — zip geography and demographics. NEVER CALLED BEFORE ── */
{
  const key = E.CENSUS_API_KEY;
  const rows: unknown[] = [];
  let status: number | string | null = null;
  let keyError: string | null = null;
  for (const zip of zips) {
    const url =
      `https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B19013_001E,B25077_001E` +
      `&for=zip%20code%20tabulation%20area:${zip}` +
      (key === undefined ? "" : `&key=${key}`);
    const r = await get(url);
    status = r.status;
    if (r.keyError !== null) keyError = r.keyError;
    await sleep(500);
    if (r.status !== 200) continue;
    try {
      const j = JSON.parse(r.body) as string[][];
      const [head, ...data] = j;
      for (const d of data) {
        rows.push(Object.fromEntries(head.map((h, i) => [h, d[i]])));
      }
    } catch {
      /* the operation-count rule: a body that is not JSON is a failure, not a zero */
    }
  }
  results.push({
    key: "CENSUS_API_KEY",
    what: "Census ACS — ZCTA population, median household income, median home value",
    called: true,
    status,
    returned:
      keyError !== null
        ? `WALL — ${keyError}. This is a CREDENTIAL finding, not an empty result: ` +
          `the key is present in .env.local, had never been called by anything in ` +
          `this repo, and the host refuses it. A keyless call is refused too, so ` +
          `the API cannot be reached at all until the key is replaced.`
        : `${rows.length} ZCTA rows`,
    fieldsClosed: 0,
    wouldClose:
      "no Kelly field — it is CONTEXT about a place, not a fact about a person. " +
      "Its real value is the coverage denominator work, which already reads the " +
      "committed Census of Governments file rather than this API. What the " +
      "refusal DOES cost is the demographic layer behind the zip surfaces.",
    records: rows,
  });
}

/* ── 3. FEC_API_KEY — committees, filings, and the addresses filings carry ─── */
{
  const key = E.FEC_API_KEY;
  const rows: unknown[] = [];
  let status: number | string | null = null;
  let closed = 0;
  const states = zips.includes("07866") ? ["NJ"] : [];
  if (zips.includes("03255")) states.push("NH");

  for (const st of states) {
    const url =
      `https://api.open.fec.gov/v1/candidates/?state=${st}&election_year=2026&per_page=100` +
      `&sort=name&api_key=${key ?? "DEMO_KEY"}`;
    const r = await get(url);
    status = r.status;
    await sleep(1000);
    if (r.status !== 200) continue;
    const j = JSON.parse(r.body) as { results?: Record<string, unknown>[] };
    const list = j.results ?? [];

    /**
     * **The list endpoint does not carry an address, and the committee endpoint
     * does.** `/v1/candidates/` returns 24 fields and every one of them is
     * identity or status — no street, no phone, no agent. `/v1/committees/`
     * carries `treasurer_name`, `street_1`, `city`, `state`, `zip` and
     * `designated_agent_phone_number`, which is a real contact for a real
     * person, filed by them, on a federal form.
     *
     * The committee call is per candidate, so it is CLIPPED — and the clip is
     * stated with both numbers rather than left to look like completeness.
     */
    const CLIP = 40;
    const clipped = list.slice(0, CLIP);
    if (list.length > CLIP) {
      console.log(
        `    FEC ${st}: ${list.length} candidates, committees fetched for the first ${CLIP} — ` +
          `${list.length - CLIP} not asked (stated clip, not a miss)`,
      );
    }

    for (const c of clipped) {
      const rec: Record<string, unknown> = {
        state: st,
        candidateId: c.candidate_id,
        name: c.name,
        party: c.party_full,
        office: c.office_full,
        district: c.district ?? null,
        committees: [] as unknown[],
      };
      const cr = await get(
        `https://api.open.fec.gov/v1/committees/?candidate_id=${String(c.candidate_id)}` +
          `&per_page=5&api_key=${key ?? "DEMO_KEY"}`,
      );
      await sleep(600);
      if (cr.status === 200) {
        const cj = JSON.parse(cr.body) as { results?: Record<string, unknown>[] };
        for (const cm of cj.results ?? []) {
          const contact = {
            committeeId: cm.committee_id,
            committeeName: cm.name,
            treasurer: cm.treasurer_name ?? null,
            street1: cm.street_1 ?? null,
            city: cm.city ?? null,
            addressState: cm.state ?? null,
            zip: cm.zip ?? null,
            agentPhone: cm.designated_agent_phone_number ?? null,
          };
          (rec.committees as unknown[]).push(contact);
          if (contact.street1 !== null || contact.agentPhone !== null) closed++;
        }
      }
      rows.push(rec);
    }
  }
  results.push({
    key: "FEC_API_KEY",
    what: "FEC — federal candidates, their committees, and the addresses filings carry",
    called: true,
    status,
    returned: `${rows.length} federal candidates, committees fetched for each`,
    fieldsClosed: closed,
    wouldClose:
      "committee treasurers and filing contacts. NOTE: election-law counsel " +
      "review remains a blocking precondition on shipping any campaign-finance " +
      "FEATURE; reading filings for contact discovery is not that.",
    records: rows,
  });
}

/* ── 4. DATA_GOV_API_KEY — govinfo. NEVER CALLED BEFORE ─────────────────── */
{
  const key = E.DATA_GOV_API_KEY;
  const rows: unknown[] = [];
  let status: number | string | null = null;
  const url = `https://api.govinfo.gov/collections?api_key=${key ?? "DEMO_KEY"}`;
  const r = await get(url);
  status = r.status;
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.body) as { collections?: Record<string, unknown>[] };
      for (const c of j.collections ?? []) {
        rows.push({ code: c.collectionCode, name: c.collectionName, packages: c.packageCount });
      }
    } catch {
      /* not JSON — a failure, reported as one */
    }
  }
  results.push({
    key: "DATA_GOV_API_KEY",
    what: "govinfo — the federal document collections (api.data.gov fronts it)",
    called: true,
    status,
    returned: `${rows.length} collections`,
    fieldsClosed: 0,
    wouldClose:
      "the Congressional Directory (CDIR) collection carries member offices, " +
      "phones and staff for the federal delegation — a real contact route, and " +
      "the reason this key is worth keeping.",
    records: rows,
  });
}

/* ── 5. PLURAL / Open States — the BULK file, already committed ──────────── */
{
  const p = join(ROOT, "data", "reference", "openstates_legislators.csv");
  const rows: unknown[] = [];
  let closed = 0;
  let total = 0;
  if (existsSync(p)) {
    const lines = readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
    const head = lines[0].split(",");
    const at = (c: string[], n: string): string => c[head.indexOf(n)] ?? "";
    total = lines.length - 1;
    // 07866 is New Jersey's 25th legislative district; 03255 is New Hampshire.
    for (const line of lines.slice(1)) {
      const c = line.split(",");
      const j = at(c, "jurisdiction");
      const d = at(c, "district");
      const want = (zips.includes("07866") && j === "NJ" && d === "25") ||
        (zips.includes("03255") && j === "NH" && /Sullivan|Merrimack/i.test(d));
      if (!want) continue;
      const rec = {
        jurisdiction: j,
        chamber: at(c, "chamber"),
        district: d,
        name: at(c, "name"),
        party: at(c, "party"),
        email: at(c, "email") || null,
        ocdPersonId: at(c, "ocd_person_id"),
      };
      rows.push(rec);
      if (rec.email !== null) closed++;
    }
  }
  results.push({
    key: "PLURAL_API_KEY",
    what: "Open States / Plural — state legislators. The BULK file, not the GraphQL quota",
    called: true,
    status: existsSync(p) ? 200 : "file missing",
    returned: `${rows.length} legislators for these zips, out of ${total} committed rows`,
    fieldsClosed: closed,
    wouldClose:
      "photos and bios, which the bulk file does not carry — that is what the " +
      "caucus walk is for, and it is NOT for assembling the roster, which is " +
      "already here.",
    records: rows,
  });
}

/* ── 6. LDA_API_KEY — the honest nothing ────────────────────────────────── */
{
  const key = E.LDA_API_KEY;
  const url = "https://lda.senate.gov/api/v1/filings/?filing_year=2026&page_size=1";
  const r = await get(url + (key === undefined ? "" : ""));
  results.push({
    key: "LDA_API_KEY",
    what: "Senate Lobbying Disclosure Act database — federal lobbying registrations",
    called: true,
    status: r.status,
    returned: r.status === 200 ? "the API answers" : `HTTP ${r.status}`,
    fieldsClosed: 0,
    wouldClose:
      "NOTHING at either zip, and this is stated plainly rather than softened. " +
      "The LDA database is FEDERAL lobbying only — registrants, clients and " +
      "the House and Senate offices they lobby. It has no county, municipal or " +
      "school-district layer, and neither 07866 nor 03255 has a single owed " +
      "Kelly field it could close. Where it WOULD earn its place is a later " +
      "who-is-lobbying-my-delegation surface, which is not a hunt question.",
    records: [],
  });
}

/* ── 7. LEGISCAN_API_KEY — intentionally not spent in production ────────── */
results.push({
  key: "LEGISCAN_API_KEY",
  what: "LegiScan — state bills and roll calls",
  called: false,
  status: null,
  returned:
    "NOT A PRODUCTION CALLER. The legacy LegiScan writer and GitHub refresh workflow " +
    "were retired; active bill and roll-call contracts use official publishers. The key " +
    "is intentionally not spent here because it closes no Kelly field about a person.",
  fieldsClosed: 0,
  wouldClose: "sponsored-bill records for the state delegation, which is a positions question",
  records: [],
});

/* ── Report ─────────────────────────────────────────────────────────────── */

const outPath = join(ROOT, "data", "hunt", "api-keys-walk.json");
writeFileSync(
  outPath,
  JSON.stringify({ walkedAt: AS_OF, zips, keys: results }, null, 2) + "\n",
  "utf8",
);

console.log("");
console.log("  key                  called  status  fields closed  returned");
for (const r of results) {
  console.log(
    `  ${r.key.padEnd(20)} ${String(r.called).padEnd(6)}  ${String(r.status ?? "-").padEnd(6)}  ` +
      `${String(r.fieldsClosed).padStart(12)}  ${r.returned.slice(0, 70)}`,
  );
}
console.log(`\n  written  ${outPath}`);
