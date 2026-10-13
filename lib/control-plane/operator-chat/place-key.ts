import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";

export function askedPlace(asked: string, from: string): string | null {
  const key = /\b(?:geo:[a-z]{2}\.[a-z_]+\.[0-9]+|st:[a-z]{2})\b/i.exec(asked)?.[0]?.toLowerCase();
  if (key && parseV6PlaceKey(key)) return key;
  const district = /\b([a-z]{2})\s*[-–]\s*(\d{1,2}|at.large)\b/i.exec(asked);
  const state = district ? US_STATES.find(s => s.code === district[1].toLowerCase()) : US_STATES.find(s => new RegExp(`\\b${s.name}\\b`, "i").test(asked));
  const number = district?.[2] ?? /\b(?:district|congressional district)\s*(\d{1,2}|at.large)\b/i.exec(asked)?.[1];
  if (state) {
    if (!number) return `st:${state.code}`;
    const fips = Object.entries(FIPS_TO_STATE).find(([,s]) => s.postal.toLowerCase() === state.code)?.[0];
    if (fips) return `geo:${state.code}.congressional_district.${fips}${/^\d+$/.test(number) ? number.padStart(2, "0") : "00"}`;
  }
  // A named unknown place must never silently become the selected place.
  if (!/\b(?:this|selected|my)\s+(?:place|district|state|county)\b/i.test(asked)) return null;
  try { const selected = new URL(from, "https://admin.invalid").searchParams.get("scope"); return selected && parseV6PlaceKey(selected) ? selected : null; } catch { return null; }
}
