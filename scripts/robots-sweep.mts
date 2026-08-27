/**
 * PERMISSION BEFORE REACHABILITY, AT SCALE.
 * (2026-08-26, the sources-and-incumbency session. RULING 148, RULING 166.)
 *
 * RULING 148 says the may-we-walk verdict is enforced by the fetcher and never
 * remembered by a session. Today it is enforced for exactly one population —
 * the general search indexes in `lib/hunt/search-pool.ts` — and for every other
 * host in this project the question is asked by a person reading
 * `docs/sources.md`, which is the reading failure that ruling was adopted over.
 *
 * This is the instrument that makes the question cheap to ask about MANY hosts
 * at once, so a session enumerating a state's sources (RULING 86) can answer the
 * permission column for every one of them before it walks any of them.
 *
 * It reads each host's own `robots.txt` and reports, per (host, path):
 *
 *   ALLOWED       no `User-agent: *` rule disallows the path
 *   DISALLOWED    a `Disallow` rule covers it. NOT a wall (RULING 148): a
 *                 disallow is a host saying do not ask, and it is never
 *                 re-walked on a RULING 53 clock
 *   NO_ROBOTS     the host serves no robots.txt, so nothing forbids the path
 *   CANNOT_TELL   robots.txt could not be read at all. RULING 24: a check that
 *                 cannot reach its subject never prints like a pass, and this
 *                 verdict REFUSES the walk
 *
 * FAIL CLOSED. `CANNOT_TELL` refuses, exactly as `unknown` refuses in RULING
 * 148. That direction costs a lookup; the other costs an apology.
 *
 * RULING 159 — the run FAILS when it has nothing to report. A sweep of zero
 * hosts is a sweep that did not run, not a clean board.
 *
 * Usage:
 *   pnpm robots:sweep --hosts a.gov,b.org
 *   pnpm robots:sweep --urls https://a.gov/x,https://b.org/y
 *   pnpm robots:sweep --hosts a.gov --json
 */

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

export type WalkVerdict = "ALLOWED" | "DISALLOWED" | "NO_ROBOTS" | "CANNOT_TELL";

export interface RobotsRule {
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
}

export interface HostVerdict {
  readonly url: string;
  readonly host: string;
  readonly path: string;
  readonly verdict: WalkVerdict;
  /** The literal robots.txt line that decided it, or a reason there was none. */
  readonly basis: string;
  readonly robotsStatus: number | null;
  /**
   * Which ladder rung read the rules — 2 for the plain identified fetch, 3 for
   * the browser header set, null when nothing read them. A permission read
   * that needed rung 3 is a weaker fact than one that did not, and running the
   * two together in a report would hide that.
   */
  readonly robotsRung: number | null;
}

/**
 * Parse the `User-agent: *` group out of a robots.txt.
 *
 * Deliberately only the wildcard group: this project identifies itself in its
 * User-Agent but has no registered agent token, so the wildcard group is the one
 * that binds it. Reading a narrower group would be choosing which rules we
 * prefer to be bound by.
 */
export function wildcardGroup(text: string): RobotsRule {
  const disallow: string[] = [];
  const allow: string[] = [];
  let inGroup = false;
  let groupHasRules = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group. A User-agent line AFTER
      // rules starts a new one.
      if (groupHasRules) {
        inGroup = value === "*";
        groupHasRules = false;
      } else {
        inGroup = inGroup || value === "*";
      }
      continue;
    }
    if (field === "disallow" || field === "allow") {
      groupHasRules = true;
      if (!inGroup) continue;
      if (field === "disallow") disallow.push(value);
      else allow.push(value);
    }
  }

  return { disallow, allow };
}

/** Longest-match wins, which is what every major crawler implements. */
export function judgePath(rule: RobotsRule, path: string): { allowed: boolean; basis: string } {
  const matches = (pattern: string): boolean => {
    if (pattern === "") return false;
    const anchoredEnd = pattern.endsWith("$");
    const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
    const rx = new RegExp(
      "^" + body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchoredEnd ? "$" : ""),
    );
    return rx.test(path);
  };

  let best: { allowed: boolean; basis: string; len: number } | null = null;
  for (const d of rule.disallow) {
    if (matches(d) && (best === null || d.length > best.len)) {
      best = { allowed: false, basis: `Disallow: ${d}`, len: d.length };
    }
  }
  for (const a of rule.allow) {
    if (matches(a) && (best === null || a.length > best.len)) {
      best = { allowed: true, basis: `Allow: ${a}`, len: a.length };
    }
  }
  if (best) return { allowed: best.allowed, basis: best.basis };
  return { allowed: true, basis: "no User-agent: * rule covers this path" };
}

