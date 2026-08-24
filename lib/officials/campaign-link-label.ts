/**
 * **RULING 122 — A PARTY-HOSTED CANDIDATE PAGE IS THE CANDIDATE'S PAGE, WITH
 * THE HOST LABELLED.** (Sean's decision of 2026-08-24, closing `NH11`.)
 *
 * ## The case it was decided on
 *
 * Shaun Fife is running for Governor of New Hampshire. He has no campaign
 * website and no campaign Facebook page. What he has is a candidate page on a
 * political party's own site carrying his name, the office, a sentence in his
 * own words and a contact address — read 2026-08-21 at rung 2, HTTP 200.
 *
 * Recording that as *no campaign site found* hides a real, findable thing from
 * a reader. **And it does it to the candidate with the fewest resources**,
 * which is precisely the information asymmetry the equal-effort rule exists to
 * catch. It is the same shape as the campaign that lives on Facebook, and that
 * rule already says such a presence renders — labelled honestly, never dressed
 * as a website.
 *
 * ## Why the label is the whole of the safety
 *
 * This product NEVER characterises an organization's politics. Rendering a
 * party's website under a bare "Campaign site" label would present a party's
 * site as the candidate's own, which is both untrue and close to the line the
 * organizations-render-as-filed rule draws.
 *
 * Saying *the page his party publishes about him* names the source plainly and
 * leaves the reader to judge it, which is what this product does with every
 * other source. It says nothing about what the party believes.
 *
 * ## THE HOST LIST IS A RECORD, NOT A PATTERN
 *
 * There is no way to look at a URL and know it is a political party's own site.
 * A guess would eventually mislabel somebody's personal domain as a party's, or
 * a party's as a personal domain, and both are false claims about a real
 * person.
 *
 * So a host appears here only when a session has READ it and recorded what it
 * is, with the date. That is the same standard every other claim in this
 * product meets, and it is why this is a list of confirmed hosts rather than a
 * regular expression over the word "party".
 */

/** What kind of thing the candidate's link actually is. */
export type CampaignLinkKind = "SITE" | "FACEBOOK" | "PARTY_HOSTED";

export interface PartyHostedHost {
  /** The host, lowercased, no scheme. */
  host: string;
  /** Whose site it is, as filed or as the site states of itself. */
  organization: string;
  /** The date a session read it and confirmed what it is. */
  confirmedOn: string;
  /** What was read, so the record can be checked rather than trusted. */
  evidence: string;
}

/**
 * Hosts confirmed to be a political party's own site. Grows only by a session
 * reading one; never by inference.
 */
export const PARTY_HOSTED_HOSTS: readonly PartyHostedHost[] = [
  {
    host: "majiparty.org",
    organization: "MAJI Party",
    confirmedOn: "2026-08-21",
    evidence:
      "Read at rung 2, HTTP 200. The page title is 'NH Governor- Shaun Fife'; it carries his " +
      "own words and the contact address action4nh@gmail.com. The site's own og:description " +
      "describes the party rather than the candidate, which is what says the HOST is the party.",
  },
];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};

/** Is this link a page on a party's own site that we have confirmed? */
export function partyHostFor(url: string): PartyHostedHost | null {
  const host = hostOf(url);
  if (!host) return null;
  return (
    PARTY_HOSTED_HOSTS.find((p) => host === p.host || host.endsWith(`.${p.host}`)) ?? null
  );
}

export function campaignLinkKind(url: string): CampaignLinkKind {
  if (/(^|\.)facebook\.com$/i.test(hostOf(url))) return "FACEBOOK";
  if (partyHostFor(url)) return "PARTY_HOSTED";
  return "SITE";
}

/**
 * The reader-facing label for a candidate's link.
 *
 * Plain language, level register — this is a CLAIM surface, so it states what
 * the thing is and does not editorialise about it.
 */
export function campaignLinkLabel(url: string): string {
  const kind = campaignLinkKind(url);
  if (kind === "FACEBOOK") return "The campaign's Facebook page";
  if (kind === "PARTY_HOSTED") {
    const party = partyHostFor(url);
    /*
     * The party is NAMED. "A party's page about them" would be vaguer than the
     * truth and would read as though we were avoiding saying which — and the
     * name is a filed fact, not a characterisation.
     */
    return `The page ${party?.organization ?? "their party"} publishes about them`;
  }
  return "Campaign site";
}
