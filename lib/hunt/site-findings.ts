import {subBodyId} from '../civic-data/meeting-body-crosswalk.ts';
import { cellText, decodeEntities, extractRoster, looksLikeNameCell } from './roster-page.ts';
import {officeIdentity} from '../officials/office-identity.ts';
import {sameSeatDiscriminators} from '../officials/office-seat.ts';
import {nameKey} from '../facts/roster-facts.ts';
import { visibleText } from '../extract/visible-text.ts';
import { extractLinks } from './page-links.ts';
import { pageCopy } from '../facts/source-copy.ts';
import { boundedIndexOf, normalizeText } from '../facts/check.ts';

export interface SiteFinding {
  subjectId: string;
  field: string;
  value: string;
  exactQuote: string;
  sourceUrl: string;
  artifactIds: readonly string[];
  sourceWorkItemId?: string;
  sourceAttemptId?: string;
  shownMemberId?: string;
  observedAt?: string;
}
export interface SiteScope {
  governmentId: string;
  name: string;
  state: string;
  bodyId: string | null;
  website: string;
  bodyName?: string | null;
  govClass?: string;
  /** A previously read standing-body page linked to this page. */
  bodyContext?:boolean;
  bodies?:readonly {id:string;name:string}[];
  members?: readonly {id:string;name:string;office:string;bodyId:string}[];
}
export interface SitePage {
  url: string;
  html: string;
  artifactId: string;
  observedAt: string;
  requestCount?:number;
  via?:{page:string;artifactId:string};
  redirects?:readonly {from:string;to:string;status:number}[];
  sourceWorkItemId?: string;
  sourceAttemptId?: string;
}

/** Select source words that hold both the person and the field. A whole
 * table would attach the next person's contact and term to this person. */
function memberQuote(html: string, name: string, value: string): string | null {
  const has = (text: string, token: string) => boundedIndexOf(normalizeText(text), normalizeText(token)) >= 0;
  const blocks: string[] = [];
  for (const tag of ['tr', 'article', 'li']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    for (const match of html.matchAll(pattern)) {
      const text = cellText(match[0]);
      if (has(text, name) && (has(text, value) || has(match[0], value)) && !text.split('\n').some(line=>looksLikeNameCell(line) && normalizeText(line)!==normalizeText(name) && !has(line,name))) blocks.push(match[0]);
    }
    if (blocks.length) break;
  }
  if (blocks.length) return cellText(blocks.sort((a,b)=>a.length-b.length)[0]!);
  const text = visibleText(html);
  const at = text.indexOf(name);
  if (at < 0) return null;
  // A profile page must name the holder once. Repeated name-shaped menus
  // cannot establish which neighboring contact belongs to this holder.
  const lines = text.slice(at).split('\n');
  const boundary=lines.findIndex((line,i)=>i>0 && looksLikeNameCell(line) && !has(line,name));
  const quote = lines.slice(0, boundary>=0 ? Math.min(boundary,5):5).join('\n');
  return has(quote, value) ? quote : null;
}

/** A standing body's name, rather than an article title or a room label. */
export function isBodyName(name:string):boolean {
  if(name.length>120)return false;
  if(name.split(/\s+/).length<2)return /^(?:council|assembly|selectboard|selectmen|trustees)$/i.test(name);
  if(/^(?:meet|contact|about|join|welcome|ask|visit|watch|view|be aware)\b/i.test(name) || /\b(?:20\d{2}|meetings?|agendas?|minutes|news|archives?|calendar|reappointed|appointed|elected|announces?|approved?|adopted?|welcomes?|reappoints?|honors?|events?|council member|establishes?|blessing|launches?|invites?|seeks?|seeking|receives?|opens?|celebrates?|chambers|projects|responsibilities|documents)\b/i.test(name))return false;
  return /\b(?:agency|council|commission|assembly|selectboard|selectmen|trustees|committee|board)(?:\s*\([^)]*\))?$/i.test(name) ||
    /\b(?:board|commission|council|committee)\s+(?:of|on|for)\s+[\p{L}\p{N}&,'’.\- ]+$/iu.test(name);
}

