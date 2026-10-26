import { addressWords, HOUSE_NUMBER_WORDS } from "./address-words.ts";
import { stateName } from "../facts/entity-read.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";

const STREET_ADDRESS = new RegExp(String.raw`\b(?:\d+[a-z]?(?:-\d+)?|${Object.keys(HOUSE_NUMBER_WORDS).join("|")})\s+(?:[a-z0-9][\w.'’-]*\s+){0,8}?(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|square|sq|way|expressway|expy|plaza|center|ctr|broadway)\b\.?`, "i");

/** Extract the published street address from a venue heading and attendance instructions. */
export function censusAddressQuery(published: string): string {
  const text = published
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/Hawai[‘’']i/gi, "Hawaii")
    .replace(/\b(?:room|rm\.?|suite|ste\.?)\s*#?\s*[\w-]+(?![\w-])(?=\s*[,\r\n]?\s*\d+[a-z]?(?:-\d+)?\s+[a-z])/gi," ");
  const street = STREET_ADDRESS.exec(text);
  const bare = /(?:^|[\r\n,;:]|\bat\s+)\s*(\d+\s+[a-z][\s\S]*)/i.exec(
    text,
  )?.[1];
  let address = street ? text.slice(street.index) : (bare ?? text);
  // Extract the street first: in "Meeting Room 27 Northport Dr", 27 belongs to the street.
  const withoutUnits=(value:string)=>value.replace(/,?\s*\b(?:(?:conference\s+)?(?:room|rm\.?|suite|ste\.?)\s*#?\s*[\w-]+|(?:first|second|third|fourth|\d+(?:st|nd|rd|th))\s+(?:floor|flr\.?))\b/gi," ");
  if (street) {
    const end = street[0].length;
    const tail = withoutUnits(address.slice(end))
      .replace(/\b(?:p[\s.]*o[\s.]*box|post\s+office\s+box)\s*#?\s*[\w-]+\b[\s,]*/gi," ")
      .replace(/^[\s,]*(?:[^,\r\n]*\b(?:conference room|council chambers?|meeting room|board room)\b)[^,\r\n]*(?:,|\r?\n)/i, ", ");
    address = address.slice(0,end) + tail;
  }else address=withoutUnits(address);
  address = address.replace(/^[a-z]+\b/i, word => HOUSE_NUMBER_WORDS[word.toLowerCase()] ?? word);
  address = address.split(
    /https?:\/\/|\b(?:join\s+(?:zoom|the)|meeting\s+id|pass\s*code|virtual\s*\(?online|or\s+(?:by\s+zoom|virtually)|this\s+meeting\s+is)/i,
    1,
  )[0];
  address = address
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/(?:\s*,)+\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/[\s,;.]+$/, "");
  address = address.replace(/,?\s*\b(?:USA|United States(?: of America)?)\s*$/i, "");
  for (const state of US_JURISDICTIONS) {
    const name = stateName(state.usps);
    if (name) address = address.replace(new RegExp(`(?:,\\s*|\\s+)${name.replaceAll(".","\\.")}(?=\\s+\\d{5}(?:-\\d{4})?\\b|$)`,"i"), `, ${state.usps}`);
  }
  return address.trim();
}

/** A repeated address or the same named room in an already published sitting retains its verified point. */
export function repeatsPublishedVenue(
  published: string,
  name: string,
  address: string | null,
): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const text = words(published);
  const suffix =
    /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|square|sq)\b/g;
  const priorName = words(name);
  const currentAddress = addressWords(censusAddressQuery(published));
  const priorAddress = addressWords(censusAddressQuery(address ?? name));
  const withoutZip = (value: string) => value.replace(/\s+\d{5}(?:\s+\d{4})?$/, "");
  const sameStreetAddress = /^\d+[a-z]?(?:-\d+)?\s/.test(currentAddress) &&
    (currentAddress === priorAddress ||
      (withoutZip(currentAddress) === currentAddress || withoutZip(priorAddress) === priorAddress) &&
        withoutZip(currentAddress) === withoutZip(priorAddress));
  const currentStreet = addressWords(STREET_ADDRESS.exec(censusAddressQuery(published))?.[0] ?? "");
  const priorStreet = addressWords(STREET_ADDRESS.exec(censusAddressQuery(address ?? name))?.[0] ?? "");
  const streetSuffix = /\s+(?:st|ave|rd|dr|ln|blvd|ct|cir|pl|pkwy|hwy|ter|trl|sq|way|expy|plz|ctr)$/;
  const repeatedShortStreet = Boolean(currentStreet) && currentAddress === currentStreet &&
    (currentStreet === priorStreet || !streetSuffix.test(currentStreet) &&
      currentStreet === priorStreet.replace(streetSuffix,""));
  const sameStreetWithoutSuffix =
    !suffix.test(text) &&
    text === priorName.replace(suffix, "").replace(/\s+/g, " ").trim();
  return (
    Boolean(text) &&
    (sameStreetAddress || repeatedShortStreet || text === words(address ?? "") ||
      text === priorName ||
      sameStreetWithoutSuffix ||
      (text.length >= 12 && priorName.endsWith(` ${text}`)))
  );
}
