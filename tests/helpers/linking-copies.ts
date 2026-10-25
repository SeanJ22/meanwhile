import { readFileSync } from "node:fs";
import { installLinkingCopyQuery, linkingCopyIdentity } from "../../lib/facts/linking-copy.ts";
import type { OfficialLinkingPage, OfficialLinkingPageRef } from "../../lib/civic-data/source-authority.ts";

const pages = new Map(Object.entries(JSON.parse(readFileSync("data/reference/voting-linking-copies.json", "utf8"))).map(([id, page]) => [Number(id), page as { url: string; html: string; sha256: string }]));
installLinkingCopyQuery(async (sql, params = []) => {
  const id = Number(params[0]);
  if (sql.startsWith("INSERT INTO source_copy")) {
    pages.set(id, { url: String(params[1]), html: String(params[5]), sha256: String(params[3]) });
    return [];
  }
  const page = pages.get(id);
  return page ? [{ url: page.url, content: page.html, sha256: page.sha256 }] : [];
});
export function fixtureLinkingPage(page: OfficialLinkingPage): OfficialLinkingPageRef {
  const { id, sha256 } = linkingCopyIdentity(page.url, page.html);
  pages.set(id, { url: page.url, html: page.html, sha256 });
  return { url: page.url, sourceCopyId: id, ...(page.linkingPage ? { linkingPage: fixtureLinkingPage(page.linkingPage) } : {}) };
}
