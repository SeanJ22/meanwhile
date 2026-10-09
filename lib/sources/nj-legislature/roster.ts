import type { OfficeholderSet } from "../../officials/types.ts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { officialStateOfficeholderId } from "../../state-rollcalls/authority.ts";
import { ordinalDay as ordinal } from "../../text/format-date.ts";

export const NJ_LEGISLATURE_ROSTER_URL = "https://www.njleg.state.nj.us/legislative-roster";

export interface ParsedNjLegislatureRoster {
  readonly term: string;
  readonly legislature: number;
  readonly observedRecords: number;
  readonly roster: OfficeholderSet;
}

function invalid(detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `New Jersey legislative roster: ${detail}`);
}

export function validateNjLegislatureRosterFinalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(`the final source URL is invalid: ${value}`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.njleg.state.nj.us" ||
    url.pathname !== "/legislative-roster" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    invalid(`the final source URL is not the canonical official roster: ${url.href}`);
  }
  return url.href;
}

/** Shared statutory session boundary for the NJ roster and voting-record authorities. */
export function njSecondTuesday(year: number): Date {
  const first = new Date(Date.UTC(year, 0, 1));
  const firstTuesday = 1 + ((9 - first.getUTCDay()) % 7);
  return new Date(Date.UTC(year, 0, firstTuesday + 7));
}

function currentNjLegislature(at: string): {
  readonly startYear: number;
  readonly legislature: number;
  readonly term: string;
} {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) invalid(`retrieval instant is invalid: ${at}`);
  const year = instant.getUTCFullYear();
  let startYear = year % 2 === 0 ? year : year - 1;
  if (year % 2 === 0 && instant < njSecondTuesday(year)) startYear -= 2;
  const legislature = 222 + ((startYear - 2026) / 2);
  if (!Number.isInteger(legislature) || legislature <= 0) invalid(`cannot derive the current legislature for ${at}`);
  return {
    startYear,
    legislature,
    term: `${ordinal(legislature)} New Jersey Legislature (${startYear}-${startYear + 1})`,
  };
}


function record(value: unknown, index: number): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`roster row ${index} is not an object`);
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string, index: number, nullable = false): string | null {
  const value = row[key];
  if (nullable && (typeof value !== "string" || !value.trim())) return null;
  if (typeof value !== "string" || value.trim() === "") invalid(`roster row ${index} has invalid ${key}`);
  return value.trim();
}

