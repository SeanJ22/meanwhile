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
const WALLS: { host: string; url: string; recorded: string; as: string }[] = [
  {
    host: "gc.nh.gov",
    url: "https://gc.nh.gov/house/members/member.aspx?pid=1",
    recorded: "2026-08-14",
    as: "TLS-fingerprint wall — RESETS the connection before any HTTP happens, to every client including browsers",
  },
  {
    host: "sos.nh.gov",
    url: "https://www.sos.nh.gov/elections",
    recorded: "2026-08-13",
    as: "host-wide UA wall — 403 after connect, every path",
  },
  {
    host: "www.newbury.nh.gov",
    url: "https://www.newbury.nh.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients; 200 to a browser profile (the NH WAF family)",
  },
  {
    host: "kearsarge.org",
    url: "https://www.kearsarge.org/",
    recorded: "2026-08-16",
    as: "403 to a CI runner's egress; the g3 EGRESS wall, and the one that emptied fifteen sittings",
  },
  {
    host: "www.tucsonaz.gov",
    url: "https://www.tucsonaz.gov/Departments/City-Clerk",
    recorded: "2026-08-14",
    as: "bot wall reading the User-Agent rather than the client — 403 on every page tried",
  },
  {
    host: "www.governor.nh.gov",
    url: "https://www.governor.nh.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients — same NH WAF family as newbury.nh.gov",
  },
  {
    host: "azgovernor.gov",
    url: "https://azgovernor.gov/",
    recorded: "2026-08-14",
    as: "403 to plain clients",
  },
  {
    host: "www.nhmunicipal.org",
    url: "https://www.nhmunicipal.org/",
    recorded: "2026-08-20",
    as: "recorded walled during the NH municipal roster hunt",
  },
  {
    host: "www.merrimackcounty.net",
    url: "https://www.merrimackcounty.net/",
    recorded: "2026-08-20",
    as: "recorded walled during the county-office hunt",
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
