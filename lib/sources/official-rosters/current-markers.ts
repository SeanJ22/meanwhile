import { first, hasClass, linkUrl, nodes, parseHtml, textOf } from "./html.ts";
import type { LegislatureChamber, OfficialRosterTarget } from "./targets.ts";

type Route = { url: string; chamber: LegislatureChamber | "both" };

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Official roster current marker: ${label} is absent`);
  return value.trim();
}

function markerUrl(target: OfficialRosterTarget, origin: string, path: RegExp): string {
  const value = required(target.currentMarker?.url, "source URL");
  const parsed = new URL(value);
  if (parsed.origin !== origin || !path.test(parsed.pathname) || parsed.username || parsed.password || parsed.search) throw new Error("Official roster current marker is outside its observed publisher source");
  return parsed.href;
}

function replaceRoutes(target: OfficialRosterTarget, routes: Route[]): OfficialRosterTarget {
  if (!routes.length) throw new Error("Official roster current marker contains no roster routes");
  return { ...target, routes: routes.map(route => route.url), legislatureRoutes: routes };
}

function southDakota(target: OfficialRosterTarget, body: string): OfficialRosterTarget {
  markerUrl(target, "https://sdlegislature.gov", /^\/api\/Sessions\/?$/);
  const rows = JSON.parse(body) as { CurrentSession?: unknown; SessionId?: unknown }[];
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== "object" || typeof row.CurrentSession !== "boolean")) throw new Error("South Dakota official session marker schema changed");
  const current = rows.filter(row => row.CurrentSession === true);
  if (current.length !== 1 || !Number.isInteger(current[0]!.SessionId) || Number(current[0]!.SessionId) <= 0) throw new Error("South Dakota official marker lacks one current session ID");
  return replaceRoutes(target, [{ url: `https://sdlegislature.gov/api/SessionMembers/Session/${current[0]!.SessionId}`, chamber: "both" }]);
}

function vermont(target: OfficialRosterTarget, body: string): OfficialRosterTarget {
  const source = markerUrl(target, "https://legislature.vermont.gov", /^\/people\/?$/);
  const root = parseHtml(body);
  const selected = first(root, node => node.tag === "form" && hasClass(node, "session-current"));
  const term = selected ? /^Searching (\d{4})-(\d{4}) Session\b/.exec(textOf(selected)) : null;
  if (!term || Number(term[2]) !== Number(term[1]) + 1) throw new Error("Vermont official current-session label is absent");
  const all = nodes(root, node => node.tag === "a" && /^\/people\/all\/\d{4}\/?$/.test(node.attrs.href ?? ""));
  const years = new Set(all.map(node => /\/people\/all\/(\d{4})/.exec(new URL(linkUrl(node, source)).pathname)![1]));
  if (years.size !== 1 || !years.has(term[2]!)) throw new Error("Vermont official current-session label and all-member link disagree");
  return replaceRoutes(target, [{ url: `https://legislature.vermont.gov/people/loadAll/${term[2]}/`, chamber: "both" }]);
}

