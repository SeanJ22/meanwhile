import { stateCodeOf, stateName } from "../facts/entity-read.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { HOUSE_NUMBER_WORDS as NUMBER_WORDS } from "../geo/address-words.ts";

/** Only the agenda's header is read: the place a sitting is held is stated first. */
const HEADER_CHARS = 700;

const DIRECTIONALS: Readonly<Record<string, string>> = {
  north: "n", south: "s", east: "e", west: "w", n: "n", s: "s", e: "e", w: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", ne: "ne", nw: "nw", se: "se", sw: "sw",
};
const SUFFIXES: Readonly<Record<string, string>> = {
  street: "st", st: "st", avenue: "ave", ave: "ave", boulevard: "blvd", blvd: "blvd", road: "rd", rd: "rd",
  drive: "dr", dr: "dr", place: "pl", pl: "pl", way: "way", lane: "ln", ln: "ln", court: "ct", ct: "ct",
  parkway: "pkwy", pkwy: "pkwy", circle: "cir", cir: "cir", highway: "hwy", hwy: "hwy", plaza: "plz", plz: "plz", square: "sq", sq: "sq",
};

const NUMBER = `(\\d{1,6}|${Object.keys(NUMBER_WORDS).join("|")})`;
const DIRECTIONAL = `(?:(${Object.keys(DIRECTIONALS).join("|")})\\.?\\s+)?`;
const NAME = "((?:[\\p{L}0-9][\\p{L}0-9'’-]*\\s+){0,3}?[\\p{L}0-9][\\p{L}0-9'’-]*)";
const SUFFIX = `(${Object.keys(SUFFIXES).join("|")})\\b\\.?`;
/** A street address: a number, an optional directional, one to four name words, a suffix. */
const STREET = new RegExp(`\\b${NUMBER}[^\\S\\r\\n]+${DIRECTIONAL}${NAME}\\s+${SUFFIX}`, "iu");
/** "Broadway" and its kin are whole street names with no suffix. */
const SUFFIXLESS = new RegExp(`\\b${NUMBER}\\s+${DIRECTIONAL}(Broadway)\\b`, "i");
const STATE_WORDS = US_JURISDICTIONS.flatMap(state => [state.usps,stateName(state.usps)!]).sort((a,b)=>b.length-a.length);
const CITY_STATE_ZIP = new RegExp(`^[\\s,/–—-]*([\\p{L}][\\p{L} .’'-]{0,60}?)\\s*(?:,\\s*|\\s+)(${STATE_WORDS.map(name=>name.replaceAll(".","\\.")).join("|")})(?=\\s|,|$)(?:[\\s,]+(\\d{5}(?:-\\d{4})?))?\\b`,"iu");
/** PDF columns can place document titles between the street and its locality. */
const HEADER_NOISE = /\b(?:MEETING LOCATION|Meeting (?:Agenda|Minutes)\s*-\s*Final|(?:Agenda|Minutes)\s*-\s*Final|Meeting (?:Agenda|Minutes)|Minutes|Final|Revised|Amended)\b/gi;
const UNIT = /\b(?:(?:suite|ste|room|rm|building|bldg)\.?\s*#?\s*(?:\d[\w-]*|[a-z](?=[\s,)]))|(?:first|second|third|fourth|\d+(?:st|nd|rd|th))\s+(?:floor|flr\.?)|lower level)\b|\((?:board chamber|council chambers?|meeting room)\)/gi;
const COLUMN_ROLE = /\b(?:chief administrative o(?:ffi|ﬃ)cer|county administrator)\b/gi;
const mask = (text:string, pattern:RegExp) => text.replace(pattern,word=>" ".repeat(word.length));

/** Read a printed locality without crossing another street address or joining unrelated PDF columns. */
function followingLocality(tail:string):{city:string;state:string;zip:string|null;end:number}|null {
  const next=streetKeyOf(tail);
  if(next)tail=tail.slice(0,next.index);
  const cleaned=mask(mask(mask(tail,UNIT),HEADER_NOISE),COLUMN_ROLE);
  let offset=0;
  for(const line of cleaned.split(/\r?\n/)){
    const match=CITY_STATE_ZIP.exec(line);
    if(match){
      const printed=match[2]!,state=US_JURISDICTIONS.find(row=>row.usps.toLowerCase()===printed.toLowerCase())?.usps
        ?? stateCodeOf(STATE_WORDS.find(name=>name.toLowerCase()===printed.toLowerCase())??printed);
      if(state)return {city:match[1]!.trim(),state,zip:match[3]??null,end:offset+match[0].length};
    }
    offset+=line.length+(tail.slice(offset+line.length).startsWith("\r\n")?2:1);
  }
  return null;
}

export interface StatedAgendaAddress {
  /** The place words the agenda prints before the address ("City Hall"), or null. */
  readonly place: string | null;
  /** The street address exactly as printed ("20 East Main Street"). */
  readonly street: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly zip: string | null;
  /** The street reduced to what two spellings of one building agree on ("20 e main st"). */
  readonly key: string;
}

function normalizedStreet(number: string, directional: string | undefined, name: string, suffix: string | undefined): string {
  const digits = NUMBER_WORDS[number.toLowerCase()] ?? number;
  const direction = directional ? DIRECTIONALS[directional.toLowerCase()] ?? directional.toLowerCase() : "";
  const words = name.normalize("NFKC").toLowerCase().replace(/[.']/g, "").split(/\s+/).filter(Boolean)
    .map((word) => NUMBER_WORDS[word] ?? word);
  const ending = suffix ? SUFFIXES[suffix.toLowerCase().replace(/\.$/, "")] ?? suffix.toLowerCase() : "";
  // "Broadway" is printed with and without "Blvd"; both are one street.
  if (words.length === 1 && words[0] === "broadway") return [digits, direction, "broadway"].filter(Boolean).join(" ");
  return [digits, direction, ...words, ending].filter(Boolean).join(" ");
}

/** The first street address in `text`, reduced to its building-level key. */
export function streetKeyOf(text: string): { readonly key: string; readonly index: number; readonly length: number } | null {
  const full = STREET.exec(text);
  const bare = SUFFIXLESS.exec(text);
  const hit = full && (!bare || full.index <= bare.index) ? { match: full, suffix: full[4] } : bare ? { match: bare, suffix: undefined } : null;
  if (!hit) return null;
  const [, number, directional, name] = hit.match;
  // An interleaved supervisor column can put "District 5" immediately before "1600 Pacific Highway".
  if(/^\d+\s/.test(name??"")&&/\bdistrict\s*$/i.test(text.slice(0,hit.match.index))){
    const offset=hit.match.index+number!.length,next=streetKeyOf(text.slice(offset));
    return next?{...next,index:offset+next.index}:null;
  }
  return {
    key: normalizedStreet(number!, directional, name!, hit.suffix),
    index: hit.match.index,
    length: hit.match[0].length,
  };
}

/**
 * The place the agenda states in its header, or null when it states no street
 * address there.
 */
function addressParts(agendaText:string):{address:StatedAgendaAddress;start:number;end:number}|null {
  const header=agendaText.slice(0,HEADER_CHARS),street=streetKeyOf(header);
  if(!street)return null;
  const printed=header.slice(street.index,street.index+street.length).replace(/\s+/g," ").trim();
  const after=followingLocality(header.slice(street.index+street.length));
  const before=header.slice(0,street.index).replace(/\s+/g," ").trim();
  let cut=0;
  for(const noise of before.matchAll(HEADER_NOISE))cut=noise.index+noise[0].length;
  const words=before.slice(cut).replace(/^[\s,:-]+|[\s,:-]+$/g,"");
  return {address:{place:words&&words.length<=80?words:null,street:printed,city:after?.city??null,
    state:after?.state??null,zip:after?.zip??null,key:street.key},start:street.index,
    end:street.index+street.length+(after?.end??0)};
}

export function statedAgendaAddress(agendaText: string): StatedAgendaAddress | null {
  return addressParts(agendaText)?.address??null;
}

const AGENDA_BODY = /\b(?:call\s+to\s+order|roll\s+call|public\s+comment|consent\s+(?:agenda|calendar)|briefing\s+items)\b|(?:^|\n)\s*\d+[.)]\s+/i;
const MEETING_DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/i;

export interface AgendaAddressEvidence {readonly address:string;readonly quote:string}

function headerAddress(header:string,state:string,bareStreet=false,sourceHeader=header):AgendaAddressEvidence|null {
  state=state.toUpperCase();
  const parsed=addressParts(header),address=parsed?.address;
  if(address?.city&&address.state===state)
    return {address:`${address.street.normalize("NFKC")}, ${address.city}, ${state}${address.zip?` ${address.zip}`:""}`,
      quote:sourceHeader.slice(parsed!.start,parsed!.end).replace(/\s+/g," ").trim()};
  if(!bareStreet)return null;
  const bare=/^\s*(\d+[a-z]?(?:-\d+)?\s+[a-z][a-z\d .'-]*)\s*$/im.exec(header);
  if(!bare)return null;
  const start=bare.index+bare[0].indexOf(bare[1]!),end=start+bare[1]!.length;
  const locality=followingLocality(header.slice(end));
  return locality?.state===state?{address:`${bare[1]!.trim()}, ${locality.city}, ${state}${locality.zip?` ${locality.zip}`:""}`,
    quote:sourceHeader.slice(start,end+locality.end).replace(/\s+/g," ").trim()}:null;
}

/** A sitting's stated header address, before agenda items; its own source takes precedence over an office. */
export function agendaMeetingAddress(text:string,state:string):string|null {
  const header=text.slice(0,HEADER_CHARS).split(AGENDA_BODY,1)[0];
  const title=/\b(?:Meeting\s+)?(?:Agenda|Minutes)\b/i.exec(header);
  return title?headerAddress(header.slice(title.index+title[0].length),state)?.address??null:null;
}

/** The issuing board's header address and the exact source span containing its street and locality. */
export function agendaLetterheadOfficeEvidence(text:string,jurisdiction:string,state:string):AgendaAddressEvidence|null {
  const front=text.slice(0,HEADER_CHARS).split(AGENDA_BODY,1)[0];
  const title=/\b(?:Meeting\s+)?(?:Agenda|Minutes)\b/i.exec(front);
  if(!title)return null;
  const date=MEETING_DATE.exec(front),sourceHeader=front.slice(0,date?.index??front.length);
  const first=streetKeyOf(sourceHeader);
  const bare=/^\s*(\d+[a-z]?(?:-\d+)?\s+[a-z][a-z\d .'-]*)\s*$/im.exec(sourceHeader);
  const start=first?.index??bare?.index;
  if(start===undefined||start>=(date?.index??title.index))return null;
  if(start>=title.index&&/\b(?:meeting location|meeting venue|held at)\b/i.test(sourceHeader.slice(title.index+title[0].length,start)))return null;
  let header=sourceHeader;
  const name=jurisdiction.replace(/,\s*[A-Z]{2}$/i,"").trim();
  for(const label of [name,name.replace(/^(county|city|town|village|borough) of (.+)$/i,"$2 $1"),
    name.replace(/^(.+) (county|city|town|village|borough)$/i,"$2 of $1")]){
    if(!label)continue;
    const at=header.toLowerCase().indexOf(label.toLowerCase());
    if(at>=0)header=header.slice(0,at)+" ".repeat(label.length)+header.slice(at+label.length);
  }
  return headerAddress(header,state,true,sourceHeader);
}

/** The issuing board's published header address, before the sitting's date and agenda items. */
export function agendaLetterheadOffice(text:string,jurisdiction:string,state:string):string|null {
  return agendaLetterheadOfficeEvidence(text,jurisdiction,state)?.address??null;
}
