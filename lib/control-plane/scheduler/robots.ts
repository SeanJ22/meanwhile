/**
 * A robots.txt evaluator. Pure; no network. A verdict is recorded evidence and never refuses a public page by
 * itself (`ROBOTS_BLOCKS_ACQUISITION` is false); an access control on the page is what stops a request.
 * `Crawl-delay` is still honoured as spacing.
 *
 *   ALLOWED      a robots document was read and its rules permit the path
 *   DISALLOWED   a robots document was read and its rules name the path (recorded; the page is still read)
 *   NO_ROBOTS    the host serves no robots document (404/410)
 *   CANNOT_TELL  the document could not be read as a robots document (a wall, timeout, 3xx, 5xx, or HTML)
 *
 * Matching follows Google/RFC 9309: our product token's group if one exists, else `*`; longest match between
 * Allow and Disallow, Allow winning a tie; `*` and `$` in paths; an empty `Disallow:` is no rule.
 */

/** A robots.txt verdict is evidence to record and never refuses a public page by itself. */
export const ROBOTS_BLOCKS_ACQUISITION = false as const;

export type PermissionVerdict = "ALLOWED" | "DISALLOWED" | "NO_ROBOTS" | "CANNOT_TELL";

/**
 * A recorded permission state (a workstate `PermissionState`, as a vaulted read or a sidecar carries it) as the
 * evaluator's verdict: `NOT_APPLICABLE` is `NO_ROBOTS`; null when nothing was recorded. The one mapping every
 * reader of a held robots record uses.
 */
export function verdictOfRecordedPermission(permission: string | null | undefined): PermissionVerdict | null {
  switch (permission) {
    case "ALLOWED":
    case "DISALLOWED":
    case "CANNOT_TELL":
      return permission;
    case "NOT_APPLICABLE":
    case "NO_ROBOTS":
      return "NO_ROBOTS";
    default:
      return null;
  }
}

export interface RobotsRule {
  readonly kind: "allow" | "disallow";
  /** The path pattern as written (after trimming). Never empty. */
  readonly path: string;
  /** The source line, for a citation. */
  readonly line: string;
}

export interface RobotsGroup {
  /** Lower-cased product tokens this group addresses. */
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
  readonly crawlDelaySeconds: number | null;
  /** Every line of the group as written, for the operative-lines citation. */
  readonly lines: readonly string[];
}

export interface RobotsDocument {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
  /** Directive lines recognised. Zero on an empty or comment-only document. */
  readonly directiveCount: number;
}

export interface PermissionReading {
  readonly verdict: PermissionVerdict;
  /** The winning rule's source line. Null when no rule matched or nothing was read. */
  readonly matchedRule: string | null;
  readonly crawlDelayMs: number | null;
  readonly detail: string;
  /** The lines of the group that decided the verdict. Empty when nothing was read. */
  readonly operativeLines: readonly string[];
}

export interface RobotsRead {
  /** The body, when a response arrived. Null on a transport failure. */
  readonly robotsText: string | null;
  readonly status: number | null;
  readonly transportError: string | null;
  readonly contentType?: string | null;
}

export const DEFAULT_ROBOTS_TOKEN = "we-the-people";

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  return (hash === -1 ? line : line.slice(0, hash)).trim();
}

export function parseRobots(text: string): RobotsDocument {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let directiveCount = 0;

  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let crawlDelay: number | null = null;
  let lines: string[] = [];
  /* True once a rule line followed the agent lines; the next user-agent line
     then opens a NEW group rather than joining this one. */
  let groupHasRules = false;
  let open = false;

  const flush = () => {
    if (open) groups.push({ agents, rules, crawlDelaySeconds: crawlDelay, lines });
    agents = [];
    rules = [];
    crawlDelay = null;
    lines = [];
    groupHasRules = false;
    open = false;
  };

  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n|\r/)) {
    const line = stripComment(raw);
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent" || field === "useragent") {
      directiveCount += 1;
      if (groupHasRules) flush();
      open = true;
      agents.push(value.toLowerCase());
      lines.push(line);
      continue;
    }
    if (field === "sitemap") {
      directiveCount += 1;
      if (value !== "") sitemaps.push(value);
      continue;
    }
    if (!open) continue; // a rule before any user-agent belongs to nobody

    if (field === "allow" || field === "disallow") {
      directiveCount += 1;
      groupHasRules = true;
      lines.push(line);
      if (value !== "") rules.push({ kind: field, path: value, line });
      continue;
    }
    if (field === "crawl-delay") {
      directiveCount += 1;
      groupHasRules = true;
      lines.push(line);
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelay = seconds;
      continue;
    }
  }
  flush();
  return { groups, sitemaps, directiveCount };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Does the product token belong to this group? Either may be the longer name. */
function agentMatches(agent: string, token: string): boolean {
  if (agent === "*") return false;
  return agent === token || token.startsWith(agent) || agent.startsWith(token);
}

function selectGroups(doc: RobotsDocument, token: string): { groups: RobotsGroup[]; label: string } {
  const ours = doc.groups.filter((g) => g.agents.some((a) => agentMatches(a, token)));
  if (ours.length > 0) return { groups: ours, label: token };
  const star = doc.groups.filter((g) => g.agents.includes("*"));
  return { groups: star, label: "*" };
}

