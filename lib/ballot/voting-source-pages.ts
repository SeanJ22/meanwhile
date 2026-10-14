import { htmlTableFragments, sourceText } from "./voting-source-tables.ts";
import type { VotingCapture, VotingFetchSession } from "./voting-source-fetch.ts";

const attr = (tag: string, name: string) => sourceText(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "");
interface VotingPageRequest { grid: string; page: number; pageCount: number; target: string; url: string; body: string }
/** The public form's own hidden state and Next Page control; no guessed private endpoint. */
export function votingPageRequests(html: string, pageUrl: string): VotingPageRequest[] {
  const hidden = new URLSearchParams();
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) if (attr(input[0], "type").toLowerCase() === "hidden") {
    const name = attr(input[0], "name"); if (name) hidden.set(name, attr(input[0], "value"));
  }
  const form = html.match(/<form\b[^>]*>/i)?.[0] ?? "", url = new URL(attr(form, "action") || pageUrl, pageUrl).href;
  if (new URL(url).origin !== new URL(pageUrl).origin) return [];
  return htmlTableFragments(html).flatMap(table => {
    if (!/rgMasterTable/i.test(table.attributes) || ![...table.body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].some(cell => /address/i.test(sourceText(cell[1]!)))) return [];
    const grid = attr(table.attributes, "id"), pages = sourceText(table.originalBody).match(/\b(\d+)\s+items?\s+in\s+(\d+)\s+pages?/i);
    const current = table.originalBody.match(/<a\b[^>]*class=["'][^"']*rgCurrentPage[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const page = Number(sourceText(current?.[1] ?? "1")), pageCount = Number(pages?.[2] ?? 1);
    if (!grid || page >= pageCount) return [];
    const next = [...table.originalBody.matchAll(/<input\b[^>]*>/gi)].find(input => /\brgPageNext\b/.test(attr(input[0], "class")) && !/\bdisabled(?:=|\s|>)/i.test(input[0]));
    const target = next ? attr(next[0], "name") : ""; if (!target) return [];
    const body = new URLSearchParams(hidden); body.set("__EVENTTARGET", target); body.set("__EVENTARGUMENT", "");
    return [{ grid, page, pageCount, target, url, body: body.toString() }];
  });
}
export async function readVotingPages(first: VotingCapture, session: VotingFetchSession): Promise<{ captures: VotingCapture[]; failures: string[] }> {
  const initialHtml = new TextDecoder().decode(first.bytes), captures: VotingCapture[] = [], failures: string[] = [];
  for (const initial of votingPageRequests(initialHtml, first.url)) {
    let request: VotingPageRequest | undefined = initial;
    const seen = new Set<number>();
    while (request) {
      if (seen.has(request.page)) { failures.push(`${request.grid}: page ${request.page} repeated; remaining pages still owed`); break; }
      seen.add(request.page);
      try {
        const next = await session.get(request.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: request.body });
        const html = new TextDecoder().decode(next.bytes);
        const nextRequest = votingPageRequests(html, next.url).find(item => item.grid === initial.grid);
        if (nextRequest && nextRequest.page <= request.page) { failures.push(`${request.grid}: public page control did not advance beyond ${request.page}`); break; }
        captures.push(next);
        if (!nextRequest && request.page + 1 < initial.pageCount) failures.push(`${request.grid}: remaining pages were not returned by the public form`);
        request = nextRequest;
      } catch (error) { failures.push(`${initial.grid}: ${String(error)}`); break; }
    }
  }
  return { captures, failures };
}
