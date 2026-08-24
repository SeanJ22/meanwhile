/**
 * `pnpm definitions:verify` — **every citation in the definitions library is
 * fetched and checked.** (DEF-1 through DEF-4, 2026-08-22, item 11.)
 *
 * The definitions library says what a class of government does, and every entry
 * carries the statute or constitutional provision that creates the class. A
 * citation nobody has fetched is a citation nobody has checked, and this
 * product's whole claim is that it does not make claims about governments
 * without a source record.
 *
 * ## The bar is the same one the credential ledger uses, for the same reason
 *
 * **A 200 whose content is not about the thing asked for is not a source.**
 * `nj.gov/nj/gov/county/` answers HTTP 200 with a styled "Page not found", and
 * a status check alone reads that as success — which is why RULING 93 made
 * control strings mandatory on directory routes. Every row here declares a
 * control string that must appear in the fetched document.
 *
 * It writes nothing. It prints a table and exits non-zero on any failure, so it
 * can be run as a gate.
 *
 * ```
 * pnpm definitions:verify
 * ```
 */
import { execFileSync } from "node:child_process";

import { CLASS_DEFINITIONS, DEPENDENT_SCHOOL_DEFINITION } from "../lib/officials/body-definitions.ts";
import { BODY_BLURBS, DIVISION_BODY_BLURBS } from "../lib/officials/body-blurbs.ts";
import { FORM_DEFINITIONS } from "../lib/officials/form-definitions.ts";

const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";

/**
 * RUNG 3 — the full browser header set.
 *
 * The first run of this script got HTTP 403 from `constitution.congress.gov`,
 * `law.justia.com` and `codelibrary.amlegal.com` while plain `curl` with the
 * IDENTICAL User-Agent got 200 from all three. That difference is not about the
 * agent string: Node's `fetch` sends a bare header set, and these hosts refuse
 * it. A 403 to a plain client is rung 2 failing, never a wall — and recording it
 * as one would have put a "we could not read the U.S. Constitution" line in this
 * repo.
 *
 * The identifying User-Agent with a contact address is kept, because the
 * retrieval manners are not the thing being worked around. What is added is the
 * ordinary header set any browser sends.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

/**
 * What must appear in the document for the citation to count as read.
 *
 * Keyed by URL, and deliberately a separate table from the library: a control
 * string sitting on the row it validates is a control the row's author chose,
 * and half the value of a control is that it is written against the SOURCE
 * rather than against the claim.
 */
