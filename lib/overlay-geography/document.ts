import type { OverlaySource } from "./reference.ts";

export interface DistrictTownAssignment { readonly code: string; readonly towns: readonly string[]; readonly overlay?: true }

export function normalizeTown(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+(town|city|township)$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Extract text by actual PDF row coordinates, preserving multi-line town lists. */
export async function districtDocumentLines(bytes: Uint8Array, layout?: OverlaySource["documentLayout"]): Promise<string[]> {
  if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") throw new Error("District town source is not a PDF");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false });
  const document = await task.promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      const columns = layout?.columns ?? [0];
      const rows = columns.map(() => new Map<number, { x: number; text: string }[]>());
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (layout && y > layout.contentTop) continue;
        const x = item.transform[4];
        const column = columns.findLastIndex((start) => x >= start);
        if (column < 0) continue;
        const row = rows[column].get(y) ?? [];
        row.push({ x: item.transform[4], text: item.str });
        rows[column].set(y, row);
      }
      // Newspaper-style lists continue down a column and then into the next;
      // joining equal-y items across columns assigns towns to another district.
      for (const column of rows) for (const [, items] of [...column].sort(([a], [b]) => b - a)) lines.push(items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim());
    }
  } finally { await task.destroy(); }
  if (!lines.length) throw new Error("District town PDF has no text layer; extraction needs OCR");
  return lines;
}

/** County/district grammar is source reference data, including the overlay marker. */
export function parseDistrictTownAssignments(source: OverlaySource, lines: readonly string[], knownTownNames: readonly string[] = [], overlayCodes: readonly string[] = []): DistrictTownAssignment[] {
  const countyPattern = new RegExp(source.countyHeadingPattern, "i");
  const rowPattern = new RegExp(source.districtRowPattern, "i");
  const assignments = new Map<string, { towns: string[]; overlay?: true }>();
  let prefix: string | null = null;
  let activeCode: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const heading = /^COUNTY\b/i.test(lines[index + 1]?.trim() ?? "") ? `${line} ${lines[index + 1].trim()}` : line;
    const county = countyPattern.exec(heading)?.groups?.county;
    if (county) {
      prefix = Object.entries(source.codePrefixes).find(([, value]) => normalizeTown(value.name) === normalizeTown(county))?.[0] ?? null;
      activeCode = null;
      continue;
    }
    const parsed = rowPattern.exec(line)?.groups;
    if (parsed?.district) {
      const code = prefix ? `${prefix}${Number(parsed.district)}` : null;
      // The boundary source identifies overlays. A missing printed marker must
      // not hide an independently matching official town list.
      activeCode = code && (parsed.marker || overlayCodes.includes(code)) ? code : null;
      if (activeCode) {
        if (assignments.has(activeCode)) throw new Error(`District town PDF repeats ${activeCode}`);
        assignments.set(activeCode, { towns: splitTowns(parsed.towns ?? "", knownTownNames), ...(parsed.marker ? { overlay: true as const } : {}) });
      }
      continue;
    }
    // Single-town continuation rows are common. Match them to source identities,
    // so a heading or footnote cannot quietly become an assigned town.
    if (activeCode && (/[,;]/.test(line) || knownTownNames.some((town) => normalizeTown(town) === normalizeTown(line)))) assignments.get(activeCode)!.towns.push(...splitTowns(line, knownTownNames));
  }
  if (!assignments.size) throw new Error("District town PDF produced no overlay assignments; source layout needs review");
  return [...assignments].map(([code, { towns, overlay }]) => ({ code, towns: [...new Set(towns.map(normalizeTown).filter(Boolean))].sort(), ...(overlay ? { overlay } : {}) }));
}

function splitTowns(value: string, knownTownNames: readonly string[]): string[] {
  const names = value.replace(/\([^)]*\)/g, "");
  const expanded = names.replace(/([A-Za-z][A-Za-z .'-]+?)\s+Wards?\s+([0-9]+(?:\s*[-,–]\s*[0-9]+)*)/gi, (_match, city: string, specification: string) => {
    const numbers = specification.split(",").flatMap((part) => {
      const [first, last] = part.split(/[-–]/).map(Number);
      if (!last) return [first];
      if (last < first || last - first > 100) throw new Error("District town PDF has invalid ward range");
      return Array.from({ length: last - first + 1 }, (_, index) => first + index);
    });
    return numbers.map((ward) => `${city.trim()} Ward ${ward}`).join(",");
  });
  const parts = expanded.split(/[,;]/).map((town) => town.trim()).filter(Boolean);
  return parts.flatMap((part) => {
    const matching = knownTownNames.filter((town) => normalizeTown(town) === normalizeTown(part));
    if (matching.length) return matching;
    // A whole-city assignment includes every ward, preserving the source's actual ward identities.
    const wards = knownTownNames.filter((town) => normalizeTown(town).startsWith(normalizeTown(part) + " ward "));
    return wards.length ? wards : [part];
  });
}
