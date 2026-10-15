import { fetchSource } from "../lib/sources/fetch-source.ts";



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


export interface RobotsRead {
  readonly status: number | null;
  readonly text: string | null;
  readonly rung: number | null;
}

const robotsCache = new Map<string, RobotsRead>();
async function readRobots(origin: string): Promise<RobotsRead> {
  const hit = robotsCache.get(origin);
  if (hit) return hit;
  let out: RobotsRead = { status: null, text: null, rung: null };
  try {
    const response = await fetchSource(`${origin}/robots.txt`, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(20_000) });
    out = { status: response.status, text: response.ok ? await response.text() : null, rung: 2 };
  } catch {}
  if (robotsCache.size >= 64) robotsCache.delete(robotsCache.keys().next().value!);
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