function decide(
  doc: RobotsDocument,
  target: string,
  token: string,
): Omit<PermissionReading, "detail"> & { readonly label: string; readonly detail: string } {
  const { groups, label } = selectGroups(doc, token);
  const rules = groups.flatMap((g) => g.rules);
  const lines = groups.flatMap((g) => g.lines);
  const delays = groups.map((g) => g.crawlDelaySeconds).filter((d): d is number => d !== null);
  const crawlDelayMs = delays.length > 0 ? Math.max(...delays) * 1000 : null;

  let winner: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.path).test(target)) continue;
    if (winner === null || rule.path.length > winner.path.length) winner = rule;
    else if (rule.path.length === winner.path.length && rule.kind === "allow") winner = rule;
  }

  if (groups.length === 0) {
    return {
      verdict: "ALLOWED",
      matchedRule: null,
      crawlDelayMs,
      operativeLines: [],
      label,
      detail: `the robots document names no group for \`${token}\` and no \`*\` group, so no rule reaches ${target}`,
    };
  }
  if (winner === null) {
    return {
      verdict: "ALLOWED",
      matchedRule: null,
      crawlDelayMs,
      operativeLines: lines,
      label,
      detail: `no Allow/Disallow rule in the \`${label}\` group matches ${target}`,
    };
  }
  return {
    verdict: winner.kind === "allow" ? "ALLOWED" : "DISALLOWED",
    matchedRule: winner.line,
    crawlDelayMs,
    operativeLines: lines,
    label,
    detail: `longest-match rule in the \`${label}\` group is \`${winner.line}\` for ${target}`,
  };
}

const HTML_SHAPE = /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<\?xml)/i;

function looksLikeHtml(text: string, contentType: string | null | undefined): boolean {
  const head = text.slice(0, 2048);
  if (HTML_SHAPE.test(head)) return true;
  if (/<(html|head|body|div|script|title)[\s>]/i.test(head)) return true;
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) {
    return !/^\s*(user-agent|allow|disallow|sitemap)\s*:/im.test(head);
  }
  return false;
}

/**
 * Evaluate one URL against one robots.txt READ. The read's transport shape
 * decides first; only a genuinely read document is parsed.
 */
export function evaluatePermission(
  read: RobotsRead,
  url: string,
  userAgentToken: string = DEFAULT_ROBOTS_TOKEN,
): PermissionReading {
  const token = userAgentToken.toLowerCase();
  const none = (verdict: PermissionVerdict, detail: string): PermissionReading => ({
    verdict,
    matchedRule: null,
    crawlDelayMs: null,
    detail,
    operativeLines: [],
  });

  if (read.transportError !== null) {
    return none("CANNOT_TELL", `robots.txt could not be retrieved with this client: ${read.transportError}. A transport failure is not a reading of the host's rules; recorded as unread`);
  }
  const status = read.status;
  if (status === null) return none("CANNOT_TELL", "robots.txt read returned no status and no error; recorded as unread");
  if (status === 404 || status === 410) {
    return none("NO_ROBOTS", `robots.txt answered HTTP ${status}: the host serves no robots document. Nothing to record beyond its absence`);
  }
  if (status >= 300 && status < 400) {
    return none("CANNOT_TELL", `robots.txt answered HTTP ${status} (a redirect that was not followed to a robots document); recorded as unread`);
  }
  if (status === 401 || status === 403 || status === 429) {
    return none("CANNOT_TELL", `robots.txt answered HTTP ${status} to this client — a wall in front of the robots document, not a rule. Recorded as unread; the page's own answer decides`);
  }
  if (status >= 400) {
    return none("CANNOT_TELL", `robots.txt answered HTTP ${status}; not a robots document and not a 404. Recorded as unread`);
  }
  if (status < 200 || status >= 300) {
    return none("CANNOT_TELL", `robots.txt answered HTTP ${status}; recorded as unread`);
  }

  const text = read.robotsText ?? "";
  if (looksLikeHtml(text, read.contentType)) {
    return none("CANNOT_TELL", "robots.txt answered HTTP 200 with an HTML page, not a robots document (a redirect to a page, or a soft 404). Recorded as unread");
  }
  const doc = parseRobots(text);
  if (doc.directiveCount === 0 && text.trim() !== "") {
    return none("CANNOT_TELL", "robots.txt answered HTTP 200 with a body carrying no robots directive at all; not robots-shaped, so recorded as unread");
  }

  let target: string;
  try {
    const parsed = new URL(url);
    target = `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return none("CANNOT_TELL", `the target ${url} is not a URL`);
  }

  const decided = decide(doc, target, token);
  return {
    verdict: decided.verdict,
    matchedRule: decided.matchedRule,
    crawlDelayMs: decided.crawlDelayMs,
    detail:
      doc.directiveCount === 0
        ? "robots.txt answered HTTP 200 with an empty document: no rules, so no restriction"
        : decided.detail,
    operativeLines: decided.operativeLines,
  };
}