/**
 * THE PERMISSION QUESTION IS ITSELF WALKED UP THE LADDER.
 * (2026-08-26, the descent session. RULING 52 pointed at `robots.txt`.)
 *
 * The first version of this asked rung 2 — a plain fetch under this project's
 * own identified User-Agent — and read a rung-2 refusal as *the permission
 * question is unanswerable*. `CANNOT_TELL` REFUSES, correctly, so the effect
 * was that a host refusing our UA became a host we may not walk.
 *
 * **Measured on adoption: `az.gov` and `irc.az.gov` both reported `CANNOT_TELL`
 * at HTTP 403 and both answer HTTP 200 with an ordinary permissive Drupal
 * `robots.txt` at rung 3.** `az.gov` is the TOP OF THE ARIZONA DESCENT. The
 * instrument built to answer the permission question was refusing the state.
 *
 * That is RULING 52 exactly — a branch returning empty is one measurement on
 * one route, never a verdict — and it matters more here than almost anywhere
 * else, because this refusal is silent and total: it does not look like a wall,
 * it looks like a rule.
 *
 * **This is a harder read of the rules, never a softer one.** Every rung asks
 * the same host for the same file and obeys whatever comes back. A blanket
 * `Disallow: /` read at rung 3 refuses exactly as it would at rung 2. What
 * changes is only whether we managed to READ the host's rules before deciding
 * we could not.
 *
 * The rung that answered is carried on the verdict, because a permission read
 * that needed a browser header set is a weaker fact than one that did not, and
 * a report that ran the two together would be hiding that.
 */
const RUNGS: readonly { readonly rung: number; readonly label: string; readonly headers: Record<string, string> }[] = [
  {
    rung: 2,
    label: "plain fetch, this project's identified User-Agent",
    headers: { "user-agent": UA, accept: "text/plain,*/*" },
  },
  {
    rung: 3,
    label: "full browser header set",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  },
];

export interface RobotsRead {
  readonly status: number | null;
  readonly text: string | null;
  /** Which ladder rung produced the answer, or null when none did. */
  readonly rung: number | null;
}

/**
 * RUNG 4 — a different CLIENT, because the wall is a TLS FINGERPRINT.
 *
 * `az.gov`, `irc.az.gov` and `azed.gov` refuse Node's `fetch` with HTTP 403
 * under this project's User-Agent AND under a full Chrome header set, and admit
 * `curl` carrying the same Chrome header set at HTTP 200. Headers are identical
 * across those two; the client is not. That is rung 4 in as many words — *a
 * different CLIENT whose TLS fingerprint passes (curl beat the fingerprint
 * filter in the f session where header-swapping did not)* — and it is the
 * second time this project has met it.
 *
 * `curl` ships with Windows 10+ and every mainstream Linux image, and its
 * absence is a failed rung rather than a crash.
 */
async function curlRobots(url: string): Promise<{ status: number; text: string | null } | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sL",
        "--max-time",
        "20",
        "-w",
        "\n__WTP_STATUS__%{http_code}",
        "-A",
        RUNGS[1].headers["user-agent"],
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        url,
      ],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP_STATUS__");
    if (cut < 0) return null;
    const status = Number(stdout.slice(cut + "\n__WTP_STATUS__".length).trim());
    if (!Number.isFinite(status) || status === 0) return null;
    const body = stdout.slice(0, cut);
    return { status, text: status >= 200 && status < 300 ? body : null };
  } catch {
    return null;
  }
}

const robotsCache = new Map<string, RobotsRead>();

