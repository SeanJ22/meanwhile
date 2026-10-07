import { sharedNameForm } from "../identity/name-forms.ts";
import { registrableDomain } from "./campaign-site-verifier.ts";
import type { CandidateUniverse } from "../hunt/candidate-universe.ts";
import type { CampaignSiteSubject } from "../control-plane/promotion/campaign-site-chain.ts";

/** Public mail services: a filed address there says nothing about a site. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "aol.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "mac.com",
  "msn.com", "live.com", "comcast.net", "verizon.net", "optonline.net", "optimum.net", "att.net", "protonmail.com",
  "proton.me", "ymail.com", "earthlink.net", "fastmail.com", "email.com", "mail.com", "gmx.com", "zoho.com", "cox.net",
  "charter.net", "sbcglobal.net", "bellsouth.net", "frontier.com", "windstream.net", "centurylink.net", "q.com",
]);

export interface LineupContest {
  readonly contestId: string;
  readonly nominees: readonly { readonly name: string }[];
}

export interface FilingChannels {
  readonly candidacyId: string;
  readonly websiteUrl?: string | null;
  readonly email?: string | null;
}

function contestOf(candidacyId: string): string {
  const cut = candidacyId.lastIndexOf(":");
  return cut > 0 ? candidacyId.slice(0, cut) : candidacyId;
}

export function filingDomains(row: FilingChannels): string[] {
  const out = new Set<string>();
  if (typeof row.websiteUrl === "string") {
    try {
      out.add(registrableDomain(new URL(row.websiteUrl).hostname));
    } catch {
      /* a malformed stated website names no domain */
    }
  }
  const at = typeof row.email === "string" ? row.email.lastIndexOf("@") : -1;
  if (at > 0) {
    const domain = registrableDomain(row.email!.slice(at + 1).trim());
    if (domain.includes(".") && !PUBLIC_MAIL_DOMAINS.has(domain)) out.add(domain);
  }
  return [...out].sort();
}

export function campaignSiteSubjects(input: {
  readonly universes: readonly CandidateUniverse[];
  readonly lineups?: readonly LineupContest[];
  readonly filings?: readonly FilingChannels[];
}): Map<string, CampaignSiteSubject> {
  const filingsById = new Map<string, FilingChannels[]>();
  for (const row of input.filings ?? []) filingsById.set(row.candidacyId, [...(filingsById.get(row.candidacyId) ?? []), row]);
  const subjects = new Map<string, CampaignSiteSubject>();
  for (const universe of input.universes) {
    for (const c of universe.candidacies) {
      const keys = new Set<string>(c.pilotIds);
      const contests = new Set(c.pilotIds.map(contestOf));
      for (const lineup of input.lineups ?? []) {
        if (!contests.has(lineup.contestId)) continue;
        for (const nominee of lineup.nominees) {
          if (sharedNameForm(nominee.name, `${c.givenName} ${c.familyName}`) !== null) keys.add(`${lineup.contestId}|${nominee.name}`);
        }
      }
      const domains = new Set<string>();
      for (const pilot of c.pilotIds) for (const row of filingsById.get(pilot) ?? []) for (const d of filingDomains(row)) domains.add(d);
      subjects.set(c.id, {
        candidacyId: c.id,
        givenName: c.givenName,
        familyName: c.familyName,
        officeTitle: c.officeTitle,
        ocdId: c.ocdId,
        stateCode: c.stateCode,
        cycle: c.cycle,
        readerKeys: [...keys].sort(),
        filingDomains: [...domains].sort(),
      });
    }
  }
  return subjects;
}
