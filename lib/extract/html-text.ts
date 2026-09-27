import { readableContent } from "./html-content.ts";
import { repairMojibake } from "../text/mojibake.ts";

/** Shared deterministic transcription; no fetching, models or evidence writes. */
export function extractHtmlText(html: string): string {
  const text = readableContent(html).html.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&times;/gi, "×").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return repairMojibake(text);
}