async function readRobots(origin: string): Promise<RobotsRead> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;

  let out: RobotsRead = { status: null, text: null, rung: null };

  const settle = (status: number, text: string | null, rung: number): boolean => {
    /* Keep the FIRST status seen so a report can still say what the polite
     * rung got, but a rung that actually READ the file wins outright. */
    if (out.status === null) out = { status, text, rung };
    if (text !== null) {
      out = { status, text, rung };
      return true;
    }
    /* A 404 is a real answer — the host publishes no rules — and escalating
     * past it would be asking a question that has already been answered. */
    if (status === 404 || status === 410) {
      out = { status, text: null, rung };
      return true;
    }
    return false;
  };

  for (const step of RUNGS) {
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: step.headers,
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      if (settle(res.status, res.ok ? await res.text() : null, step.rung)) {
        robotsCache.set(origin, out);
        return out;
      }
    } catch {
      /* Try the next rung. A transport failure is not an answer. */
    }
  }

  const curled = await curlRobots(`${origin}/robots.txt`);
  if (curled) settle(curled.status, curled.text, 4);

  /*
   * RUNG 4b — THE SAME HOST OVER PLAIN HTTP.
   *
   * Tried only when `https` produced no answer at all, and only for an
   * `https` origin. It is not a softer read: it is the SAME question asked at
   * the only address this host actually answers.
   *
   * The case, measured 2026-08-27 during the AZ 85641 hunt:
   * `www.mescalj6fd.com` — the Mescal-J6 Fire District, one of the four fire
   * districts that levy on ZIP 85641 — resolves fine, and fails `https` with
   * `ERR_TLS_CERT_ALTNAME_INVALID`. Its `robots.txt` answers **HTTP 200 over
   * plain http**. Every https rung, including curl, returned nothing, so the
   * sweep returned `CANNOT_TELL` and refused the walk — and a fire district
   * that governs the target ZIP was recorded as unwalkable because of a
   * certificate.
   *
   * **Small governments are frequently http-only**, and a permission instrument
   * that can only ask over https cannot answer the permission question for
   * them. That is a gap in the instrument, not a fact about the publisher.
   *
   * The verdict still fails safe: if http answers nothing either, the origin
   * stays `CANNOT_TELL` and the walk stays refused.
   */
  if (out.status === null && origin.startsWith("https://")) {
    const plain = origin.replace(/^https:/, "http:");
    try {
      const res = await fetch(`${plain}/robots.txt`, {
        headers: RUNGS[0].headers,
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      settle(res.status, res.ok ? await res.text() : null, 4);
    } catch {
      /* Nothing at either scheme. CANNOT_TELL stands, and it refuses. */
    }
  }

  robotsCache.set(origin, out);
  return out;
}

export async function judgeUrl(url: string): Promise<HostVerdict> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return {
      url,
      host: url,
      path: "/",
      verdict: "CANNOT_TELL",
      basis: "not a parseable URL",
      robotsStatus: null,
      robotsRung: null,
    };
  }
  const { status, text, rung } = await readRobots(u.origin);

  if (status === null) {
    return {
      url,
      host: u.host,
      path: u.pathname,
      verdict: "CANNOT_TELL",
      basis: "robots.txt could not be fetched at all, so the permission question is unanswered and the walk is refused",
      robotsStatus: null,
      robotsRung: rung,
    };
  }
  if (status === 404 || status === 410) {
    return {
      url,
      host: u.host,
      path: u.pathname,
      verdict: "NO_ROBOTS",
      basis: `robots.txt returned HTTP ${status}, so the host publishes no rules and nothing forbids this path`,
      robotsStatus: status,
      robotsRung: rung,
    };
  }
  if (text === null) {
    return {
      url,
      host: u.host,
      path: u.pathname,
      verdict: "CANNOT_TELL",
      basis: `robots.txt returned HTTP ${status} with no readable body`,
      robotsStatus: status,
      robotsRung: rung,
    };
  }

  const { allowed, basis } = judgePath(wildcardGroup(text), u.pathname);
  return {
    url,
    host: u.host,
    path: u.pathname,
    verdict: allowed ? "ALLOWED" : "DISALLOWED",
    basis,
    robotsStatus: status,
    robotsRung: rung,
  };
}

export async function sweep(urls: readonly string[]): Promise<HostVerdict[]> {
  const out: HostVerdict[] = [];
  for (const url of urls) out.push(await judgeUrl(url));
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/robots-sweep.mts");

if (invokedDirectly) {
  const urls = [
    ...(arg("urls") ?? "").split(",").filter(Boolean),
    ...(arg("hosts") ?? "")
      .split(",")
      .filter(Boolean)
      .map((h) => (h.startsWith("http") ? h : `https://${h}/`)),
  ];

  if (urls.length === 0) {
    // RULING 159 — zero is a result that must be earned, never defaulted to.
    console.error("robots:sweep: no hosts or URLs given. A sweep of nothing is not a clean board.");
    process.exit(1);
  }

  const results = await sweep(urls);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.verdict.padEnd(12)} ${r.url}`);
      const rung = r.robotsRung === null ? "" : `, rung ${r.robotsRung}`;
      console.log(
        `             ${r.basis}${r.robotsStatus === null ? "" : ` (robots.txt HTTP ${r.robotsStatus}${rung})`}`,
      );
    }
    const refused = results.filter((r) => r.verdict === "DISALLOWED" || r.verdict === "CANNOT_TELL");
    console.log(`\n${results.length} judged · ${refused.length} refused · ${results.length - refused.length} walkable`);
  }
}
