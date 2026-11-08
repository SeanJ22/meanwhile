/** Read all source links from held HTML; returned links are investigation routes, not verified facts. */
import { extractLinks } from '../../hunt/page-links.ts';
export function uncappedSourceLinks(html:string, sourceUrl:string) {
  return extractLinks(html,new URL(sourceUrl),Number.MAX_SAFE_INTEGER).map(link=>({...link,sourceUrl}));
}
