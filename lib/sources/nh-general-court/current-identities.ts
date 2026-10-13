import { createHash } from "node:crypto";

import type { GencourtMember, MembersExtraction } from "../../../scripts/nh-gencourt-members.mts";
import { sourceAcquisitionFailure } from "../../civic-data/source-acquisition-error.ts";
import { officialStateOfficeholderId } from "../../state-rollcalls/authority.ts";
import { decodeEntities } from "../http.ts";
import type { NhCurrentMemberIdentityCrosswalk, NhCurrentMemberIdentityMatch, NhOfficialDocument } from "./official-data.ts";

export const NH_CURRENT_HOUSE_URL = "https://gc.nh.gov/house/members/";
export const NH_CURRENT_SENATE_URL = "https://gc.nh.gov/senate/members/senate_roster.aspx";

function fail(detail: string): never {
  throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `NH current official roster: ${detail}`);
}

function plain(value: string): string {
  return decodeEntities(value.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/&#(?:x([a-f\d]+)|(\d+));/gi, (_all, hex: string | undefined, decimal: string | undefined) => {
      const code = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : "\uFFFD";
    }).replace(/\s+/g, " ").trim();
}

function attributes(tag: string): Readonly<Record<string, string>> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
    .map(match => [match[1]!.toLowerCase(), plain(match[2] ?? match[3]!)]));
}

function select(html: string, id: string): ReadonlyMap<string, string> {
  const selections = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi)]
    .filter(match => attributes(match[1]!).id === id);
  if (selections.length !== 1) fail(`expected one ${id} member selector.`);
  const values = new Map<string, string>();
  for (const option of selections[0]![2]!.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)) {
    const personId = attributes(option[1]!).value;
    if (!personId) continue;
    if (!/^[1-9]\d*$/.test(personId)) fail(`${id} has a nonnumeric PersonID.`);
    if (values.has(personId)) fail(`${id} repeats PersonID ${personId}.`);
    const label = plain(option[2]!);
    if (!label) fail(`${id} PersonID ${personId} has no label.`);
    values.set(personId, label);
  }
  if (!values.size) fail(`${id} contains no current members.`);
  return values;
}

export interface NhCurrentHouseIdentity {
  readonly personId: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly seatNo: string;
}

/** The two official selectors explicitly share PersonID, never seat or name hashes. */
export function parseNhCurrentHouseRoster(html: string, report?: (detail: string) => void): readonly NhCurrentHouseIdentity[] {
  const names = select(html, "pageBody_ddlReps");
  const seats = select(html, "pageBody_ddlSeats");
  if ([...names.keys()].some(personId => !seats.has(personId))) {
    fail("the current House member and seat selectors disagree on their PersonIDs.");
  }
  for (const [personId, seatNo] of seats) {
    if (!names.has(personId)) report?.(`House seat selector PersonID ${personId} (seat ${seatNo}) is absent from the current member roster.`);
  }
  const seatNumbers = new Set<string>();
  return [...names].map(([personId, name]) => {
    const match = /^([^,]+),\s*([^,]+)$/.exec(name);
    const seatNo = seats.get(personId)!;
    if (!match || !/^\d+$/.test(seatNo)) fail(`House PersonID ${personId} lacks an exact name or seat.`);
    if (seatNumbers.has(seatNo)) fail(`House current roster repeats seat ${seatNo}.`);
    seatNumbers.add(seatNo);
    return { personId, familyName: match[1]!.trim(), givenName: match[2]!.trim(), seatNo };
  });
}

export interface NhCurrentSenateIdentity {
  readonly personId: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly district: string;
  readonly email: string | null;
  readonly phone: string | null;
}

