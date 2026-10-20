import { normalizeName } from "../routing/exact-name.ts";
import type { Division } from "../registry/types.ts";
import type { EvidenceRecord } from "./evidence.ts";

export function districtQuestion(question: string): "cd" | "sldl" | "sldu" | "school_district" | "ALL" | null {
  const words = normalizeName(question);
  const district = "(?:(?:congressional|congress|state senate|senate|state house|house|assembly|school) )?districts?";
  if (!new RegExp(`^(?:what|which)(?: s| is| are)? (?:my|our) ${district}$`).test(words) &&
      !new RegExp(`^(?:what|which) ${district} (?:am i in|are we in|do i live in|do we live in|is my zip in)$`).test(words)) return null;
  return /\b(?:congress|congressional)\b/.test(words) ? "cd"
    : /\b(?:state senate|senate)\b/.test(words) ? "sldu"
    : /\b(?:state house|house|assembly)\b/.test(words) ? "sldl"
    : /\bschool\b/.test(words) ? "school_district" : "ALL";
}

/** Use the same sourced divisions the place page reads, including split ZIPs. */
export function composeDistrictAnswer(kind: NonNullable<ReturnType<typeof districtQuestion>>, divisions: readonly Division[], zip: string | null) {
  const rows = divisions.flatMap(division => {
    const match = /\/(cd|sldl|sldu|school_district):([^/]+)$/.exec(division.ocdId);
    if (!match || kind !== "ALL" && kind !== match[1] || !division.provenance?.sourceUrl) return [];
    const name = match[1] === "cd" ? `Congressional District ${match[2]}`
      : match[1] === "sldl" ? `State House District ${match[2]}`
      : match[1] === "sldu" ? `State Senate District ${match[2]}` : division.label;
    const record: EvidenceRecord = { kind: "BODY", id: division.ocdId, text: name,
      sourceUrl: division.provenance.sourceUrl, sourceOrg: division.provenance.sourceOrg,
      retrievedAt: division.provenance.collectedAt };
    return [{ name, record }];
  });
  if (!rows.length) return null;
  const labels = [...new Set(rows.map(row => row.name))];
  const list = labels.length < 3 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return { answer: `${zip && /^\d{5}$/.test(zip) ? `ZIP ${zip}` : "This place"} ${labels.length === 1 ? "is in" : "includes"} ${list}.`,
    records: rows.map(row => row.record), citedUrls: [...new Set(rows.map(row => row.record.sourceUrl!))] };
}
