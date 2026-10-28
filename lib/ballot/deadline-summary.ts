import type { PublishedElectionField } from "../civic-data/election-fields.ts";
import type { DatedStep } from "./election-dates.ts";

type Field = PublishedElectionField["value"];

/** Audience is part of a rule's identity; a special rule never replaces a general one. */
export function deadlineAudience(value: Pick<Field, "text" | "quote" | "url">): DatedStep["audience"] {
  // A surrounding quotation may describe several audiences. Classify this
  // instruction, and do not turn an explicit civilian exception into a special rule.
  const words = value.text.replace(/\bnon[-\s]UOCAVA\b/gi, "civilian")
    .replace(/\b(?:other than|except(?: for)?|excluding)\s+(?:military(?: and overseas)?|overseas)\s+(?:electors?|voters?)\b/gi, "");
  return /(?:^|\.)fvap\.gov\//i.test(value.url.replace(/^https?:\/\//, "")) ||
    /\b(?:military (?:electors?|voters?|and overseas)|overseas (?:electors?|voters?)|uniformed.services|UOCAVA|federal postcard|FPCA)\b/i.test(words)
    ? "MILITARY_OVERSEAS" : "GENERAL";
}

/** Render the supported instruction; keep the legal quotation in its linked source. */
export function deadlineSummary(value: Pick<Field, "fieldKind" | "text" | "quote">): string {
  let text = value.text.replace(/\s+/g, " ").trim();
  if (value.fieldKind === "early_voting" && /financial disclosure report due/i.test(text))
    text = text.split(/(?=\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})/i)
      .filter(instruction => /\bearly voting\b/i.test(instruction)).join(" ");
  if (/in a timely manner.*receive, complete, and mail the absent voter's ballot before the day of the election/i.test(text))
    return "Apply early enough to receive, complete and mail your absentee ballot before Election Day.";
  if (/shall be entitled to vote by requesting to be registered to vote at the polling place on election day/i.test(text))
    return "You can register at your polling place on Election Day.";
  if (/The clerk shall mail absentee ballots.*12:00 p\.m\..*provide an absentee ballot.*5:00 p\.m\./i.test(text))
    return "Your clerk must receive your request by noon the day before the election to mail your ballot. You can request a ballot at the clerk’s office until 5 p.m. that day.";
  if (/On the day of an election:.*application for addition to the checklist.*polling place/i.test(text))
    return "You can register at your town’s polling place during voting hours on Election Day.";
  if (/Registrations made by mail.*Electronic registration.*polling place on election day/i.test(text))
    return "Register by mail by the postmark deadline, or online by 11:59 p.m. that day. You can also register at your polling place on Election Day.";
  if (/Any qualified elector.*5 p\.m\. or the close of business, whichever is later.*Friday before an election/i.test(text))
    return "You can register at your municipal clerk’s office until 5 p.m. or closing time, whichever is later, on the Friday before the election.";
  if (/military elector.*5 p\.m\. on election day.*sequestered juror/i.test(text))
    return "Military voters and sequestered jurors: your clerk must receive your written ballot request by 5 p.m. on Election Day.";
  if (/application is made by mail by a military elector.*5 p\.m\..*Friday/i.test(text))
    return "Military voters: your clerk must receive your mailed ballot request by 5 p.m. on the Friday before Election Day.";
  if (/By computer using.*is the day of.*general election/i.test(text))
    return "You can register online on Election Day.";
  if (/By appearing in person.*is the fourth Tuesday preceding/i.test(text))
    return "Register at your county clerk’s office or a designated county facility by the fourth Tuesday before Election Day.";
  if (/county clerk shall prepare and distribute to each active registered voter.*14 days before the election/i.test(text))
    return "Your county clerk mails ballots to active registered voters, including people who register or update their registration at least 14 days before Election Day.";
  if (/minimum number of required Voter Service and Polling Centers/i.test(text) && /except Sundays and the first Saturday/i.test(value.quote))
    return "The required voter service and polling centers open during this period, except Sundays and the first Saturday.";
  text = text
    .replace(/\bnon[-\s]UOCAVA voters\b/gi, "voters who are not military or overseas voters")
    .replace(/shall be considered on time if/gi, "is on time if")
    .replace(/\s*\((?:SDCL|W\.S\.|NRS|Sec\.)\s*[^)]*\)/gi, "")
    .replace(/\s*(?:W\.S\.\s*\d+(?:-\d+)+(?:,\s*)?|§\s*\d+\.?)/gi, "")
    .replace(/\b(?:as defined (?:in|under)|under) s\.\s*\d+(?:\.\d+)?(?:\s*\([^)]*\))*/gi, "")
    .replace(/\bExcept as provided in par\.\s*\([^)]*\)\s*,?\s*/gi, "")
    .replace(/\b(?:the )?elector\b/gi, "voter")
    .replace(/\belectors\b/gi, "voters")
    .replace(/\bshall be received(?: by the municipal clerk)? no later than\b/gi, "must reach your clerk by")
    .replace(/\bIf (?:an? )?application is made by mail,? (?:the application )?/gi, "Your mailed ballot request ")
    .replace(/\bIf application is made in person, the application shall be made\b/gi, "Apply in person")
    .replace(/\bimmediately preceding\b/gi, "before")
    .replace(/\bpreceding the election\b/gi, "before Election Day")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/[;:]\s*$/, ".");
  // The source's concise field sometimes omits an operative time or condition.
  // Use its quotation in that case rather than losing that information.
  if (!/\b(?:shall|electors?|Title [IVXLCDM]+|par\.)\b/.test(value.quote) &&
      /\b(?:p\.m\.|a\.m\.|postmarked|received|in person|in-person|except|unless|only)\b/i.test(value.quote) &&
      !/\b(?:p\.m\.|a\.m\.|postmarked|received|in person|in-person|except|unless|only)\b/i.test(value.text))
    return value.quote.replace(/\s+/g, " ").trim();
  return text;
}

export function orderedDeadlines(steps: readonly DatedStep[]): DatedStep[] {
  const unique = new Map<string, DatedStep>();
  for (const step of steps) {
    const key = JSON.stringify([step.audience ?? "GENERAL", step.label, step.date,
      step.detail?.toLowerCase().replace(/\s+/g, " ").trim()]);
    const held = unique.get(key);
    if (!held || Date.parse(step.verifiedAt) > Date.parse(held.verifiedAt)) unique.set(key, step);
  }
  const priority = (step: DatedStep) => (step.audience === "MILITARY_OVERSEAS" ? 10 : 0)
    + (/registration/i.test(step.label) ? 0 : /mail|absentee/i.test(step.label) ? 1 : 2);
  return [...unique.values()].sort((a, b) => priority(a) - priority(b));
}
