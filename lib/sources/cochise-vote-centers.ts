/** The county's 2026 vote-center PDF is a positioned three-column list. */
import { createHash } from "node:crypto";
import type { VotingJurisdiction } from "../ballot/voting-sites.ts";
export const COCHISE_VOTE_CENTERS_URL =
  "https://cochise.az.gov/DocumentCenter/View/4575/Vote-Center-Locations-PDF";
export const COCHISE_ELECTIONS_URL = "https://www.cochise.az.gov/292/Elections";
export const COCHISE_VOTER_URL = "https://www.cochise.az.gov/509/Voter-Information";

export interface CochiseVoteCenter {
  readonly id: string;
  readonly area: string;
  readonly name: string;
  readonly address: string;
}

export interface PositionedText { readonly text: string; readonly x: number; readonly y: number }

function requireSource(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`COCHISE_VOTE_CENTERS_${code}`);
}

/**
 * Refuse any shortened or malformed list. The printed VC numbers need not be
 * consecutive: this authority publishes 18 locations numbered VC1–15, 17–19.
 * Column position, not a guessed place name, binds each address to its center.
 */
export async function parseCochiseVoteCenters(bytes: Uint8Array): Promise<readonly CochiseVoteCenter[]> {
  requireSource(new TextDecoder("latin1").decode(bytes.slice(0, 5)) === "%PDF-", "NOT_PDF");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false }).promise;
  try {
    requireSource(pdf.numPages === 1, "PAGE_COUNT_CHANGED");
    const content = await (await pdf.getPage(1)).getTextContent();
    const items: PositionedText[] = content.items.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return [];
      const part = item as { str: string; transform: number[] };
      const text = String(part.str).replace(/\s+/g, " ").trim();
      return text ? [{ text, x: Number(part.transform[4]), y: Number(part.transform[5]) }] : [];
    });
    return parseCochiseVoteCenterItems(items);
  } finally {
    await pdf.cleanup();
  }
}

export function parseCochiseVoteCenterItems(items: readonly PositionedText[]): readonly CochiseVoteCenter[] {
    const prose = items.map(item => item.text).join(" ");
    requireSource(/COCHISE COUNTY ELECTIONS\s*[–-]\s*2026/i.test(prose), "YEAR_OR_AUTHORITY_CHANGED");
    requireSource(/18 VOTE CENTER LOCATIONS COUNTYWIDE/i.test(prose), "DECLARED_COUNT_CHANGED");
    requireSource(/Voters may vote at any of the Vote Centers listed below/i.test(prose), "COUNTYWIDE_ELIGIBILITY_UNPROVEN");
    requireSource(/All Vote Centers are open from 6:00 a\.m\. to 7:00 p\.m\. on Election Day/i.test(prose), "HOURS_UNPROVEN");
    const anchors = items.filter(item => item.x < 150 && /^VC\s*\d{1,2}$/i.test(item.text))
      .sort((left, right) => right.y - left.y);
    requireSource(anchors.length === 18, "ROW_COUNT_MISMATCH");
    const ids = anchors.map(anchor => Number(/^VC\s*(\d+)$/i.exec(anchor.text)![1]));
    requireSource(new Set(ids).size === 18 && ids.every(id => id > 0 && id < 100), "DUPLICATE_OR_BAD_ID");
    const rows = anchors.map((anchor, index) => {
      const upper = index === 0 ? anchor.y + 15 : (anchors[index - 1]!.y + anchor.y) / 2;
      const lower = index === anchors.length - 1 ? anchor.y - 15 : (anchor.y + anchors[index + 1]!.y) / 2;
      const parts = items.filter(item => item.y < upper && item.y > lower);
      const area = parts.filter(item => item.x >= 150 && item.x < 320).map(item => item.text);
      const location = parts.filter(item => item.x >= 320).sort((left, right) => right.y - left.y);
      const address = location.filter(item => /^\d+\s+\S/.test(item.text));
      const name = location.filter(item => !/^\d+\s+\S/.test(item.text));
      requireSource(area.length === 1 && name.length === 1 && address.length === 1,
        `ROW_SHAPE_${ids[index]}`);
      return { id: `az-cochise-vc-${ids[index]}`, area: area[0]!, name: name[0]!.text, address: address[0]!.text };
    });
    requireSource(rows.length === 18 && new Set(rows.map(row => row.address)).size === 18,
      "ADDRESS_COUNT_MISMATCH");
    return rows;
}

/** Exact official page corroboration of the 2026 November date and PDF link. */
export function cochiseGeneralElectionLinkIssue(electionsHtml: string, voterHtml: string): string | null {
  if (!/General Election[\s\S]{0,1000}November 3, 2026/i.test(electionsHtml)) return "GENERAL_ELECTION_DATE_UNVERIFIED";
  if (!/Vote-Center-Locations-PDF/i.test(electionsHtml) || !/General Election[\s\S]{0,5000}Election Day Polling Locations/i.test(voterHtml) ||
      !/Vote-Center-Locations-PDF/i.test(voterHtml)) return "GENERAL_ELECTION_LINK_UNVERIFIED";
  return null;
}

export async function cochiseVotingJurisdiction(input: {
  readonly pdfBytes: Uint8Array;
  readonly electionsHtml: string;
  readonly voterHtml: string;
  readonly collectedAt: string;
}): Promise<VotingJurisdiction> {
  const issue = cochiseGeneralElectionLinkIssue(input.electionsHtml, input.voterHtml);
  if (issue) throw new Error(`COCHISE_VOTE_CENTERS_${issue}`);
  const centers = await parseCochiseVoteCenters(input.pdfBytes);
  return {
    ocdId: "ocd-division/country:us/state:az/county:cochise",
    name: "Cochise County",
    state: "AZ",
    model: "VOTE_CENTER",
    election: "2026 General Election",
    sites: centers.map(center => ({
      id: center.id,
      name: `${center.area} — ${center.name}`,
      address: center.address,
      room: null,
      lat: null,
      lng: null,
      kind: "ELECTION_DAY" as const,
      election: "2026 General Election",
      serves: null,
    })),
    sourceOrg: "Cochise County Elections Department",
    sourceUrl: COCHISE_VOTE_CENTERS_URL,
    sourceRawSha256: createHash("sha256").update(input.pdfBytes).digest("hex"),
    collectedAt: input.collectedAt,
    refusal: null,
  };
}
