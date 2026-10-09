import type { OfficeholderSet } from "../../officials/types.ts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { officialStateOfficeholderId } from "../../state-rollcalls/authority.ts";
import { ordinalDay as ordinal } from "../../text/format-date.ts";

export const AZ_LEGISLATURE_ROSTER_URL = "https://www.azleg.gov/MemberRoster/";

/** `www.azleg.gov/robots.txt` publishes `Crawl-delay: 120`. */
export const AZ_LEGISLATURE_CRAWL_DELAY_MS = 120_000;

export const AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT = {
  requestedUrl: AZ_LEGISLATURE_ROSTER_URL,
  requestsPerAcquisition: 1,
  minIntervalBetweenRequestsMs: AZ_LEGISLATURE_CRAWL_DELAY_MS,
} as const;

export interface ExcludedAzRosterRow {
  readonly officialPersonId: string;
  readonly chamber: "lower" | "upper";
  readonly name: string;
  readonly district: number;
  readonly disposition: string;
  readonly sourceUrl: string;
}

export interface ParsedAzLegislatureRoster {
  readonly term: string;
  readonly legislature: number;
  readonly session: number;
  readonly observedRecords: number;
  readonly excludedRecords: readonly ExcludedAzRosterRow[];
  readonly roster: OfficeholderSet;
}

