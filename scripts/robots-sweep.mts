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

const robotsCache = new Map<string, { status: number | null; text: string | null }>();

async function readRobots(origin: string): Promise<{ status: number | null; text: string | null }> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  let out: { status: number | null; text: string | null };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": UA, accept: "text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    out = { status: res.status, text: res.ok ? await res.text() : null };
  } catch {
    out = { status: null, text: null };
  }
  robotsCache.set(origin, out);
  return out;
}

export async function judgeUrl(url: string): Promise<HostVerdict> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, host: url, path: "/", verdict: "CANNOT_TELL", basis: "not a parseable URL", robotsStatus: null };
  }
  const { status, text } = await readRobots(u.origin);

  if (status === null) {
    return {
      url,
      host: u.host,
      path: u.pathname,
      verdict: "CANNOT_TELL",
      basis: "robots.txt could not be fetched at all, so the permission question is unanswered and the walk is refused",
      robotsStatus: null,
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
      console.log(`             ${r.basis}${r.robotsStatus === null ? "" : ` (robots.txt HTTP ${r.robotsStatus})`}`);
    }
    const refused = results.filter((r) => r.verdict === "DISALLOWED" || r.verdict === "CANNOT_TELL");
    console.log(`\n${results.length} judged · ${refused.length} refused · ${results.length - refused.length} walkable`);
  }
}
