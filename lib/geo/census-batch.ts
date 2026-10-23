import { plausibleUsPoint } from "./census-geocoder.ts";
import { OUTBOUND_USER_AGENT } from "./outbound-agent.ts";

/** The Census Bureau's batch address endpoint: free, no key, one request for any number of addresses. */
export const CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";

export interface BatchAddress { street: string; city: string; state: string; zip: string }

const csvCell = (value: string) => `"${value.replace(/"/g, '""').replace(/[\r\n]+/g, " ")}"`;

function csvRow(line: string): string[] {
  const cells: string[] = [];
  for (let i = 0, cell = "", quoted = false; i <= line.length; i++) {
    const ch = line[i];
    if (i === line.length || (!quoted && ch === ",")) { cells.push(cell); cell = ""; }
    else if (ch === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else cell += ch;
  }
  return cells;
}

/**
 * Places published voting-site addresses with one Census request. Only matched rows come back, keyed by input
 * index; an unmatched or implausible row is simply absent. Never sends or keeps a reader's address.
 */
export async function censusBatchPoints(addresses: readonly BatchAddress[], options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<Map<number, { lat: number; lng: number }>> {
  const points = new Map<number, { lat: number; lng: number }>();
  if (!addresses.length) return points;
  const form = new FormData();
  form.set("benchmark", "Public_AR_Current");
  form.set("addressFile", new Blob([addresses.map((a, i) => [String(i), a.street, a.city, a.state, a.zip].map(csvCell).join(",")).join("\n")], { type: "text/csv" }), "addresses.csv");
  const response = await (options.fetchImpl ?? fetch)(CENSUS_BATCH_URL, { method: "POST", body: form, cache: "no-store", signal: options.signal,
    headers: { "user-agent": OUTBOUND_USER_AGENT } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Census batch geocoder returned HTTP ${response.status}`); }
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line) continue;
    const [id, , status, , , coordinates] = csvRow(line);
    const index = Number(id);
    if (status !== "Match" || !Number.isInteger(index) || index < 0 || index >= addresses.length || !coordinates) continue;
    const [lng, lat] = coordinates.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng) && plausibleUsPoint(lat, lng)) points.set(index, { lat, lng });
  }
  return points;
}