function invalid(detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Arizona MemberRoster: ${detail}`);
}

export function validateAzLegislatureRosterFinalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(`the final source URL is invalid: ${value}`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.azleg.gov" ||
    url.pathname.toLowerCase() !== "/memberroster/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    invalid(`the final source URL is not the canonical official roster: ${url.href}`);
  }
  return url.href;
}

function decoded(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMonday(year: number): Date {
  const first = new Date(Date.UTC(year, 0, 1));
  const delta = (8 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(year, 0, 1 + delta));
}

function currentAzLegislativeTerm(at: string): {
  readonly startYear: number;
  readonly legislature: number;
  readonly term: string;
} {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) invalid(`retrieval instant is invalid: ${at}`);
  const year = instant.getUTCFullYear();
  let startYear = year % 2 === 1 ? year : year - 1;
  if (year % 2 === 1 && instant < firstMonday(year)) startYear -= 2;
  const legislature = 57 + ((startYear - 2025) / 2);
  if (!Number.isInteger(legislature) || legislature <= 0) invalid(`cannot derive the current legislature for ${at}`);
  return {
    startYear,
    legislature,
    term: `${ordinal(legislature)} Legislature (${startYear}-${startYear + 1})`,
  };
}

function table(html: string, id: "HouseRoster" | "SenateRoster"): string {
  const match = new RegExp(`<table\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/table>`, "i").exec(html);
  if (!match) invalid(`the ${id} table is absent`);
  return match[1]!;
}

function rows(tableHtml: string): readonly { attributes: string; body: string }[] {
  return [...tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)]
    .map((match) => ({ attributes: match[1] ?? "", body: match[2] ?? "" }))
    .filter(({ body }) => /<td\b/i.test(body));
}

function cells(rowHtml: string): readonly string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((match) => match[1] ?? "");
}

function memberLink(cell: string): { href: string; name: string; legislature: number; session: number; personId: string } {
  const match = /<a\b[^>]*href=["']([^"']+\/((?:House|Senate))\/(?:House|Senate)-member\/\?[^"']*)["'][^>]*>([\s\S]*?)<strong\b/i.exec(cell);
  if (!match) invalid("a roster row lacks its official member link/name boundary");
  let url: URL;
  try {
    url = new URL(match[1]!);
  } catch {
    invalid(`a member URL is invalid: ${match[1]}`);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "www.azleg.gov") {
    invalid(`a member link left the official HTTPS authority: ${url.href}`);
  }
  const legislature = Number(url.searchParams.get("legislature"));
  const session = Number(url.searchParams.get("session"));
  const personId = url.searchParams.get("legislator") ?? "";
  if (!Number.isInteger(legislature) || legislature <= 0 || !Number.isInteger(session) || session <= 0 || !/^\d+$/.test(personId)) {
    invalid(`a member link lacks exact legislature/session/legislator identifiers: ${url.href}`);
  }
  const name = decoded(match[3]!);
  if (!name) invalid(`member ${personId} has no published name`);
  return { href: url.href, name, legislature, session, personId };
}

/**
 * Pure parser for the publisher's two complete current-roster tables.
 * Every source row is either an active exact seat or an explicitly reported
 * resigned row; no other exclusion is allowed to disappear into a count.
 */
export function parseAzLegislatureRoster(
  html: string,
  retrievedAt: string,
): ParsedAzLegislatureRoster {
  if (html.trim() === "") invalid("the document is empty");
  const expected = currentAzLegislativeTerm(retrievedAt);
  const officeholders: OfficeholderSet["officeholders"] = [];
  const divisions: OfficeholderSet["divisions"] = [];
  const excludedRecords: ExcludedAzRosterRow[] = [];
  const sessions = new Set<number>();
  const seen = new Set<string>();

  for (const [tableId, chamber] of [["HouseRoster", "lower"], ["SenateRoster", "upper"]] as const) {
    for (const row of rows(table(html, tableId))) {
      const values = cells(row.body);
      if (values.length !== 6) invalid(`${tableId} row has ${values.length} cells instead of 6`);
      const member = memberLink(values[0]!);
      if (member.legislature !== expected.legislature) {
        invalid(`member ${member.personId} belongs to legislature ${member.legislature}, expected ${expected.legislature}`);
      }
      sessions.add(member.session);
      if (seen.has(member.personId)) invalid(`legislator id ${member.personId} is duplicated`);
      seen.add(member.personId);
      const districtText = decoded(values[1]!);
      const district = Number(districtText);
      if (!Number.isInteger(district) || district < 1 || district > 30 || districtText !== String(district)) {
        invalid(`member ${member.personId} has invalid district ${JSON.stringify(districtText)}`);
      }
      const partyCode = decoded(values[2]!);
      const partyTitle = /<span\b[^>]*title=["']([^"']+)["']/i.exec(values[2]!)?.[1]?.trim() ?? "";
      const partyLabel = partyTitle && !((partyCode === "D" && partyTitle !== "Democratic") ||
        (partyCode === "R" && partyTitle !== "Republican")) ? partyTitle : null;
      const inactive = /\bclass\s*=\s*["'][^"']*\binactive\b/i.test(row.attributes);
      const disposition = decoded(values[3]!);
      if (inactive) {
        if (!/^Resigned\b/i.test(disposition)) {
          invalid(`inactive member ${member.personId} lacks an explicit resigned disposition`);
        }
        excludedRecords.push({
          officialPersonId: member.personId,
          chamber,
          name: member.name,
          district,
          disposition,
          sourceUrl: member.href,
        });
        continue;
      }
      if (/\bResigned\b/i.test(disposition)) {
        invalid(`active member ${member.personId} carries a resigned disposition`);
      }
      const emailMatch = /href=["']https:\/\/www\.azleg\.gov\/emailazleg\/\?legislatorId=(\d+)["'][^>]*>\s*Email:\s*([^<\s]+)\s*<\/a>/i.exec(values[3]!);
      const publicEmail = emailMatch?.[1] === member.personId ? `${emailMatch[2]!.trim()}@azleg.gov` : null;
      const sourcePhone = decoded(values[5]!);
      const phone = /^\(602\)\s+926-\d{4}$/.test(sourcePhone) ? sourcePhone : null;
      const id = officialStateOfficeholderId("az-legislature", member.personId);
      officeholders.push({
        id,
        personId:id,
        nativeIds:{"az-legislature":[member.personId]},
        memberships:[{id:`${id}:${member.legislature}`,personId:id,officeId:`US-AZ:${chamber}:${district}`,jurisdiction:"US-AZ",chamber,district:String(district),sourceUrl:member.href}],
        name: member.name,
        officeTitle: chamber === "lower" ? "State Representative" : "State Senator",
        level: "STATE",
        termStart: "",
        termEnd: "",
        birthDate: null,
        partyLabel,
        websiteUrl: member.href,
        contactFormUrl: `https://www.azleg.gov/emailazleg/?legislatorId=${member.personId}`,
        phone,
        email: publicEmail,
        campaignUrl: null,
        photo: null,
        state: "AZ",
        chamber,
        provenance: {
          sourceUrl: member.href,
          sourceOrg: "Arizona State Legislature",
          collectedAt: retrievedAt,
          verifiedAt: retrievedAt,
        },
      });
      divisions.push({
        officeholderId: id,
        ocdId: `ocd-division/country:us/state:az/sld${chamber === "lower" ? "l" : "u"}:${district}`,
        bodyId: null,
      });
    }
  }

  if (sessions.size !== 1) invalid(`the roster spans ${sessions.size} source sessions instead of one`);

  const session = [...sessions][0];
  if (session === undefined) invalid("the roster contains no source session identifier");
  return {
    term: expected.term,
    legislature: expected.legislature,
    session,
    observedRecords: officeholders.length + excludedRecords.length,
    excludedRecords,
    roster: {
      scope: "04",
      generatedAt: retrievedAt,
      officeholders,
      divisions,
      unmatched: [],
    },
  };
}
