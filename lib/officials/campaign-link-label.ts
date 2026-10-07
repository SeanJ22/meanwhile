/** A candidate page on a party's own site is the candidate's page, labelled with its host. */

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

/** Hosts confirmed to be a political party's own site; grows only by reading one, never by inference. */
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

/** The reader-facing label for a candidate's link: states what it is, without editorialising. */
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
