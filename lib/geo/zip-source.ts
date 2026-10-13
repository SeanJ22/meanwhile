import { parseCsv } from "../reference/csv.ts";
import type { CentroidTable } from "./zcta-core.ts";
import type { ZipType } from "./postal-core.ts";

/** Census release 2021 is the complete 2020 ZCTA set; the release named 2020 predates that set. */
export function parseGazetteer(text: string): CentroidTable {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const header = headerLine.split("\t").map(value => value.trim().toUpperCase());
  const zipCol = header.indexOf("GEOID"), latCol = header.indexOf("INTPTLAT");
  const lngCol = header.findIndex(value => value === "INTPTLONG" || value === "INTPTLON");
  if ([zipCol, latCol, lngCol].includes(-1) || !lines.length) throw new Error("Gazetteer is missing its header or rows");
  const out: CentroidTable = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split("\t").map(value => value.trim());
    const zip = cells[zipCol], lat = Number(cells[latCol]), lng = Number(cells[lngCol]);
    if (!/^\d{5}$/.test(zip) || !cells[latCol] || !cells[lngCol] || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || out[zip]) {
      throw new Error(`Invalid or duplicate Gazetteer row: ${zip}`);
    }
    out[zip] = [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
  }
  return out;
}

export interface PostalSourceRow {
  zip: string; lat: number | null; lng: number | null; place: string;
  state: string; county: string; countyCode: string | null; type: ZipType;
}

/** Unplaced postal records remain listed; blank coordinates must never become (0, 0). */
function point(lat: string, lng: string): [number | null, number | null] {
  const y = Number(lat), x = Number(lng);
  return lat && lng && Number.isFinite(y) && Number.isFinite(x) && Math.abs(y) <= 90 && Math.abs(x) <= 180 && (y !== 0 || x !== 0)
    ? [y, x] : [null, null];
}

export function parseGeoNames(text: string): Record<string, PostalSourceRow> {
  const out: Record<string, PostalSourceRow> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (cells.length !== 12 || cells[0] !== "US" || !/^\d{5}$/.test(cells[1])) throw new Error("Invalid GeoNames US postal row");
    const [lat, lng] = point(cells[9], cells[10]);
    out[cells[1]] = { zip: cells[1], lat, lng, place: cells[2], state: cells[4], county: cells[5],
      countyCode: /^\d{3}$/.test(cells[6]) ? cells[6] : null, type: null };
  }
  return out;
}

export function parsePostalTypes(text: string): Record<string, PostalSourceRow> {
  const [header, ...rows] = parseCsv(text);
  const out: Record<string, PostalSourceRow> = {};
  const types: Record<string, ZipType> = { STANDARD: "standard", "PO BOX": "po-box", UNIQUE: "unique", MILITARY: "military" };
  const value = (row: string[], key: string) => row[header.indexOf(key)] ?? "";
  for (const row of rows) {
    if (row.length === 1 && !row[0]) continue;
    const zip = value(row, "zip");
    if (!/^\d{5}$/.test(zip) || !(value(row, "type") in types)) throw new Error("Invalid postal-type row");
    const [lat, lng] = point(value(row, "latitude"), value(row, "longitude"));
    out[zip] = { zip, lat, lng, place: value(row, "primary_city"), state: value(row, "state"),
      county: value(row, "county"), countyCode: null, type: types[value(row, "type")] };
  }
  return out;
}

export function assertGovernmentZipCoverage(centroids: CentroidTable, zips: readonly string[]): void {
  const missing = zips.filter(zip => !centroids[zip]);
  if (missing.length) throw new Error(`Gazetteer omits ${missing.length} government ZCTAs: ${missing.slice(0, 12).join(", ")}`);
}