/** Each current district card carries its holder's exact sponsored-bills PersonID. */
export function parseNhCurrentSenateRoster(html: string): readonly NhCurrentSenateIdentity[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, "");
  const headings = [...body.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5\s*>/gi)]
    .filter(match => /^District \d+ - Senator /.test(plain(match[1]!)));
  if (!headings.length) fail("the Senate source contains no current district cards.");
  const persons = new Set<string>();
  const districts = new Set<string>();
  return headings.map((heading, index) => {
    const match = /^District (\d+) - Senator (.+)$/.exec(plain(heading[1]!))!;
    const district = String(Number(match[1]));
    const name = match[2]!;
    const card = body.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? body.length);
    const sponsored = [...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
      .filter(link => plain(link[2]!) === "Bills Sponsored This Session");
    if (sponsored.length !== 1) fail(`Senate district ${district} lacks its exact member sponsorship link.`);
    const href = attributes(sponsored[0]![1]!).href ?? "";
    const url = new URL(href, NH_CURRENT_SENATE_URL);
    const personId = url.searchParams.get("id");
    if (url.origin !== "https://gc.nh.gov" || !url.pathname.endsWith("/legislation.aspx") || !personId || !/^[1-9]\d*$/.test(personId)) {
      fail(`Senate district ${district} lacks an exact numeric official PersonID.`);
    }
    const portrait = [...card.matchAll(/<img\b([^>]*)>/gi)]
      .map(image => attributes(image[1]!).alt ?? "").find(label => label.startsWith("Senator "));
    const familyName = portrait?.slice("Senator ".length).trim();
    if (!familyName || !name.endsWith(` ${familyName}`)) fail(`Senate district ${district} lacks an exact surname label.`);
    if (persons.has(personId) || districts.has(district)) fail(`the Senate roster repeats PersonID ${personId} or district ${district}.`);
    persons.add(personId); districts.add(district);
    const emails = [...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
      .map(link => attributes(link[1]!).href ?? "").filter(link => link.startsWith("mailto:"));
    return { personId, familyName, givenName: name.slice(0, -(familyName.length + 1)), district,
      email: emails.at(-1)?.slice("mailto:".length) ?? null,
      phone: /\b603[.-]\d{3}[.-]\d{4}\b/.exec(plain(card))?.[0] ?? null };
  });
}

