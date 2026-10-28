import { pageLinks } from "./routine-measure-pages.ts";

export function isColoradoBlueBook(url: string): boolean {
  try {
    const address = new URL(url);
    return ["leg.colorado.gov", "content.leg.colorado.gov"].includes(address.hostname) && /blue[\s_-]*book.*\.pdf$/i.test(address.pathname);
  } catch { return false; }
}

/** Follow the legislature's current links, rather than guessing a PDF filename. */
export async function acquireColoradoBlueBook(year: string, acquire: (url: string) => Promise<string | null>): Promise<string | null> {
  if (!/^\d{4}$/.test(year)) return null;
  const index = "https://leg.colorado.gov/bluebook", html = await acquire(index);
  if (html === null) return null;
  const official = (url: string) => ["leg.colorado.gov", "content.leg.colorado.gov"].includes(new URL(url).hostname);
  const publications = pageLinks(html, index).filter(link => official(link.url) && link.url.includes(year) && /blue[\s_-]*book/i.test(link.url));
  for (const publication of publications) {
    if (isColoradoBlueBook(publication.url) && await acquire(publication.url) !== null) return publication.url;
    const page = await acquire(publication.url);
    if (page === null) continue;
    for (const link of pageLinks(page, publication.url)) {
      if (official(link.url) && isColoradoBlueBook(link.url) && link.url.includes(year) && !/spanish|espanol|espa%C3%B1ol|[-_]es[-_]/i.test(link.url) &&
          await acquire(link.url) !== null) return link.url;
    }
  }
  return null;
}
