import { lineOf } from "../../facts/check.ts";
import type { PlatformParser } from "../parser-hook.ts";
import { parseCalendarRows } from "./calendar.ts";

/**
 * A tenant's meeting calendar (`Calendar.aspx`): every body in its grid has its meetings and agendas posted at that page, and
 * every public sitting's own page is a link to read next. Any other page of the tenant is read, and holds nothing for this lane yet.
 */
export default {
  platform: "legistar-insite",
  parse(page) {
    const url = new URL(page.url);
    if (!/\/calendar\.aspx$/i.test(url.pathname)) return { facts: [], links: [] };
    const rows = parseCalendarRows(page.raw);
    const calendar = new URL("Calendar.aspx", url).href;
    const line = lineOf(page.copy, calendar);
    const bodies = [...new Set(rows.map(row => row.bodyName).filter(Boolean))];
    return {
      facts: line === null ? [] : bodies.map(name => ({ subjectHint: name, field: "agenda_url", fieldKind: "agenda" as const, value: calendar, valueText: calendar, quote: line })),
      links: rows.flatMap(row => [row.detailHref, row.bodyHref].filter((href): href is string => !!href)),
    };
  },
} satisfies PlatformParser;
