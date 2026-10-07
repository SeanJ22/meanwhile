import { defaultPlatformFingerprints, platformFingerprints, type PlatformFingerprint } from "../control-plane/platform-fingerprints.ts";
import type { FieldManualEntry } from "../control-plane/field-manual.ts";
/**
 * Is this body a tenant of a platform we already read? Detected by shape, in
 * increasing strength, and kept apart on the result:
 *
 *   1. LINKED: the body's own page links out to a vendor host.
 *   2. SERVED_BY: a vendor's markup fingerprint on the body's own domain
 *      (CivicPlus, Revize and Apptegy host under the customer's name).
 *   3. DERIVED_LEAD: a guessed tenant path answers. A lead, never a hit: a
 *      200 says a tenant of that name exists, not that it is this body's.
 */

/** Every platform this project already has an adapter for. */
export const KNOWN_PLATFORMS = defaultPlatformFingerprints().filter(p => p.haveAdapter);

export type PlatformId = string;

/**
 * Platforms we can recognise but have no adapter for: scoped work, a
 * different fact from publishing nothing machine-readable.
 */
export const UNHANDLED_PLATFORMS = defaultPlatformFingerprints().filter(p => !p.haveAdapter);

/**
 * Markup fingerprints for vendors that host under the customer's own domain,
 * which a link-out test cannot find.
 */
export const MARKUP_FINGERPRINTS = defaultPlatformFingerprints().flatMap(p => p.markup.map(f => ({ ...f, platform: p.id })));

export type TenancyStrength = "LINKED" | "SERVED_BY" | "DERIVED_LEAD";

export interface TenancyHit {
  readonly platform: string;
  readonly label: string;
  /** Do we already have an adapter that reads this platform? */
  readonly haveAdapter: boolean;
  readonly strength: TenancyStrength;
  /** The literal evidence — a URL we saw, or the fingerprint that matched. */
  readonly evidence: string;
}

function labelFor(id: string, fingerprints: readonly PlatformFingerprint[]): { label: string; haveAdapter: boolean } {
  const known = fingerprints.find((p) => p.id === id && p.haveAdapter);
  if (known) return { label: known.label, haveAdapter: true };
  const un = fingerprints.find((p) => p.id === id && !p.haveAdapter);
  if (un) return { label: un.label, haveAdapter: false };
  return { label: id, haveAdapter: false };
}

/**
 * Read a body's page and say which platforms it is a tenant of. Returns every
 * hit, not the best one: a site can be served by one vendor and link its
 * agendas to another.
 */
export function detectTenancy(html: string, pageUrl: string, entries?: readonly FieldManualEntry[]): readonly TenancyHit[] {
  const fingerprints = entries ? platformFingerprints(entries) : defaultPlatformFingerprints();
  const hits: TenancyHit[] = [];
  const seen = new Set<string>();

  const push = (platform: string, strength: TenancyStrength, evidence: string): void => {
    const key = `${platform}:${strength}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { label, haveAdapter } = labelFor(platform, fingerprints);
    hits.push({ platform, label, haveAdapter, strength, evidence });
  };

  /* 1. LINKED: the body's own page pointing at a vendor host. A link to a
   * vendor's own marketing or training subdomain (present on every site the
   * vendor builds) is the weakest form and says so in its evidence string. */
  const hrefs = html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  for (const href of hrefs) {
    let host: string;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    const boilerplate = /university|training|support|help|marketing|\bwww\.(civicplus|revize|granicus)\./i.test(host);
    for (const p of fingerprints) {
      if (!p.hostPattern.test(host)) continue;
      push(
        p.id,
        "LINKED",
        boilerplate ? `${href.slice(0, 160)} — VENDOR BOILERPLATE, weakest form of the signal` : href.slice(0, 200),
      );
    }
  }

  /* 2. SERVED_BY — a vendor's markup on the body's own domain. */
  let selfHost = "";
  try {
    selfHost = new URL(pageUrl).hostname;
  } catch {
    /* an unparseable page URL still gets the markup test */
  }
  for (const f of fingerprints.flatMap(p => p.markup.map(m => ({...m, platform:p.id})))) {
    const m = f.pattern.exec(html);
    if (!m) continue;
    /* If the only reason it matched is a link we already counted, do not claim
     * the stronger fact twice under a weaker name. */
    push(f.platform, "SERVED_BY", `${f.why} — matched "${m[0].slice(0, 60)}" on ${selfHost || pageUrl}`);
  }

  return hits;
}

/** Candidate tenant slugs derived from a host, for the LEAD probe. */
export function derivedSlugs(host: string): readonly string[] {
  const bare = host.replace(/^www\./i, "").split(".")[0];
  if (!bare || bare.length < 3) return [];
  const out = new Set<string>([bare]);
  /* `<place>township` → also `<place>`: a vendor slug is usually the place,
   * not the place plus its form of government. */
  for (const suffix of ["township", "borough", "county", "city", "town", "village", "sd", "usd"]) {
    if (bare.endsWith(suffix) && bare.length > suffix.length + 2) out.add(bare.slice(0, -suffix.length));
  }
  return [...out];
}

export interface TenancyRow {
  readonly body: string;
  readonly url: string;
  readonly hits: readonly TenancyHit[];
}

/**
 * A four-way split rather than a count: reachable now, on a platform we do
 * not handle, nothing machine-readable detected, and could not read.
 */
export interface TenancySplit {
  /** Bodies on a platform we already read. THE CHEAP COVERAGE. */
  readonly reachableNow: number;
  /** Bodies on a platform we recognise and have no adapter for. Scoped work. */
  readonly unhandledPlatform: number;
  /** Bodies where nothing machine-readable was detected. A hunt, not a build. */
  readonly nothingDetected: number;
  /** Bodies whose page could not be read at all; never a zero. */
  readonly couldNotRead: number;
}

export function splitTenancy(rows: readonly TenancyRow[], unreadable: number): TenancySplit {
  let reachableNow = 0;
  let unhandledPlatform = 0;
  let nothingDetected = 0;
  for (const r of rows) {
    const real = r.hits.filter((h) => h.strength !== "DERIVED_LEAD");
    if (real.some((h) => h.haveAdapter)) reachableNow += 1;
    else if (real.length > 0) unhandledPlatform += 1;
    else nothingDetected += 1;
  }
  return { reachableNow, unhandledPlatform, nothingDetected, couldNotRead: unreadable };
}
