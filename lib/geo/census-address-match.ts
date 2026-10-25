import { addressWords as usps } from "./address-words.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { censusAddressQuery } from "./address-query.ts";

const hasWords = (whole: string, part: string): boolean =>
  ` ${whole} `.includes(` ${part} `);
interface CensusMatch {
  readonly matchedAddress?: string;
  readonly coordinates?: { readonly x?: number; readonly y?: number };
  readonly addressComponents?: {
    readonly city?: string;
    readonly state?: string;
    readonly zip?: string;
    readonly streetName?: string;
    readonly preDirection?: string;
    readonly suffixType?: string;
  };
}

/**
 * A single Census match must repeat the house and street, with a matching city or ZIP.
 * Postal normalization requires the native query; a stated state must agree.
 */
export function verifiedCensusVenuePoint(
  published: string,
  response: unknown,
): { lat: number; lng: number; address: string } | null {
  const matches = (response as { result?: { addressMatches?: CensusMatch[] } })
    ?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return null;
  const match = matches[0];
  const components = match.addressComponents;
  const address = match.matchedAddress ?? "";
  const house = /^\s*(\d+[a-z]?(?:-\d+)?|[ns]\d+[ew]\d+|[ew]\d+[ns]\d+)\b/i.exec(address)?.[1];
  if (
    !house ||
    !components?.streetName ||
    !components.city ||
    !components.state
  )
    return null;
  const query = censusAddressQuery(published);
  const folded = usps(query);
  const street = usps(
    [
      house,
      components.preDirection,
      components.streetName,
      components.suffixType,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const sameCity=hasWords(folded,usps(components.city));
  const foldedQuery = usps(query);
  const postalStates=[...foldedQuery.matchAll(/\b([a-z]{2})(?=\s+\d{4,5}\b)/g)]
    .map(match=>match[1]).filter(code=>US_JURISDICTIONS.some(state=>state.slug===code));
  const stateTail = postalStates.at(-1)??/\b([a-z]{2})(?:\s+\d{4,5}(?:\s+\d{4})?)?$/.exec(
    foldedQuery,
  )?.[1];
  if (
    postalStates.some(code=>code!==components.state!.toLowerCase())||stateTail &&
    US_JURISDICTIONS.some((state) => state.slug === stateTail) &&
    stateTail !== components.state.toLowerCase()
  )
    return null;
  const zipPattern = new RegExp(
    `\\b${usps(components.state)}\\s+(\\d{5})\\b`,
    "g",
  );
  const publishedZip =
    [...foldedQuery.matchAll(zipPattern)].at(-1)?.[1] ??
    /\b(\d{5})(?:-\d{4})?\s*$/.exec(query)?.[1];
  const echoed=(response as {result?:{input?:{address?:{address?:string}}}})?.result?.input?.address?.address;
  const confirmed=typeof echoed==="string"&&usps(echoed)===foldedQuery;
  if(!sameCity&&!(confirmed&&publishedZip&&publishedZip===components.zip))return null;
  const exactStreet=hasWords(folded,street);
  // A unique native response may canonicalize a delivery ZIP while repeating the complete physical street and city.
  if(publishedZip&&components.zip!==publishedZip&&!(confirmed&&exactStreet))return null;
  const sourceDirection=new RegExp(`^${house} (n|s|e|w|ne|nw|se|sw) `).exec(folded)?.[1];
  const namedStreet=hasWords(folded,usps([house,components.streetName].join(" ")))
    ||hasWords(folded,usps([house,components.preDirection,components.streetName].filter(Boolean).join(" ")))
    ||Boolean(!components.preDirection&&sourceDirection&&hasWords(folded,usps([house,sourceDirection,components.streetName].join(" "))));
  const prefix=usps([house,components.preDirection].filter(Boolean).join(" "))+" ";
  const suffix=" "+usps(components.suffixType??"")+" ";
  const sourceName=folded.startsWith(prefix)&&folded.includes(suffix)
    ? folded.slice(prefix.length).split(suffix,1)[0].split(" ").filter(word=>!['jr','sr'].includes(word)):[];
  const canonicalName=usps(components.streetName).split(" ");
  const initialedStreet=sourceName.length>1&&sourceName.length===canonicalName.length&&
    sourceName.at(-1)===canonicalName.at(-1)&&sourceName.every((word,index)=>word===canonicalName[index]||
      canonicalName[index].length===1&&word.startsWith(canonicalName[index]));
  const omittedSuffix=stateTail===components.state.toLowerCase()&&hasWords(folded,
    usps([house,components.preDirection,components.streetName,components.city].filter(Boolean).join(" ")));
  // A stated road type can change only with a matching ZIP; an absent suffix keeps the published street, city and state.
  if(!exactStreet&&!(confirmed&&(publishedZip&&components.zip===publishedZip&&(namedStreet||initialedStreet)||omittedSuffix)))return null;
  const lat = match.coordinates?.y;
  const lng = match.coordinates?.x;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  )
    return null;
  return { lat, lng, address };
}
