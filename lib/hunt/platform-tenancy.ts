import { defaultPlatformFingerprints, platformFingerprints, type PlatformFingerprint } from "../control-plane/platform-fingerprints.ts";
import type { FieldManualEntry } from "../control-plane/field-manual.ts";

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
