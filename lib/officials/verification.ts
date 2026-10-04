import { activeWiring } from "../registry/source-wiring.ts";

/**
 * What we may honestly say about a source's verification — g3 item 5
 * (2026-08-16).
 *
 * ## The defect
 *
 * Katie Hobbs' Sources tab read:
 *
 *     Read from    azgovernor.gov
 *     Collected    2026-08-14
 *     Verified     not yet
 *
 * Three rows, and the third one contradicted the first two. The fact came off
 * the Governor of Arizona's own office's website, on a stated date, with the
 * link right there — and the card told the reader we had not checked it. That
 * is not a cautious understatement; it is the product slandering its own best
 * evidence, on the one surface whose entire job is to say where a claim came
 * from. A reader who believes that row believes we are guessing about a
 * sitting governor.
 *
 * ## The ruling
 *
 * **A fact read from the subject's own official source IS verified — the read
 * is the verification**, by that source, on the read date. "Not yet" is
 * RESERVED for genuinely unverified provenance: an aggregator, a third-party
 * page, a social feed — somewhere a second rung is still owed.
 *
 * Nothing about the underlying provenance model changes. `verifiedAt` still
 * means what it meant (a human went and looked), the source URL and collected
 * date are untouched, and no record gains a field. This is vocabulary and
 * rendering.
 *
 * ## How "official" is decided, and why not by hand
 *
 * A hand-kept allow-list would rot and would encode somebody's opinion. These
 * three rules are each checkable against something outside us:
 *
 * 1. **`.gov` and `.mil`.** The `.gov` TLD is restricted by CISA to United
 *    States government organizations; you cannot buy one. `CLAUDE.md`'s photo
 *    door 4 already rests on exactly this ("anything on a `.gov` site is
 *    official, by the author's ruling").
 * 2. **The `.us` locality space** — `warner.nh.us`, `ci.tucson.az.us`,
 *    `k12` district domains. RFC 1480 delegates those branches to the
 *    governments they name.
 * 3. **A body's own page as the source wiring already records it.** Some
 *    public bodies — most school districts — publish on a `.org`. The
 *    `SCHEDULEPAGE` adapter is defined as "the body publishes its own
 *    sittings on its own site, with no portal in the path", so the hosts of
 *    those rows are, by the registry's own typing, bodies' own sites.
 *    Deriving the list from the wiring means it grows when coverage grows and
 *    never disagrees with it.
 *
 * A VENDOR portal is deliberately NOT on this list. Granicus hosting Tucson's
 * agendas is Tucson's publication channel and the records are Tucson's, but
 * the ruling says "the subject's own official source", and a vendor is a
 * third party under any plain reading of that sentence. Those rows keep
 * saying "not yet" until a human checks one, which is the conservative
 * direction and the one that keeps this row meaning something.
 */

export type Verification =
  | {
      /** A human went and looked. The strongest claim, and it keeps its date. */
      kind: "confirmed";
      date: string;
    }
  | {
      /** Read from the subject's own official publisher — the read IS the check. */
      kind: "official";
      date: string;
      by: string;
    }
  | {
      /** A second rung is still owed: an aggregator, a third party, a feed. */
      kind: "unverified";
    };

export interface VerifiableProvenance {
  sourceUrl: string | null;
  collectedAt: string | null;
  verifiedAt: string | null;
}

/**
 * The host of a URL, lowercased and `www.`-stripped, or null.
 *
 * Exported 2026-08-23 (item 3) because `components/ballot/candidate-card.tsx`
 * needs the same answer to NAME a bio's source from the URL already on the
 * row. A second copy of this is the duplicate-implementation class RULING 103
 * governs — three copies of an initials function is how `Thomas J. Haynes III`
 * came out as `TI`.
 */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Hosts the source wiring itself types as a body's own page.
 *
 * Computed once. `SCHEDULEPAGE` is the only adapter whose contract is "no
 * portal in the path", so it is the only one whose hosts qualify.
 */
let ownPages: Set<string> | null = null;
function bodyOwnPageHosts(): Set<string> {
  if (ownPages) return ownPages;
  ownPages = new Set<string>();
  for (const row of activeWiring()) {
    if (row.agendaSourceType !== "SCHEDULEPAGE") continue;
    for (const url of [
      row.config.schedulePage,
      row.config.documentsPage,
      row.noticeUrl,
    ]) {
      const host = hostOf(url ?? null);
      if (host) ownPages.add(host);
    }
  }
  return ownPages;
}

/** A two-letter state label immediately under `.us` — RFC 1480's locality space. */
const US_LOCALITY = /\.[a-z]{2}\.us$/;

export function isOfficialHost(host: string | null): boolean {
  if (!host) return false;
  if (/\.(gov|mil)$/.test(host)) return true;
  if (US_LOCALITY.test(host)) return true;
  return bodyOwnPageHosts().has(host);
}

export function verificationOf(provenance: VerifiableProvenance): Verification {
  if (provenance.verifiedAt) {
    return { kind: "confirmed", date: provenance.verifiedAt.slice(0, 10) };
  }
  const host = hostOf(provenance.sourceUrl);
  // A read with no date behind it cannot be dated as a verification, however
  // official the host. That is the render-default rule: a missing date may not
  // be filled in with a plausible one.
  if (host && isOfficialHost(host) && provenance.collectedAt) {
    return {
      kind: "official",
      date: provenance.collectedAt.slice(0, 10),
      by: host,
    };
  }
  return { kind: "unverified" };
}