/** A new House member's own PersonID page supplies its current district and seat. */
export function parseNhCurrentHouseProfile(html: string, identity: NhCurrentHouseIdentity): GencourtMember {
  const headers = [...html.matchAll(/<h([13])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map(match => plain(match[2]!));
  const name = headers.find(label => label.startsWith("Representative "));
  const expected = `${identity.givenName} ${identity.familyName}`;
  const named = name && /^Representative (.+?)(?: \(([A-Z])\))?$/.exec(name);
  const division = headers.map(label => /^(.+?) - District (\d+)$/.exec(label)).find(Boolean);
  const seat = /Seat #:\s*(\d+)/.exec(plain(html));
  if (!named || named[1] !== expected || !division || seat?.[1] !== identity.seatNo) {
    fail(`House PersonID ${identity.personId} profile conflicts with its current name, seat, or district.`);
  }
  const text = plain(html);
  return { chamber: "H", familyName: identity.familyName, givenName: identity.givenName, middleName: null,
    seatNo: identity.seatNo, county: division[1]!, district: String(Number(division[2])), electedStatus: "INCUMBENT",
    party: named[2] ?? null, title: "Representative", phone: /\b603[.-]\d{3}[.-]\d{4}\b/.exec(text)?.[0] ?? null,
    email: /\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,}\b/i.exec(text)?.[0] ?? null, town: null, committees: [] };
}

export interface NhCurrentMemberAcquisition {
  /** A complete current name roster can retire absent prior members despite stale unused seat options. */
  readonly currentRosterComplete: boolean;
  readonly extraction: MembersExtraction;
  readonly crosswalk: NhCurrentMemberIdentityCrosswalk;
  readonly documents: readonly NhOfficialDocument[];
  readonly rawIdentityText: string;
  readonly identityFinalUrl: string;
  readonly identityHttpStatus: number;
  readonly memberSourceUrls: Readonly<Record<string, readonly string[]>>;
}

export async function readNhCurrentMemberIdentities(input: {
  readonly extraction: MembersExtraction;
  readonly read: (url: string) => Promise<NhOfficialDocument>;
  readonly signal?: AbortSignal;
}): Promise<NhCurrentMemberAcquisition> {
  const documents: NhOfficialDocument[] = [];
  const matches: NhCurrentMemberIdentityMatch[] = [];
  const unresolved: string[] = [];
  const memberSourceUrls: Record<string, readonly string[]> = {};
  let logicalInput = 0;
  const add = (personId: string, member: GencourtMember, urls: readonly string[]) => {
    const officeholderId = officialStateOfficeholderId("nh-general-court", personId);
    if (matches.some(match => match.officialPersonId === personId)) fail(`current chambers repeat PersonID ${personId}.`);
    matches.push({ member, officialPersonId: personId, officeholderId, matchBasis: "EXACT_OFFICIAL_ROSTER_ID" });
    memberSourceUrls[officeholderId] = urls;
  };
  const current = await Promise.allSettled([NH_CURRENT_HOUSE_URL, NH_CURRENT_SENATE_URL].map(async url => {
    input.signal?.throwIfAborted();
    const document = await input.read(url);
    if (document.httpStatus !== 200) fail(`${url} did not return a successful source document.`);
    return document;
  }));
  input.signal?.throwIfAborted();
  for (const [index, result] of current.entries()) {
    const rosterUrl = index === 0 ? NH_CURRENT_HOUSE_URL : NH_CURRENT_SENATE_URL;
    if (result.status === "rejected") {
      unresolved.push(`${rosterUrl}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      continue;
    }
    const document = result.value;
    documents.push(document);
    if (index === 0) {
      const identities = parseNhCurrentHouseRoster(document.body, detail => unresolved.push(detail));
      logicalInput += identities.length;
      for (const identity of identities) {
        input.signal?.throwIfAborted();
        const rows = input.extraction.members.filter(member => member.chamber === "H" && member.seatNo === identity.seatNo &&
          member.familyName === identity.familyName && member.givenName === identity.givenName && member.county && /^\d+$/.test(member.district));
        if (rows.length === 1) {
          // Bulk data enriches an identity already stated explicitly by the current roster.
          add(identity.personId, { ...rows[0]!, electedStatus: "INCUMBENT" }, [document.finalUrl, "https://gc.nh.gov/downloads/Members.txt"]);
          continue;
        }
        const profileUrl = `https://gc.nh.gov/house/members/member.aspx?pid=${identity.personId}`;
        try {
          const profile = await input.read(profileUrl);
          if (profile.httpStatus !== 200) fail(`House PersonID ${identity.personId} profile was not successfully retrieved.`);
          const member = parseNhCurrentHouseProfile(profile.body, identity);
          documents.push(profile);
          add(identity.personId, member, [document.finalUrl, profile.finalUrl]);
        } catch (error) {
          input.signal?.throwIfAborted();
          unresolved.push(`${identity.givenName} ${identity.familyName} (PersonID ${identity.personId}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      const identities = parseNhCurrentSenateRoster(document.body);
      logicalInput += identities.length;
      for (const identity of identities) {
        const rows = input.extraction.members.filter(member => member.chamber === "S" && member.district === identity.district &&
          member.familyName === identity.familyName && member.givenName === identity.givenName);
        const prior = rows.length === 1 ? rows[0]! : null;
        add(identity.personId, { chamber: "S", familyName: identity.familyName, givenName: identity.givenName,
          middleName: prior?.middleName ?? null, seatNo: prior?.seatNo ?? "0", county: "", district: identity.district,
          electedStatus: "INCUMBENT", party: prior?.party ?? null, title: "Senator", phone: identity.phone,
          email: identity.email, town: prior?.town ?? null, committees: prior?.committees ?? [] },
        [document.finalUrl, ...(prior ? ["https://gc.nh.gov/downloads/Members.txt"] : [])]);
      }
    }
  }
  if (!matches.length) fail(`no current official members were verified; ${unresolved.join("; ")}`);
  const rawIdentityText = JSON.stringify(documents.map(document => ({ url: document.finalUrl, body: document.body })));
  const sourceVersion = createHash("sha256").update(rawIdentityText).digest("hex");
  const members = matches.map(match => match.member);
  const byChamber: Record<string, number> = {};
  for (const member of members) byChamber[member.chamber] = (byChamber[member.chamber] ?? 0) + 1;
  return { currentRosterComplete: current.every(result => result.status === "fulfilled") && members.length === logicalInput,
  extraction: { members, counts: { logicalInput, produced: members.length, dropped: logicalInput - members.length,
    statedTotal: null, verdict: "COULD_NOT_ASSERT" }, byStatus: { INCUMBENT: members.length, NEW: 0, FORMER: 0, UNSTATED: 0 }, byChamber },
  crosswalk: { matches, unresolved, sourceVersion, observedIdentityRows: logicalInput, ordinaryMatches: matches.length, reviewedExceptionMatches: 0 },
  documents, rawIdentityText, identityFinalUrl: documents[0]!.finalUrl, identityHttpStatus: 200, memberSourceUrls };
}
