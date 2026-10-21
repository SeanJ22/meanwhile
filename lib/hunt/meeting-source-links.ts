import {extractLinks} from './page-links.ts';
import {defaultPlatformFingerprints} from '../control-plane/platform-fingerprints.ts';
/** Source-published calendar links only. Platform workers own their reads. */
export function meetingSourceLinks(html:string,url:string){
 const patterns=defaultPlatformFingerprints();
 return extractLinks(html,new URL(url),Number.MAX_SAFE_INTEGER).flatMap(link=>{
  const address=new URL(link.url),vendor=patterns.find(row=>row.hostPattern.test(address.hostname))?.id;
  const path=address.pathname;
  const platform=vendor ?? (/\/AgendaCenter\b|\/Calendar\.aspx|\/common\/modules\/iCalendar\b/i.test(path)?'civicplus':null);
  const ical=/\.(?:ics|ical)(?:$|[?#])|icalendar|[?&](?:ical|ics)=/i.test(link.url);
  if(!platform && !ical && !/meeting|agenda|minutes|calendar/i.test(link.text+' '+path))return [];
  return [{...link,vendor:platform??(ical?'ical':'own-site-meetings-page'),platform:platform!==null}];
 });
}
