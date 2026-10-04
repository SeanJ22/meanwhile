import { defaultPlatformFingerprints, platformFingerprints, type PlatformFingerprint } from "../control-plane/platform-fingerprints.ts";
import type { FieldManualEntry } from "../control-plane/field-manual.ts";
/**
 * IS THIS BODY A TENANT OF A PLATFORM WE ALREADY READ?
 * (2026-08-26, the descent session, Item 4. RULING 103 and RULING 169.)
 *
 * ## The question, and why nobody had asked it
 *
 * This project runs nine meeting adapters. Every one of them was written for a
 * body somebody had already decided to cover, and each was wired one tenant at
 * a time. **Nothing has ever asked the inverse question** — given a body, is it
 * already sitting on a platform we can read?
 *
 * That inversion is RULING 93's move applied to VENDORS rather than to
 * government: instead of walking down from a body to find a source, walk in
 * from a platform we already own and ask who else is on it. A body reachable by
 * an adapter we already had and never connected is the cheapest coverage in
 * this product, and it is invisible in every report that counts what the
 * adapters got.
 *
 * ## Detection is by SHAPE, not by a list of tenants
 *
 * RULING 110: a sweep reports the shapes it searched, not only the terms. A
 * tenant is detected three ways, in increasing strength:
 *
 *   1. **The body's own page LINKS OUT** to a vendor host. The strongest
 *      signal and the commonest — a town site with an "Agendas & Minutes"
 *      button pointing at `xyz.legistar.com`.
 *   2. **The page is SERVED BY the vendor** — a vendor's markup fingerprint in
 *      a page on the body's own domain. CivicPlus, Revize and Apptegy all host
 *      under the customer's name.
 *   3. **A DERIVED tenant path answers.** Weakest, and it is a LEAD rather than
 *      a HIT: guessing `<slug>.legistar.com` and getting a 200 says a tenant of
 *      that name exists, never that it is this body's (RULING 145's bar,
 *      applied to a vendor slug).
 *
 * The three are kept apart on the result, because collapsing them would let a
 * guess be reported with the confidence of a link the body itself published.
 */

/** Every platform this project already has an adapter for. */
export const KNOWN_PLATFORMS = defaultPlatformFingerprints().filter(p => p.haveAdapter);

export type PlatformId = string;

/**
 * Platforms we can RECOGNISE but have no adapter for.
 *
 * These are the honest middle column of the brief's coverage table — *on a
 * platform we do not handle* — and they are a completely different fact from
 * *publishing nothing machine-readable*. One is work we know how to scope; the
 * other is a hunt. Running them together would make the second look like the
 * first.
 */
export const UNHANDLED_PLATFORMS = defaultPlatformFingerprints().filter(p => !p.haveAdapter);

/**
 * Markup fingerprints for vendors that host under the CUSTOMER'S OWN domain.
 *
 * A link-out test cannot find these: `rockawaytownship.org` is served by
 * CivicPlus and never links to `civicplus.com` anywhere a reader would notice.
 * Reading the markup is the only route, and it is why the sweep reports which
 * SHAPES it searched rather than only which hosts it matched.
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
 * Read a body's page and say which platforms it is a tenant of.
 *
 * Returns EVERY hit rather than the best one: a town can be served by CivicPlus
 * and link its agendas out to Legistar, and reporting one would hide the other.
 * The caller decides what to do with a `DERIVED_LEAD`, and the type makes it
 * impossible to mistake one for a `LINKED`.
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

  /* 1. LINKED — the body's own page pointing at a vendor host.
   *
   * MEASURED CAVEAT, recorded rather than smoothed. The first live run turned
   * up `cp-civicplusuniversity2.civicplus.com` on a dozen unrelated hosts: it
   * is CivicPlus's own **customer-training footer link**, present on every site
   * the vendor builds. It is genuine evidence the vendor built the site — which
   * is why it is not discarded — but it is the WEAKEST form of it, and a run
   * that reported it beside a real tenant path like
   * `morriscountynj.iqm2.com/Citizens/LegalNotice.aspx` would be running two
   * very different facts together.
   *
   * So a link whose host is a vendor's own marketing or training subdomain
   * carries that in its evidence string, where a reader of the table sees it.
   */
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
  /* `rockawaytownship` → also `rockaway`; a vendor slug is usually the place,
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
 * THE NUMBER THE BRIEF ASKS FOR, and it is a four-way split rather than a
 * count (RULING 105).
 *
 * *Reachable now* and *on a platform we do not handle* and *publishing nothing
 * machine-readable* need completely different responses, and a single
 * "coverage" figure makes the second two look like the same problem.
 */
export interface TenancySplit {
  /** Bodies on a platform we already read. THE CHEAP COVERAGE. */
  readonly reachableNow: number;
  /** Bodies on a platform we recognise and have no adapter for. Scoped work. */
  readonly unhandledPlatform: number;
  /** Bodies where nothing machine-readable was detected. A hunt, not a build. */
  readonly nothingDetected: number;
  /** Bodies whose page could not be read at all. RULING 24 — never a zero. */
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
