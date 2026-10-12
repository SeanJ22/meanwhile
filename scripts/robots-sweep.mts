/**
 * Reads each host's own `robots.txt` and records, per (host, path):
 *
 *   ALLOWED       no `User-agent: *` rule disallows the path
 *   DISALLOWED    a `Disallow` rule covers it — recorded, and not blocking
 *   NO_ROBOTS     the host serves no robots.txt
 *   CANNOT_TELL   robots.txt could not be read at all; reported as unread
 *
 * No verdict refuses a walk. A robots.txt that answered 401, 403 or 429, or a
 * challenge page, is reported as a sign the host walls this client by an
 * access control, which the walk must never bypass (`lib/hunt/access-control.ts`).
 * The run fails when it has nothing to report.
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
  /** Which ladder rung read the rules (2 plain, 3 browser headers), null when none did. A rung-3 read is a weaker fact. */
  readonly robotsRung: number | null;
}

/** Parse the `User-agent: *` group: with no registered agent token, the wildcard group is the one that binds us. */
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
 * The permission question is itself walked up the ladder: a refusal of our own
 * User-Agent is one measurement on one route, not the host's rules. Every rung
 * asks for the same file and obeys whatever comes back; the rung that answered
 * is carried on the verdict.
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
 * Rung 4: a different client, because some hosts refuse Node's `fetch` by TLS
 * fingerprint and admit `curl` with the same headers. A missing `curl` is a
 * failed rung, not a crash.
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
    /* Keep the first status seen, but a rung that actually read the file wins outright. */
    if (out.status === null) out = { status, text, rung };
    if (text !== null) {
      out = { status, text, rung };
      return true;
    }
    /* A 404 is a real answer (no rules published); escalating past it would re-ask an answered question. */
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
   * Rung 4b: the same host over plain http, tried only when https produced no
   * answer. Small governments are often http-only (for example a certificate that
   * does not match the host). If http answers nothing either, the origin stays
   * CANNOT_TELL: recorded as unread, and not blocking.
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
      /* Nothing at either scheme. CANNOT_TELL stands, recorded as unread. */
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
      basis: "robots.txt could not be fetched at all: recorded as unread, and not blocking (owner decision 2026-09-25)",
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
    // Zero hosts is a sweep that did not run, never a clean board.
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
    /* Recorded, never a refusal: every public path is walkable; an access control is not. */
    const disallowed = results.filter((r) => r.verdict === "DISALLOWED").length;
    const unread = results.filter((r) => r.verdict === "CANNOT_TELL").length;
    console.log(`\n${results.length} recorded · ${disallowed} named by a Disallow (recorded, not blocking) · ${unread} unread`);
  }
}
