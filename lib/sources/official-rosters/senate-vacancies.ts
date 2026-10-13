import type { PersonMembership, SeatVacancy } from "../../officials/types.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { first, nodes, parseHtml, textOf, type HtmlNode } from "./html.ts";
import type { OfficialRosterDocument } from "./federal.ts";

export interface SenateServiceSeat {
  readonly officeId: string;
  readonly state: string;
  readonly seatClass: number;
  readonly bioguide: string | null;
  readonly name: string | null;
  readonly since: string | null;
  readonly end: string | null;
  readonly present: boolean;
  readonly vacant: boolean;
  readonly disposition: string;
  readonly excerpt: string;
}
export interface SenateServiceEvidence {
  readonly seats: readonly SenateServiceSeat[];
  readonly endedMemberships: readonly PersonMembership[];
  readonly vacancies: readonly SeatVacancy[];
}
function textWithoutNotes(node: HtmlNode): string {
  return node.children.map(child=>typeof child==="string"?child:child.tag==="sup"?"":textWithoutNotes(child)).join(" ").replace(/\s+/g," ").trim();
}
function sourceDate(value: string): string | null {
  const match=/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
  const months:Record<string,string>={jan:"01",january:"01",feb:"02",february:"02",mar:"03",march:"03",apr:"04",april:"04",may:"05",jun:"06",june:"06",jul:"07",july:"07",aug:"08",august:"08",sep:"09",sept:"09",september:"09",oct:"10",october:"10",nov:"11",november:"11",dec:"12",december:"12"};
  if(!match || !months[match[1]!.toLowerCase()])return null;
  const date=`${match[3]}-${months[match[1]!.toLowerCase()]}-${match[2]!.padStart(2,"0")}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date?date:null;
}
/** The Senate groups exact Bioguide service rows by the state's two seat
 * classes. Explicit departures and later service starts establish a vacancy
 * interval; neither names nor an omitted XML row establish that fact. */
export function parseSenateServiceTable(document: OfficialRosterDocument, asOf: string): SenateServiceEvidence {
  const state=/^https:\/\/www\.senate\.gov\/states\/([A-Z]{2})\/senators\.htm$/.exec(document.url)?.[1];
  if(!state || !Object.values(FIPS_TO_STATE).some(row=>row.postal===state && row.prefix==="state"))throw new Error("SENATE_SERVICE_STATE_ROUTE_INVALID");
  const root=parseHtml(document.body);
  const table=first(root,node=>node.tag==="table" && !!first(node,child=>child.attrs["data-label"]==="SENATOR"));
  if(!table || !/<\/table>/i.test(document.body) || !Number.isFinite(Date.parse(asOf)))throw new Error("SENATE_SERVICE_TABLE_INVALID");
  const groups=new Map<number,SenateServiceSeat[]>();
  let seatClass:number|undefined;
  for(const row of nodes(table,node=>node.tag==="tr")){
    const heading=first(row,node=>node.tag==="th" && /^Class [123]$/.test(textOf(node)));
    if(heading){seatClass=Number(textOf(heading).slice(-1));if(groups.has(seatClass))throw new Error("SENATE_SERVICE_CLASS_DUPLICATE");groups.set(seatClass,[]);continue;}
    const senator=first(row,node=>node.attrs["data-label"]==="SENATOR");
    if(!senator)continue;
    if(!seatClass)throw new Error("SENATE_SERVICE_CLASS_MISSING");
    const beginning=first(row,node=>node.attrs["data-label"]==="TERM BEGAN"),ending=first(row,node=>node.attrs["data-label"]==="TERM ENDED");
    const comments=first(row,node=>node.attrs["data-label"]==="COMMENTS");
    if(!beginning || !ending || !comments)throw new Error("SENATE_SERVICE_ROW_FIELDS_MISSING");
    const anchor=first(senator,node=>node.tag==="a" && /(?:index=|\/bio\/)[A-Z]\d{6}/.test(node.attrs.href ?? ""));
    const bioguide=anchor?/(?:index=|\/bio\/)([A-Z]\d{6})/.exec(anchor.attrs.href!)?.[1] ?? null:null;
    const name=anchor?textWithoutNotes(anchor).replace(/\s+\([^()]+\)$/," ").trim():null;
    const vacant=/\bvacan(?:t|cy)\b/i.test(textWithoutNotes(senator));
    if(!bioguide && !vacant)throw new Error("SENATE_SERVICE_NATIVE_ID_MISSING");
    const endText=textWithoutNotes(ending),present=/^Present$/i.test(endText);
    const since=sourceDate(textWithoutNotes(beginning)),end=present?null:sourceDate(endText);
    groups.get(seatClass)!.push({officeId:`US:sen:${state}:${seatClass}`,state,seatClass,bioguide,name,since,end,present,vacant,disposition:textWithoutNotes(comments),excerpt:textWithoutNotes(row)});
  }
  if(groups.size!==2 || [...groups.values()].some(rows=>!rows.length))throw new Error("SENATE_SERVICE_TWO_CLASSES_MISSING");
  const day=asOf.slice(0,10),at=document.retrievedAt ?? asOf;
  const provenance={sourceUrl:document.url,sourceOrg:"United States Senate",collectedAt:at,verifiedAt:at};
  const vacancies:SeatVacancy[]=[],endedMemberships:PersonMembership[]=[],seats:SenateServiceSeat[]=[];
  for(const rows of groups.values()){
    const relevant=rows.filter(row=>row.since!==null && row.since<=day);
    const latest=relevant.at(-1);
    const last=rows.at(-1)!;
    if(!last.since || !last.present && !last.end)throw new Error("SENATE_SERVICE_CURRENT_ROW_DATE_INVALID");
    if(!latest)continue;
    seats.push(latest);
    const latestPeople=new Map<string,SenateServiceSeat>();
    for(const row of relevant)if(row.bioguide)latestPeople.set(`${row.officeId}:${row.bioguide}`,row);
    for(const row of latestPeople.values())if(row.end && row.end<=day && row.bioguide)endedMemberships.push({id:`${row.officeId}:${row.bioguide}`,personId:`congress:${row.bioguide}`,officeId:row.officeId,
      jurisdiction:"US",chamber:"sen",divisionId:`ocd-division/country:us/state:${state.toLowerCase()}`,current:false,termStart:row.since,termEnd:row.end,sourceUrl:document.url});
    const explicitDeparture=/\b(?:resigned|died|deceased|expelled)\b/i.test(latest.disposition);
    if(latest.vacant || latest.end && latest.end<=day && explicitDeparture){
      const since=latest.vacant?latest.since:latest.end;
      vacancies.push({id:latest.officeId,divisionId:`ocd-division/country:us/state:${state.toLowerCase()}`,officeTitle:"U.S. Senator",state,chamber:"senate",since,
        provenance:{...provenance,evidenceExcerpt:latest.excerpt}});
    }
  }
  return {seats,endedMemberships,vacancies};
}
