/**
 * **RE-TEST EVERY WALL THIS PRODUCT HAS EVER RECORDED** (built 2026-08-21,
 * NH Hunt 5 item 3.5; RULING 52 and RULING 53).
 *
 * ```
 * pnpm rewalk:walls              # every recorded wall, rung 2 then rung 3
 * pnpm rewalk:walls --host=X     # just one
 * ```
 *
 * ## Why walls are re-tested and not trusted
 *
 * RULING 53: **a walled source is re-walked after 14 days, regardless of how
 * emphatically the wall was recorded.** That clause is not decoration. Two of
 * the three walls this repo had written down as permanent fell in a single
 * session on 2026-08-21:
 *
 * - `gc.nh.gov` was recorded as RESETTING THE TLS CONNECTION to every client
 *   this project has, browsers included. Re-walked: it answers rung 2 at
 *   HTTP 200.
 * - `sos.nh.gov` stayed walled host-wide from 2026-08-13 until somebody
 *   walked rung 5 on 2026-08-21.
 *
 * Both had a defensible rung history behind them, and that is exactly the
 * point RULING 52 makes: rungs prove the discipline was followed on ONE route
 * on ONE day, and no rung count proves the wall is still there tomorrow.
 *
 * ## What this is and is not
 *
 * It is a DATED MEASUREMENT of two rungs against a host. It is not a hunt: it
 * fetches one URL per host and reports the status, so a session can see at a
 * glance which recorded walls are lies today and worth a real hunt. Rung 2 is
 * the plain civic-index client; rung 3 is the full browser header set. A host
 * that answers either has stopped being a wall for that rung on this date.
 *
 * It never writes a wall record and never marks anything defeated. A wall that
 * falls becomes a RUNG, and writing the rung is a session's job with a
 * session's judgement in it — this only says where to point that judgement.
 *
 * The prohibitions are untouched: no residential-proxy spoofing, nothing
 * fabricated, no access control touched. Every URL below is a page the body
 * already publishes to the public.
 */
import { politeGetText, browserProfileHeaders, sourceUserAgent } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const AS_OF = today();
const hostArg = process.argv.find((a) => a.startsWith("--host="));
const ONLY = hostArg ? hostArg.slice("--host=".length) : null;

/**
 * Every host this repo has recorded as walled, with the date the record was
 * made and the wall as it was described then.
 *
 * The URL is a public page the body publishes — the same page the original
 * record was made against wherever that is still known, so the comparison is
 * like for like rather than a different page on the same host.
 */
/**
 * **RULING 72 — A WALL MAY NEVER BE RECORDED WITHOUT NAMING THE BRANCHES
 * TRIED.** (Adopted 2026-08-22, the author's ruling, NJ Hunt 3 item 4.)
 *
 * *A walled host is never evidence a body is unreachable.* Discovery is a tree:
 * a host refusing is ONE BRANCH returning empty on ONE DATE. The body is still
 * reachable by other branches — a federal directory, a phone number, a postal
 * address, a parent agency, a published report, a person.
 *
 * ELEC is the instance the ruling was adopted over. This repo had it recorded
 * as a permanent wall, and the FEC's Combined Federal/State Disclosure
 * Directory — 349 offices across 56 jurisdictions, sitting in
 * `data/reference/` since NJ Hunt 2 — hands over its street address and its
 * phone number. Nobody had looked, because nothing required looking.
 *
 * So `branchesTried` is REQUIRED on every row, and
 * `tests/wall-branches.test.ts` fails the build if a wall is added without it.
 * The field is prose rather than an enum on purpose: what matters is that a
 * person had to write down what else they tried, and an enum would let a
 * session satisfy the rule by picking the nearest label.
 *
 * **An empty string is not a legal value.** "None tried" is a sentence a
 * session must actually write, and having to write it is the point.
 */