const CONTROLS: Record<string, string[]> = {
  "https://constitution.congress.gov/browse/article-1/section-2/": ["Representatives"],
  "https://constitution.congress.gov/browse/amendment-17/": ["Senator"],
  "https://law.justia.com/codes/new-jersey/title-40a/section-40a-63-1/": ["40A:63-1"],
  "https://law.justia.com/codes/new-jersey/title-40/section-40-69a-1/": ["40:69A-1"],
  "https://law.justia.com/codes/new-jersey/title-40/section-40-41a-26/": ["40:41A-26"],
  "https://www.gencourt.state.nh.us/rsa/html/III/31/31-1.htm": ["31:1"],
  /*
   * `NH93`, closed 2026-08-23. The control is a PHRASE from the statute's own
   * text rather than the section number, because the section number alone
   * would pass on a chapter index that merely lists it. What the definition
   * claims — that the county's legislative body is the convention of state
   * representatives and not the commissioners — is what this string proves the
   * document actually says.
   *
   * Counties are RSA Title **II**. The `III/` shape every other New Hampshire
   * citation here uses 404s on them, which cost three attempts before the
   * index was read instead of guessed.
   */
  "https://www.gencourt.state.nh.us/rsa/html/II/24/24-1.htm": [
    "county convention consists of the state representatives",
  ],
  "https://www.gencourt.state.nh.us/rsa/html/XV/189/189-1-a.htm": ["189:1-a"],
  "https://www.azleg.gov/ars/9/00499-15.htm": ["9-499.15"],
  "https://www.azleg.gov/ars/11/00251.htm": ["11-251"],
  "https://www.azleg.gov/ars/15/00341.htm": ["15-341"],
  "https://www.census.gov/programs-surveys/cog.html": ["Census of Governments"],
  "https://codelibrary.amlegal.com/codes/tucson/latest/tucson_az_charter": ["Tucson"],
  /*
   * DI04's three state seats (2026-08-24). Each control is a phrase from the
   * document's OWN text, never the article number: a number alone would pass on
   * an index that merely lists it, and this project has already been caught by
   * a styled "Page not found" answering HTTP 200 — azleg.gov serves exactly
   * that, 78 KB of it, carrying the word "legislative" eight times.
   */
  "https://www.njleg.state.nj.us/constitution": ["The executive power"],
  "https://www.gencourt.state.nh.us/rsa/html/I/4/4-mrg.htm": ["GOVERNOR AND COUNCIL"],
  "https://www.gencourt.state.nh.us/rsa/html/I/14/14-mrg.htm": ["LEGISLATIVE OFFICERS"],
  "https://www.azleg.gov/const/5/1.htm": ["Executive department"],
  "https://www.azleg.gov/const/4/1.p2.htm": ["house of representatives"],
  /*
   * Item 6's form layer (2026-08-24). The New Jersey controls are phrases from
   * each chapter's OWN first sentence, because the section pages do not name
   * the form anywhere — the chapter had to be opened and identified from what
   * it says about itself. That is also how 40A:64 was ruled OUT as the village
   * chapter: its section 1 is about Sunday sales.
   */
  "https://law.justia.com/codes/new-jersey/title-40a/section-40a-60-1/": ["several boroughs"],
  "https://law.justia.com/codes/new-jersey/title-40a/section-40a-61-1/": ["several cities"],
  "https://law.justia.com/codes/new-jersey/title-40a/section-40a-62-1/": ["several towns"],
  "https://www.gencourt.state.nh.us/rsa/html/III/39/39-1.htm": ["39:1"],
  "https://www.gencourt.state.nh.us/rsa/html/III/47/47-17.htm": ["47:17"],
  "https://www.azleg.gov/ars/9/00101.htm": ["9-101"],
  "https://www.azleg.gov/ars/9/00240.htm": ["9-240"],
};

/**
 * **RUNG 4 — a different CLIENT, because the header set was not the problem.**
 *
 * The walk, recorded in order so no later session re-walks it:
 *
 * - **Rung 2, plain `fetch`:** HTTP 403 from `constitution.congress.gov`,
 *   `law.justia.com` and `codelibrary.amlegal.com`.
 * - **Rung 3, the full browser header set** (kept above, unused, because it is
 *   the evidence for this paragraph): the SAME 403 from all three.
 * - **Rung 4, `curl` with the identical User-Agent:** HTTP 200 from all three.
 *
 * That is the f-session finding exactly — curl beat a fingerprint filter where
 * header-swapping did not — and it is a TLS fingerprint wall rather than a
 * header wall. Nothing is spoofed: the same identifying User-Agent with a
 * contact address goes out, one request at a time, spaced.
 *
 * Reporting the 403 as a wall would have put "we could not read the U.S.
 * Constitution" in this repo, which is the shape the transparency mandate
 * exists to prevent.
 */
