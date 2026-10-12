/**
 * Reading server-rendered reader markup in tests — one implementation, shared
 * by every test that renders a meeting surface.
 */

/** renderToStaticMarkup escapes these; the assertions read reader text. */
export function readerText(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The rendered row ids, in order, for a `data-meeting-id` surface. */
export function rowIds(html: string): string[] {
  return [...html.matchAll(/data-meeting-id="([^"]+)"/g)].map((m) => m[1]!);
}

/** One row's markup: from its `data-meeting-id` to the next one. */
export function rowMarkup(html: string, id: string): string {
  const start = html.indexOf(`data-meeting-id="${id}"`);
  if (start < 0) return "";
  const next = html.indexOf("data-meeting-id=", start + 20);
  return html.slice(start, next < 0 ? undefined : next);
}