const WALLS: {
  host: string;
  url: string;
  recorded: string;
  as: string;
  /** RULING 72. What else was tried for the same fact. Never empty. */
  branchesTried: string;
}[] = [
  {
    host: "gc.nh.gov",
    url: "https://gc.nh.gov/house/members/member.aspx?pid=1",
    recorded: "2026-08-14",
    as: "TLS-fingerprint wall — RESETS the connection before any HTTP happens, to every client including browsers",
    branchesTried:
      "Backfilled 2026-08-22 (RULING 72). At the time: none — the record was a rung history on one host and no second branch was walked, which is the gap this field exists to make visible. Since: `openstates_legislators` in data/reference/ carries NH House members independently of this host, and the FEC directory's NEW HAMPSHIRE / DEPARTMENT OF STATE row carries a phone and postal address for the office that holds the roster.",
  },
  {
    host: "sos.nh.gov",
    url: "https://www.sos.nh.gov/elections",
    recorded: "2026-08-13",
    as: "host-wide UA wall — 403 after connect, every path",
    branchesTried:
      "Backfilled 2026-08-22. Rung 5 (a different EGRESS) reached it on 2026-08-21 after a host-wide wall stood from 2026-08-13 — the branch that broke it was a rung, not a different publisher. FEC directory: NEW HAMPSHIRE / DEPARTMENT OF STATE gives the same office by phone and post.",
  },
  {
    host: "www.newbury.nh.gov",
    url: "https://www.newbury.nh.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients; 200 to a browser profile (the NH WAF family)",
    branchesTried:
      "Backfilled 2026-08-22. Rung 3 (browser header set) answered. Independent branches for the same facts: the town report, the `ical` feed the meetings snapshot already reads, and the Kearsarge SAU for school-side rosters.",
  },
  {
    host: "kearsarge.org",
    url: "https://www.kearsarge.org/",
    recorded: "2026-08-16",
    as: "403 to a CI runner's egress; the g3 EGRESS wall, and the one that emptied fifteen sittings",
    branchesTried:
      "Backfilled 2026-08-22. This was an EGRESS wall (a CI runner's IP refused), not a host wall — the author's own browser and rung 4 both reach it. Independent branch: the district's `ical` feed, which is how the fifteen sittings were re-established.",
  },
  {
    host: "www.tucsonaz.gov",
    url: "https://www.tucsonaz.gov/Departments/City-Clerk",
    recorded: "2026-08-14",
    as: "bot wall reading the User-Agent rather than the client — 403 on every page tried",
    branchesTried:
      "Backfilled 2026-08-22. Legistar (the vendor platform underneath, rung 12) publishes the same clerk records and is wired as `legistar`. FEC directory: ARIZONA / SECRETARY OF STATE for the election-office half.",
  },
  {
    host: "www.governor.nh.gov",
    url: "https://www.governor.nh.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients — same NH WAF family as newbury.nh.gov",
    branchesTried:
      "Backfilled 2026-08-22. None walked at the time. FEC directory: NEW HAMPSHIRE / DEPARTMENT OF STATE carries a phone and postal address; `openstates_legislators` carries the officeholder independently of this host.",
  },
  {
    host: "azgovernor.gov",
    url: "https://azgovernor.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients",
    branchesTried:
      "Backfilled 2026-08-22. The Governor's own page was read at rung 3 during the AZ hunt and IS the official source under the official-source rule. FEC directory: ARIZONA / SECRETARY OF STATE.",
  },
  {
    host: "www.nhmunicipal.org",
    url: "https://www.nhmunicipal.org/",
    recorded: "2026-08-20",
    as: "recorded walled during the NH municipal roster hunt",
    branchesTried:
      "Backfilled 2026-08-22. This is a MEMBERSHIP ASSOCIATION, not a public body — the same municipal roster is in `census_govt_units_2022` and in New Hampshire's own village-district register, both in data/reference/, and both are better sources because they are official enumerations.",
  },
  {
    host: "www.merrimackcounty.net",
    url: "https://www.merrimackcounty.net/",
    recorded: "2026-08-20",
    as: "recorded walled during the county-office hunt",
    branchesTried:
      "Backfilled 2026-08-22. `census_govt_units_2022` enumerates the county's units independently; the FEC directory's NEW HAMPSHIRE rows carry state-level offices that hold county filings.",
  },
  {
    host: "www.elec.nj.gov",
    url: "https://www.elec.nj.gov/",
    recorded: "2026-08-22",
    as: "recorded in this repo as a permanent wall during the New Jersey campaign-finance hunt",
    branchesTried:
      "RULING 72 was adopted over this one. The FEC's Combined Federal/State Disclosure Directory — committed at data/reference/fec_combined_federal_state_disclosure_directory.csv — carries NEW JERSEY / ELECTION LAW ENFORCEMENT COMMISSION with a street address (25 South Stockton Street, 5th Floor, Trenton) and a phone number, which is a branch to the same records that does not go through this host at all. Also independent: NEW JERSEY / DEPARTMENT OF STATE (nj.elections@sos.nj.gov) for candidate filings, and the county clerk's own filed-candidate PDFs, which pnpm nj:filing already reads and which is where 328 filed emails came from.",
  },
];

interface Rung {
  rung: number;
  label: string;
  status: number | null;
  bytes: number;
  note: string;
}