/** Plain-code findings from one government's saved page. Unsupported fields
 * still go to the shared Box; publication decides their target and checks. */
export function siteFindings(scope: SiteScope, page: SitePage): SiteFinding[] {
  const ownHost = new URL(scope.website).hostname.toLowerCase().replace(/^www\./, '');
  const pageAddress = new URL(page.url);
  const pageHost = pageAddress.hostname.toLowerCase().replace(/^www\./, '');
  if (ownHost !== pageHost && !pageHost.endsWith(`.${ownHost}`)) return [];
  let subjectId = scope.bodyId ?? scope.governmentId;
  const out = new Map<string, SiteFinding>();
  let shownMemberId:string|undefined;
  const copy = pageCopy({ finalUrl: page.url, body: page.html, contentType: 'text/html', fetchedAt: page.observedAt });
  const normalizedCopy = normalizeText(copy.text);
  const holds = (quote: string, value: string) => normalizedCopy.includes(normalizeText(quote)) &&
    (/^https?:\/\//i.test(value) ? normalizedCopy.includes(normalizeText(value)) : boundedIndexOf(normalizeText(quote), normalizeText(value)) >= 0);
  const add = (field: string, value: string | null | undefined, quote: string | null | undefined) => {
    if (!value?.trim() || !quote?.trim() || !holds(quote, value)) return;
    const finding = { subjectId, field, value, exactQuote: quote, sourceUrl: page.url, artifactIds: [page.artifactId], observedAt:page.observedAt, ...(shownMemberId ? {shownMemberId}: {}), ...(page.sourceWorkItemId ? {sourceWorkItemId:page.sourceWorkItemId,sourceAttemptId:page.sourceAttemptId}: {}) };
    out.set(`${subjectId}\u0000${field}\u0000${value}\u0000${quote}`, finding);
  };
  const content = page.html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const main = /<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)\s*>/i.exec(content)?.[1] ?? content;
  const cleanHeading=(html:string)=>cellText(html).replace(/\s*:\s*$/,'').replace(/\s+(?:Members|Membership|Roster|Directory)$/i,'');
  const topHeading=/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(main);
  const parts=topHeading?cellText(topHeading[1]).split(/\s+(?:&|and)\s+/i):[];
  if(parts.length>1 && parts.every(isBodyName)){
    const headers=[...main.matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h[2-4]\s*>/gi)];
    const sections=headers.flatMap((header,index)=>{
      const label=cleanHeading(header[2]),key=normalizeText(label).toLowerCase();
      const matches=parts.filter(part=>normalizeText(part).toLowerCase()===key || /\(([A-Z][A-Z0-9&-]*)\)\s*$/.exec(part)?.[1].toLowerCase()===key);
      return matches.length===1?[{name:matches[0],start:header.index!,end:headers[index+1]?.index??main.length}]:[];
    });
    const findings:SiteFinding[]=[];
    for(const name of parts){
      subjectId=subBodyId(scope.governmentId,name);add('GOV-02',name,cellText(topHeading![1]));
      for(const section of sections.filter(section=>section.name===name))findings.push(...siteFindings({...scope,bodyId:subjectId,bodyName:name,bodyContext:true},{...page,html:main.slice(section.start,section.end)}));
    }
    return [...out.values(),...findings];
  }
  const documentPage=/\/(?:news(?:_detail)?|press|archives?|meetings?|minutes|agendas?|calendar)(?:\/|[_.?]|$)|CivicAlerts\.aspx|AgendaCenter|Calendar\.aspx|DocumentCenter/i.test(page.url);
  const bodyNames=documentPage?[]:[...main.matchAll(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]\s*>/gi)].map(match=>cleanHeading(match[1]))
    .filter(name=>isBodyName(name));
  const sameBody=(name:string)=>scope.bodyName && normalizeText(name).toLowerCase()===normalizeText(scope.bodyName).toLowerCase() ||
    (scope.bodyId?.endsWith('#governing') && /\b(council|board of (?:supervisors|commissioners|trustees)|selectboard|selectmen|town board|county commission|county assembly)\b/i.test(name)) ||
    (scope.bodyId?.endsWith('#board') && /\b(school board|board of education|governing board|board of trustees)\b/i.test(name));
  const namedBodies=[...new Set(bodyNames)];
  const identified=namedBodies.length===1 && sameBody(namedBodies[0]);
  const historic=/\b(former|previous|past|histor(?:y|ic)|memorial)\b/i.test(namedBodies.join(' ')) || /\/(?:history|former|past-members|archives)(?:\/|[.?]|$)/i.test(page.url);
  if(namedBodies.length===1 && !historic){
    const name=namedBodies[0];const known=(scope.bodies??[]).filter(body=>normalizeText(body.name).toLowerCase()===normalizeText(name).toLowerCase());
    if(known.length===1)subjectId=known[0].id;
    else if(!identified)subjectId=subBodyId(scope.governmentId,name);
    add('GOV-02',name,name);
  }
  else for(const name of namedBodies)add('GOV-03',name,name);
  const candidates=/\b(candidates?|elections?|ballots?)\b/i.test(pageAddress.pathname) || [...main.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].some(m=>/\b(candidates?|elections?|ballots?)\b/i.test(cellText(m[1])));
  const historicalDocument=/\/(?:news(?:_detail)?|archives?|meetings?|minutes|agendas?|calendar)(?:\/|[_.?]|$)|CivicAlerts\.aspx|AgendaCenter|Calendar\.aspx/i.test(page.url);
  const rosterPage=scope.bodyContext || namedBodies.length===1 || /(?:council|selectboard|selectmen|board-of-(?:education|supervisors|trustees|commissioners)|school-board)/i.test(pageAddress.pathname);
  const roster=rosterPage && (namedBodies.length<=1) && !historic && !candidates && !historicalDocument ? extractRoster(page.url,main).members : [];
  for (const member of roster) {
    const ownQuote=(value:string)=>member.sourceQuote && boundedIndexOf(normalizeText(member.sourceQuote),normalizeText(value))>=0 ? member.sourceQuote : memberQuote(main,member.name,value);
    const nameQuote = ownQuote(member.name);
    if(!nameQuote || /\b(former|retired|in memoriam|candidate for)\b/i.test(cellText(nameQuote)))continue;
    const rolePattern=/\b(?:(?:city|town|county|borough)\s+)?(?:board[ -]?member|secretary|vice[ -]?mayor|mayor(?:\s+pro\s+tem)?|council(?:[ -]?member|man|woman|lor|or)|assembly[ -]?member|alder(?:man|woman)|select(?:man|woman)|commissioner|trustee|supervisor|(?:vice[\s-]+)?chair(?:man|woman|person)?|(?:vice[\s-]+)?president|director|superintendent|administrator|manager|clerk|treasurer|sheriff|judge|attorney)\b/i;
    let sourceRole=member.officeTitle && rolePattern.test(member.officeTitle) && boundedIndexOf(normalizeText(nameQuote),normalizeText(member.officeTitle))>=0 ? member.officeTitle : rolePattern.exec(nameQuote)?.[0]??null;
    if(sourceRole && member.seat && !sourceRole.includes(member.seat) && boundedIndexOf(normalizeText(nameQuote),normalizeText(sourceRole+' '+member.seat))>=0)sourceRole+=' '+member.seat;
    const named=(scope.members??[]).filter(m=>m.bodyId===subjectId && nameKey(m.name)===nameKey(member.name));
    const matched=named.filter(m=>member.officeTitle && officeIdentity(m.office) && officeIdentity(m.office)===officeIdentity(member.officeTitle) && sameSeatDiscriminators(m.office,nameQuote,scope.governmentId));
    if(named.length && matched.length!==1)continue;
    shownMemberId=matched[0]?.id;
    add('OFF-04', member.name, nameQuote);
    for (const [field,value] of [['OFF-02',sourceRole], ['OFF-06',member.termNote], ['OFF-09',member.phone], ['OFF-09',member.email]] as const) {
      if (value) add(field,value,ownQuote(value));
    }
    if (member.contactPageUrl) add('OFF-08',member.contactPageUrl,memberQuote(main,member.name,member.name));
    for (const match of main.matchAll(/<img\b[^>]*>/gi)) {
      const alt=/\balt\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1];
      const src=/\bsrc\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1];
      if (!alt || !src || !normalizeText(alt).toLowerCase().includes(normalizeText(member.name).toLowerCase())) continue;
      const url=new URL(decodeEntities(src),page.url).href;
      add('OFF-17',url,match[0]);
    }
  }
  shownMemberId=undefined;
  for (const match of content.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address\s*>/gi)) {
    const text=cellText(match[1]);
    const near=content.slice(Math.max(0,match.index!-180),match.index!+match[0].length);
    if(!/\b(office|city hall|town hall|municipal|courthouse|government cent(?:er|re)|district office)\b/i.test(cellText(near)))continue;
    if (/\b\d{1,6}\s+[^\n]+\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|boulevard|blvd\.?|way|highway|hwy\.?|lane|ln\.?|plaza)\b/i.test(text)) add('body.officeAddress',text,match[0]);
  }
  const words=visibleText(main);
  for (const line of words.split('\n')) {
    if (/\b(meet|meets|meetings)\b/i.test(line) && /\b(every|each|monthly|weekly|first|second|third|fourth|last)\b/i.test(line) &&
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(line)) add('MTG-04',line,line);
    if (/\b(public comment|written comments?|speak at|attend the meeting|register to speak)\b/i.test(line)) add('PAR-02',line,line);
  }
  const links=extractLinks(main,new URL(page.url),Number.MAX_SAFE_INTEGER);
  for (const link of links) {
    const linkAddress = new URL(link.url);
    if (/\b(meetings?|agendas?|minutes|calendar|icalendar)\b|\.ics(?:$|[?#])/i.test(`${link.text} ${linkAddress.pathname}`)) {
      const document=/\.(?:pdf|docx?|rtf)(?:[?#]|$)/i.test(link.url) || /\b(?:19|20)\d{2}\b/.test(link.text);
      add(document?'DOC-02':'MTG-01',link.url,link.url);
    }
    if (/\b(candidates?|sample ballot|voter guide|election results)\b/i.test(link.text)) add('ELE-01',link.url,link.url);
    if (/\b(charter|municipal code|ordinances?|bylaws|establishing)\b/i.test(link.text)) add('GOV-04',link.url,link.url);
    if (/\b(budget|financial report|annual report|audit)\b/i.test(link.text)) add('FIN-01',link.url,link.url);
    if (/\b(campaign finance|contribution|financial disclosure)\b/i.test(link.text)) add('CAM-01',link.url,link.url);
    if (/\b(boards?|commissions?|departments?)\b/i.test(link.text)) add('GOV-03',link.url,link.url);
  }
  return [...out.values()];
}

/** Follow source-published links that could fill an open family. The caller
 * keeps its continuation; it does not retain prior page bodies. */
export function blankLinks(page: SitePage, families: ReadonlySet<string>): readonly {url:string;text:string}[] {
  const patterns: Record<string,RegExp> = {
    GOV:/council|board|commission|department|government|charter|code|contact|about/i,
    OFF:/council|assembly|alderm|select|board|commission|elected|official|member|mayor|trustee|leadership|directory|contact|staff|bio/i,
    MTG:/meeting|agenda|minutes|calendar|notice|\.ics(?:$|[?#])|icalendar/i, DOC:/meeting|agenda|minutes|calendar|notice|\.ics(?:$|[?#])|icalendar/i,
    CAN:/candidate|election|ballot|voter/i,ELE:/candidate|election|ballot|voter|registration/i,
    PAR:/participat|comment|attend|meeting|contact/i,LEG:/legislat|ordinance|code|vote|council/i,
    EXE:/executive|order|mayor|governor/i,PRL:/statement|press|news|speech/i,
    REF:/government|directory|contact|about/i,
    CAM:/campaign|finance|contribution|expenditure|disclosure|filing/i,
    FIN:/budget|financ|audit|annual.report|revenue|expenditure|tax/i,
  };
  return extractLinks(page.html,new URL(page.url),Number.MAX_SAFE_INTEGER).filter(link=>{
    const linkAddress=new URL(link.url);
    return [...families].some(family=>patterns[family]?.test(`${link.text} ${linkAddress.pathname}`));
  });
}
