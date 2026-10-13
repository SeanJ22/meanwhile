import { publicFetch } from "../hunt/public-transport.ts";
import { coherentMidpoint, sampleStreetPoints } from "@/lib/geo/census-geocoder";
import { resolveAddress } from "@/lib/geo/address-resolution";
import { addressDivisions, addressStateFips, lookupAddressGeographies } from "@/lib/geo/address-geographies";
import { ballotScopeAtAddress } from "@/lib/geo/address-ballot-scope";
import { publishedZipDistricts } from "@/lib/geo/zip-census-districts";
import { zipDivisionEntry } from "@/lib/geo/zip-division-index";
import { censusWorkDivision } from "@/lib/census-geography/division-id";
import { currentRepresentationSelection } from "@/lib/census-geography/selection";
import { postalArea, zipNeedsAddress } from "@/lib/geo/postal";
import { lookupZcta } from "@/lib/geo/zcta";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { ensureReaderAuthorityEdge, readReaderManifest, READER_BALLOT_AUTHORITY_FAMILIES } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import type { BallotSet } from "@/lib/ballot/types";

const NO_STORE = { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** Exact-address coordinates never leave this server. Street samples orient the map and settle no districts. */
export async function resolveAddressRequest(request: Request, fetchImpl: typeof fetch = publicFetch) {
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return answer({ ok: false }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["zip", "street", "houseNumber", "postalEntry"].includes(key))) return answer({ ok: false }, 400);
  const zip = typeof input.zip === "string" ? input.zip.trim() : "";
  const typedStreet = typeof input.street === "string" ? input.street.trim() : "";
  const house = typeof input.houseNumber === "string" ? input.houseNumber.trim() : "";
  if (!/^\d{5}$/.test(zip) || typedStreet.length < 3) return answer({ ok: false }, 400);
  // Postal entry: a mail-only or unknown ZIP is not a residential boundary, so the street carries city and state instead.
  const omitZip = input.postalEntry === true && (zipNeedsAddress(zip) || !lookupZcta(zip));
  const area = postalArea(zip);
  const street = omitZip && !typedStreet.includes(",") && area?.place && area.state ? `${typedStreet}, ${area.place}, ${area.state}` : typedStreet;
  // A pasted house number is treated as an exact address too; it never becomes a returned sample point.
  const embeddedHouse = /^#?\d+[a-z]?(?:[-/]\d+[a-z]?)?\s+/i.exec(street);
  if (!house && !embeddedHouse) {
    const points = await sampleStreetPoints(street, zip, { fetchImpl, signal: request.signal, timeoutMs: 2500, omitZip });
    const midpoint = coherentMidpoint(points);
    const point = midpoint ? { lat: Math.round(midpoint.lat * 1000) / 1000, lng: Math.round(midpoint.lng * 1000) / 1000 } : null;
    return answer({ ok: true, basis: "STREET_SAMPLE", resolution: { status: "FAILED", reason: "NOT_FOUND" },
      contestIds: [], excludedContestIds: [], point });
  }
  if (house && !/^\d+[a-z]?(?:[-/]\d+[a-z]?)?$/i.test(house)) return answer({ ok: false }, 400);
  const address = house ? `${house} ${embeddedHouse ? street.slice(embeddedHouse[0].length) : street}` : street;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(2500)]);
  const geographiesRead = omitZip ? lookupAddressGeographies(address, zip, { fetchImpl, signal, anyZip: true })
    : lookupAddressGeographies(`${address}, ${zip}`, zip, { fetchImpl, signal }).then(async found => {
      if (found || signal.aborted) return found;
      const elsewhere = await lookupAddressGeographies(address, zip, { fetchImpl, signal });
      return elsewhere?.kind === "OTHER_ZIP" ? elsewhere : null;
    });
  const manifest = await readReaderManifest().catch(() => null);
  if (manifest) {
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, READER_BALLOT_AUTHORITY_FAMILIES).catch(() => null);
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const found = await geographiesRead;
  // Under postal entry the districts come from the ZIP the Census matched, not the typed mail-only ZIP.
  const districtZip = found?.kind === "MATCHED" && found.zip ? found.zip : zip;
  const [held, entry] = await Promise.all([publishedZipDistricts(districtZip), zipDivisionEntry(districtZip)]);
  if (!found || found.kind === "OTHER_ZIP" || !found.geographies) return answer({ ok: true, basis: "EXACT_ADDRESS",
    resolution: { status: "FAILED", reason: "NOT_FOUND", ...(found?.kind === "OTHER_ZIP" ? { resolvesInZip: found.zip } : {}) },
    contestIds: [], excludedContestIds: [] });
  const geographies = found.geographies;
  const stateFips = addressStateFips(geographies);
  const selection = { ...currentRepresentationSelection(), ...(stateFips ? { stateFips } : {}) };
  const resolution = resolveAddress([addressDivisions(geographies, held, selection)]);
  // The source lookup starts from every held plan touching the ZIP, not just today's representation map.
  const ids = new Set(entry?.ids ?? []);
  if (held.kind === "HELD") for (const row of held.value.containers) { const id = censusWorkDivision(row.ref); if (id) ids.add(id); }
  const ballots: BallotSet[] = [];
  try {
    for (const { source } of await readerBallotSourcesForDivisions([...ids])) {
      try { ballots.push(source.normalize(await source.fetch())); } catch { /* This source cannot exclude anything. */ }
    }
  } catch { /* Districts remain useful while election data is unavailable. */ }
  return answer({ ok: true, basis: "EXACT_ADDRESS", selection, resolution,
    ...ballotScopeAtAddress(geographies, held, ballots, selection.asOf) });
}