function wisconsin(target: OfficialRosterTarget, body: string): OfficialRosterTarget {
  const source = markerUrl(target, "https://docs.legis.wisconsin.gov", /^\/$/);
  const root = parseHtml(body);
  const current = first(root, node => node.attrs.id === "d_publisher_current");
  if (!current) throw new Error("Wisconsin official current-biennium menu is absent");
  const routes: Route[] = [];
  const years = new Set<string>();
  for (const [chamber, slug] of [["lower", "assembly"], ["upper", "senate"]] as const) {
    const matches = nodes(current, node => node.tag === "a" && new RegExp(`^/\\d{4}/legislators/${slug}/?$`).test(node.attrs.href ?? ""));
    if (matches.length !== 1) throw new Error("Wisconsin official current-biennium menu lacks one route per chamber");
    const url = linkUrl(matches[0]!, source);
    if (new URL(url).origin !== new URL(source).origin) throw new Error("Wisconsin official current roster left the publisher origin");
    years.add(/^\/(\d{4})\//.exec(new URL(url).pathname)![1]!);
    routes.push({ url, chamber });
  }
  if (years.size !== 1) throw new Error("Wisconsin official current chambers disagree about the biennium");
  return replaceRoutes(target, routes);
}

function northDakota(target: OfficialRosterTarget, body: string): OfficialRosterTarget {
  const source = markerUrl(target, "https://ndlegis.gov", /^\/$/);
  const root = parseHtml(body);
  const current = nodes(root, node => node.tag === "a" && /\(Current\)/.test(textOf(node)) && /^\/assembly\/\d+-\d{4}\/regular\/?$/.test(node.attrs.href ?? ""));
  const bases = new Set(current.map(node => linkUrl(node, source).replace(/\/$/, "")));
  if (bases.size !== 1) throw new Error("North Dakota official source lacks one explicitly current regular assembly");
  const base = [...bases][0]!;
  const memberUrl = `${base}/members`;
  if (!first(root, node => node.tag === "a" && linkUrl(node, source) === memberUrl)) throw new Error("North Dakota current assembly and published members route disagree");
  // Keep the acquired pagination plan while replacing only its publisher-selected assembly.
  const prior = target.legislatureRoutes ?? target.routes.map(url => ({ url, chamber: "both" as const }));
  const routes = prior.map(route => {
    const old = new URL(route.url);
    if (old.origin !== "https://ndlegis.gov" || !/^\/assembly\/\d+-\d{4}\/regular\/members\/?$/.test(old.pathname)) throw new Error("North Dakota roster pagination plan has an unknown route");
    const url = new URL(memberUrl);
    for (const [key, value] of old.searchParams) {
      if (key !== "page" || !/^\d+$/.test(value)) throw new Error("North Dakota roster pagination query schema changed");
      url.searchParams.append(key, value);
    }
    return { url: url.href, chamber: route.chamber };
  });
  return replaceRoutes(target, routes);
}

function wyomingModuleUrl(value: string): string {
  const url = new URL(value, "https://wyoleg.gov/");
  if (url.origin !== "https://wyoleg.gov" || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+\.js$/.test(url.pathname)) throw new Error("Wyoming current application module is outside its declared official origin");
  return url.href;
}

/** These modules are declared by the current root, rather than remembered hashes. */
export function wyomingCurrentModuleRoutes(body: string): readonly string[] {
  const root = parseHtml(body);
  const modules = nodes(root, node => node.tag === "link" && (node.attrs.rel ?? "").split(/\s+/).includes("modulepreload"));
  if (modules.length !== 4) throw new Error("Wyoming current root no longer declares exactly four application modules");
  const urls = modules.map(node => wyomingModuleUrl(required(node.attrs.href, "Wyoming module URL")));
  if (new Set(urls).size !== urls.length) throw new Error("Wyoming current root repeats a module URL");
  return urls;
}

/** The collector supplies all modules selected by the current root above. */
export function resolveWyomingCurrentModules(target: OfficialRosterTarget,
  documents: readonly { readonly url: string; readonly body: string }[], now: string): OfficialRosterTarget {
  if (target.kind !== "legislature" || target.state !== "WY" || !Number.isFinite(Date.parse(now))) throw new Error("Wyoming current modules require a Wyoming legislature and valid check instant");
  markerUrl(target, "https://wyoleg.gov", /^\/$/);
  if (documents.length !== 4 || new Set(documents.map(document => wyomingModuleUrl(document.url))).size !== 4) throw new Error("Wyoming current application module acquisition is incomplete");
  const declarations: string[] = [];
  for (const document of documents) {
    if (!document.body.trim()) throw new Error("Wyoming current application module is empty");
    for (const match of document.body.matchAll(/\bthis\.legislativeYear\s*=\s*(\d{4})(?=\s*[,;})])/g)) declarations.push(match[1]!);
  }
  if (declarations.length !== 1) throw new Error("Wyoming current application modules lack one declared legislative year");
  const year = declarations[0]!;
  return replaceRoutes(target, [
    { url: `https://wyoleg.gov/LsoService/api/Legislator/${year}/H`, chamber: "lower" },
    { url: `https://wyoleg.gov/LsoService/api/Legislator/${year}/S`, chamber: "upper" },
  ]);
}

/** The publisher identifies the current term; a check date never manufactures it. */
export function resolveOfficialRosterMarker(target: OfficialRosterTarget, bytes: Uint8Array, now: string): OfficialRosterTarget {
  if (target.kind !== "legislature" || !target.state || !Number.isFinite(Date.parse(now))) throw new Error("Official roster marker requires a legislature and valid check instant");
  const body = new TextDecoder().decode(bytes);
  if (!body.trim()) throw new Error("Official roster current marker is empty");
  switch (target.state) {
    case "SD": return southDakota(target, body);
    case "VT": return vermont(target, body);
    case "WI": return wisconsin(target, body);
    case "ND": return northDakota(target, body);
    case "KS": throw new Error("Kansas current-session marker is unavailable; a dated roster cannot establish the current session");
    case "WY": throw new Error("Wyoming current-year marker requires acquiring the application modules declared by the current root");
    default: throw new Error(`Official current-roster marker schema is not implemented for ${target.state}`);
  }
}