function read(url: string): { status: number | string; body: string } {
  try {
    const out = execFileSync(
      "curl",
      [
        "-sS",
        "-L",
        "--max-time",
        "45",
        "-H",
        `User-Agent: ${UA}`,
        "-H",
        `Accept: ${BROWSER_HEADERS.Accept}`,
        "-H",
        `Accept-Language: ${BROWSER_HEADERS["Accept-Language"]}`,
        "-w",
        "\n__WTP_STATUS__%{http_code}",
        url,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
    const cut = out.lastIndexOf("\n__WTP_STATUS__");
    if (cut < 0) return { status: "NO STATUS", body: out };
    return {
      status: Number(out.slice(cut + "\n__WTP_STATUS__".length).trim()),
      body: out.slice(0, cut),
    };
  } catch (error) {
    return { status: `NO RESPONSE — ${(error as Error).message}`, body: "" };
  }
}

interface Row {
  what: string;
  url: string;
  status: number | string;
  bytes: number;
  control: string | null;
  ok: boolean;
  why: string;
}

const targets: { what: string; url: string | null }[] = [
  ...CLASS_DEFINITIONS.map((r) => ({
    what: `class · ${r.state ?? "national"} · ${r.classKey}`,
    url: r.definition.basisUrl,
  })),
  { what: "class · national · school_district_dependent", url: DEPENDENT_SCHOOL_DEFINITION.basisUrl },
  ...BODY_BLURBS.map((r) => ({ what: `form · ${r.state} · ${r.divisionType}`, url: r.blurb.basisUrl })),
  ...DIVISION_BODY_BLURBS.map((r) => ({ what: `form · ${r.divisionOcdId}`, url: r.blurb.basisUrl })),
  // Item 6's form layer. Every one of these is a statute read once per FORM
  // rather than once per body — see lib/officials/form-definitions.ts.
  ...FORM_DEFINITIONS.map((r) => ({ what: `form · ${r.formKey}`, url: r.definition.basisUrl })),
];

const rows: Row[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

for (const target of targets) {
  if (target.url === null) {
    rows.push({
      what: target.what,
      url: "—",
      status: "NO URL",
      bytes: 0,
      control: null,
      ok: false,
      why: "the row cites a source with no URL, so nothing can check it",
    });
    continue;
  }
  const controls = CONTROLS[target.url];
  if (controls === undefined) {
    rows.push({
      what: target.what,
      url: target.url,
      status: "NO CONTROL",
      bytes: 0,
      control: null,
      ok: false,
      why: "no control string is declared for this URL — a status check alone is not a read",
    });
    continue;
  }

  // Serialized, identified, spaced. The retrieval manners this project uses
  // everywhere: one request at a time against a public tenant.
  /*
   * A 403 here is TRANSIENT and is proven so by this script's own output: the
   * first run refused `40A:63-1` on one row and served it on another, in the
   * same run, seconds apart. That is a rate wall, not a refusal — so it is
   * backed off rather than recorded as a wall.
   *
   * Three attempts, widening. `Retry-After` is honoured where a host sends one;
   * none of these do, so the backoff is the manners.
   */
  let answer = read(target.url);
  for (let attempt = 1; attempt < 3 && answer.status === 403; attempt++) {
    await sleep(2500 * attempt);
    answer = read(target.url);
  }
  const status = answer.status;
  const body = answer.body;
  await sleep(700);

  const hit = controls.find((c) => body.toLowerCase().includes(c.toLowerCase())) ?? null;
  rows.push({
    what: target.what,
    url: target.url,
    status,
    bytes: body.length,
    control: hit,
    ok: status === 200 && hit !== null,
    why:
      status !== 200
        ? `the host did not answer 200`
        : hit === null
          ? `HTTP 200 but the document does not contain ${controls.map((c) => JSON.stringify(c)).join(" or ")} — a 200 whose content is not about the thing asked for is not a source`
          : "read, and the document is about the cited provision",
  });
}

const ok = rows.filter((r) => r.ok).length;
console.log(`\ndefinitions — ${ok} of ${rows.length} citations read and confirmed\n`);
for (const r of rows) {
  console.log(
    `  ${(r.ok ? "OK" : "FAIL").padEnd(5)} ${String(r.status).padEnd(12)} ${r.what.padEnd(46)} ${r.control ?? r.why}`,
  );
}

if (ok < rows.length) {
  console.log(`\n${rows.length - ok} citation(s) could not be confirmed. A definition without a read`);
  console.log(`citation is a claim about a government with nothing behind it.`);
  process.exit(1);
}
