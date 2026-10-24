import referenceFile from "../../../data/reference/statewide-executive-sources.json" with { type: "json" };
import labelsFile from "../../../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { FIPS_TO_STATE } from "../../ocd/fips.ts";

export const STATEWIDE_SOURCE_ID = "statewide-executive-sources";
export const STATEWIDE_PARSER_VERSION = "statewide-executives/2";
export interface StatewideReferenceSource {
  readonly id: string;
  readonly publisher: string;
  readonly url: string;
  readonly officeTitles: readonly string[];
  readonly format: "html" | "wikidata";
}
// Static JSON imports, so the bundler carries the datasets and no file URL is read at run time.
const reference = referenceFile as {sources:StatewideReferenceSource[]};
export const STATEWIDE_REFERENCE_SOURCES: readonly StatewideReferenceSource[] = reference.sources;
const labels = labelsFile as {jurisdictions:{postal:string;name:string;fips:string}[]};
/** Labels are held national reference data; office selection rules never name states. */
export const STATEWIDE_JURISDICTIONS = labels.jurisdictions.flatMap(row => {
  const entry = FIPS_TO_STATE[row.fips];
  return entry?.postal === row.postal ? [{...row,root:`ocd-division/country:us/${entry.prefix}:${entry.postal.toLowerCase()}`}]:[];
});
export function statewideJurisdiction(state:string) {
  const found = STATEWIDE_JURISDICTIONS.find(row=>row.postal.toLowerCase()===state.toLowerCase());
  if (!found) throw new Error(`STATEWIDE_JURISDICTION_UNSUPPORTED:${state}`);
  return found;
}