/** Pure parser for the exact current roster embedded in the official page. */
export function parseNjLegislatureRoster(
  html: string,
  retrievedAt: string,
): ParsedNjLegislatureRoster {
  if (html.trim() === "") invalid("the document is empty");
  const expected = currentNjLegislature(retrievedAt);
  const copyright = /©(?:\s|<!--.*?-->)*(\d{4})(?:\s|<!--.*?-->)*New Jersey Office of Legislative Services/i.exec(html);
  if (!copyright || Number(copyright[1]) !== new Date(retrievedAt).getUTCFullYear()) {
    invalid("the current official OLS copyright year is absent or does not match the retrieval year");
  }
  const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!script) invalid("the __NEXT_DATA__ application/json payload is absent");
  let payload: unknown;
  try {
    payload = JSON.parse(script[1]!);
  } catch {
    invalid("the __NEXT_DATA__ payload is not valid JSON");
  }
  const root = payload as { page?: unknown; query?: unknown; isFallback?: unknown; props?: { pageProps?: { legrosterData?: unknown } } };
  if (root.page !== "/legislative-roster" || root.isFallback !== false || !root.query || typeof root.query !== "object" || Object.keys(root.query as object).length !== 0) {
    invalid("the embedded payload does not identify the canonical current legislative-roster page");
  }
  const data = root.props?.pageProps?.legrosterData;
  if (!Array.isArray(data) || data.length !== 3 || !Array.isArray(data[0])) {
    invalid("props.pageProps.legrosterData[0] is not the complete roster array");
  }

  const officeholders: OfficeholderSet["officeholders"] = [];
  const divisions: OfficeholderSet["divisions"] = [];
  const ids = new Set<string>();
  for (const [index, value] of data[0].entries()) {
    const row = record(value, index);
    const houseCode = text(row, "RosterHouseCode", index);
    const rosterHouse = text(row, "Roster_House", index);
    const chamber = houseCode === "S" && rosterHouse === "Senate"
      ? "upper"
      : houseCode === "A" && rosterHouse === "Assembly"
        ? "lower"
        : invalid(`roster row ${index} has inconsistent chamber fields`);
    const district = row.Roster_District;
    if (!Number.isInteger(district) || Number(district) < 1 || Number(district) > 40) invalid(`roster row ${index} has invalid district`);
    if (row.VacantSort !== 0) continue; // A publisher-listed vacancy is not a missing person.
    const bioLink = text(row, "BioLink", index)!;
    const bioMatch = /^\/legislative-roster\/(\d+)\/(senator|assemblyman|assemblywoman)-[a-z0-9.'-]+$/i.exec(bioLink);
    if (!bioMatch) invalid(`roster row ${index} has invalid BioLink ${bioLink}`);
    const officialPersonId = bioMatch[1]!;
    if (ids.has(officialPersonId)) invalid(`BioLink id ${officialPersonId} is duplicated`);
    ids.add(officialPersonId);
    const officialTitle = text(row, "LegTitle", index)!;
    if ((chamber === "upper" && officialTitle !== "Senator") || (chamber === "lower" && !/^Assembly(?:man|woman)$/.test(officialTitle))) {
      invalid(`roster row ${index} has title ${officialTitle} inconsistent with its chamber`);
    }
    const firstName = text(row, "First_Name", index)!;
    const middleName = text(row, "Middle_Name", index, true);
    const lastName = text(row, "Last_Name", index)!;
    const suffix = text(row, "Suffix", index, true);
    const partyCode = text(row, "Party", index, true);
    const partyDescription = text(row, "PartyDescription", index, true);
    const partyLabel = !((partyCode === "D" && partyDescription !== "Democrat") ||
      (partyCode === "R" && partyDescription !== "Republican")) ? partyDescription : null;
    let contact = text(row, "ContactLink", index, true);
    if (contact !== null) {
      try {
        const contactUrl = new URL(contact);
        if (contactUrl.protocol !== "https:" || contactUrl.username || contactUrl.password) contact = null;
      } catch {
        contact = null;
      }
    }
    const id = officialStateOfficeholderId("nj-legislature", officialPersonId);
    const websiteUrl = new URL(bioLink, NJ_LEGISLATURE_ROSTER_URL).href;
    officeholders.push({
      id,
      personId:id,
      nativeIds:{"nj-legislature":[officialPersonId]},
      memberships:[{id:`${id}:${expected.legislature}`,personId:id,officeId:`US-NJ:${chamber}:${district}`,jurisdiction:"US-NJ",chamber,district:String(district),sourceUrl:websiteUrl}],
      name: [firstName, middleName, lastName, suffix].filter((part): part is string => Boolean(part)).join(" "),
      officeTitle: officialTitle,
      level: "STATE",
      termStart: "",
      termEnd: "",
      birthDate: null,
      partyLabel,
      websiteUrl,
      contactFormUrl: contact,
      phone: null,
      email: null,
      campaignUrl: null,
      photo: null,
      state: "NJ",
      chamber,
      provenance: {
        sourceUrl: websiteUrl,
        sourceOrg: "New Jersey Legislature / Office of Legislative Services",
        collectedAt: retrievedAt,
        verifiedAt: retrievedAt,
      },
    });
    divisions.push({
      officeholderId: id,
      ocdId: `ocd-division/country:us/state:nj/sld${chamber === "lower" ? "l" : "u"}:${district}`,
      bodyId: null,
    });
  }

  return {
    term: expected.term,
    legislature: expected.legislature,
    observedRecords: officeholders.length,
    roster: {
      scope: "34",
      generatedAt: retrievedAt,
      officeholders,
      divisions,
      unmatched: [],
    },
  };
}