async function rung2(url: string): Promise<Rung> {
  try {
    const r = await politeGetText(url);
    return { rung: 2, label: "plain fetch (civic-index client)", status: r.status, bytes: r.text.length, note: "read" };
  } catch (error) {
    return { rung: 2, label: "plain fetch (civic-index client)", status: null, bytes: 0, note: (error as Error).message.split("\n")[0].slice(0, 140) };
  }
}

async function rung3(url: string): Promise<Rung> {
  try {
    // The browser header set, with our identification still appended to the
    // User-Agent — the step up the ladder does not cost the contact address.
    const res = await fetch(url, { headers: browserProfileHeaders() });
    const text = await res.text();
    return {
      rung: 3,
      label: "full browser header set",
      status: res.status,
      bytes: text.length,
      note: res.ok ? "read" : `HTTP ${res.status}`,
    };
  } catch (error) {
    return { rung: 3, label: "full browser header set", status: null, bytes: 0, note: (error as Error).message.split("\n")[0].slice(0, 140) };
  }
}

console.log(`\nre-test of every recorded wall — RULING 52 and RULING 53, ${AS_OF}`);
console.log(`  identifying as: ${sourceUserAgent()}\n`);

const rows: { host: string; recorded: string; as: string; r2: Rung; r3: Rung; verdict: string }[] = [];

for (const wall of WALLS) {
  if (ONLY && wall.host !== ONLY) continue;
  const r2 = await rung2(wall.url);
  const r3 = r2.status === 200 ? { rung: 3, label: "full browser header set", status: null, bytes: 0, note: "not needed — rung 2 answered" } : await rung3(wall.url);
  const open = r2.status === 200 || r3.status === 200;
  /*
   * A 404 IS NOT A WALL, and conflating the two is how a moved page becomes a
   * permanent refusal in the record.
   *
   * `www.tucsonaz.gov` was recorded as a User-Agent bot wall returning 403 on
   * every page tried. Re-tested, it returns 404 with a 116KB body — the host
   * is answering us perfectly well and serving its own not-found page. The
   * recorded PATH has moved. That is a stale URL, which is a hunt (find where
   * the City Clerk page went), not a wall, which is a different hunt (get past
   * a refusal). Printing them the same way would send the next session up the
   * wrong ladder.
   */
  const moved = !open && (r2.status === 404 || r3.status === 404);
  rows.push({
    host: wall.host,
    recorded: wall.recorded,
    as: wall.as,
    r2,
    r3,
    verdict: open
      ? r2.status === 200
        ? "OPEN AT RUNG 2"
        : "OPEN AT RUNG 3"
      : moved
        ? "NOT WALLED — 404, the recorded path has moved; the host answers us"
        : "STILL WALLED",
  });
}

for (const row of rows) {
  console.log(`  ${row.host}`);
  console.log(`    recorded ${row.recorded} as: ${row.as}`);
  console.log(`    rung 2 — ${row.r2.status ?? "no response"}  ${row.r2.note}${row.r2.bytes ? `, ${row.r2.bytes} bytes` : ""}`);
  console.log(`    rung 3 — ${row.r3.status ?? "no response"}  ${row.r3.note}${row.r3.bytes ? `, ${row.r3.bytes} bytes` : ""}`);
  console.log(`    ${AS_OF}: ${row.verdict}\n`);
}

const open = rows.filter((r) => r.verdict.startsWith("OPEN"));
const moved = rows.filter((r) => r.verdict.startsWith("NOT WALLED"));
const shut = rows.filter((r) => r.verdict === "STILL WALLED");
// The PAIR. A bare "3 fell" hides whether that is 3 of 4 or 3 of 40.
console.log(`  ${rows.length} recorded wall(s) re-tested on ${AS_OF}`);
console.log(`  OPEN TODAY:   ${open.length} — ${open.map((r) => r.host).join(", ") || "none"}`);
console.log(`  PATH MOVED:   ${moved.length} — ${moved.map((r) => r.host).join(", ") || "none"}  (a 404 is not a refusal)`);
console.log(`  STILL WALLED: ${shut.length} — ${shut.map((r) => r.host).join(", ") || "none"}`);
console.log(`  ${open.length} + ${moved.length} + ${shut.length} = ${rows.length}${open.length + moved.length + shut.length === rows.length ? "  (reconciles)" : "  *** DOES NOT RECONCILE ***"}`);
console.log(
  `\n  A wall that is open today is NOT "defeated" — it is one measurement on\n` +
    `  one date at two rungs. RULING 52: no branch result is permanent, in\n` +
    `  either direction. What an open wall IS is a hunt worth running now.\n`,
);

if (rows.length === 0) {
  console.error("re-tested ZERO walls — an error state, not an empty list.");
  process.exit(1);
}
