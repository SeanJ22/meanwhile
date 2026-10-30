/**
 * Which kind of website an address is on. The parser worker reads a link with the reader of its kind, so every link on the
 * work list is tagged with it when it is made. A file's own type wins over its host (a PDF on a vendor's host is read as a PDF).
 * The patterns use only what JavaScript and PostgreSQL both read the same way, so a database statement can tag rows too.
 * An address on a body's own site names no vendor, and has no kind until a lane adds one here.
 */
export const PLATFORM_PATTERNS: readonly (readonly [platform: string, pattern: string])[] = [
  ["pdf", "\\.pdf([?#]|$)"],
  ["ical", "\\.ics([?#]|$)|^webcal:|/ical([/?]|$)|format=ical"],
  ["legistar", "^https?://webapi\\.legistar\\.com/"],
  ["legistar-insite", "^https?://[a-z0-9-]+\\.legistar1?\\.com/|^https?://legistar[0-9]*\\.granicus\\.com/"],
  ["granicus", "granicus\\.com"],
  ["civicplus", "civicplus\\.com|/agendacenter([/?]|$)"],
  ["boarddocs", "boarddocs\\.com"],
  ["primegov", "primegov\\.com"],
  ["civicclerk", "civicclerk\\.com"],
  ["escribe", "escribemeetings\\.com"],
  ["iqm2", "iqm2\\.com"],
  ["novusagenda", "novusagenda\\.com"],
  ["municode", "municode\\.com"],
  ["diligent", "diligent\\.com|civicweb\\.net|diligentoneplatform\\.com|highbond\\.com"],
  ["boardbook", "boardbook\\.org"],
  ["apptegy", "apptegy\\.com|thrillshare\\.com"],
  ["onbase", "onbase"],
  ["suiteone", "suiteone"],
  ["swagit", "swagit\\.com"],
  ["revize", "revize\\.com"],
  ["clerksboards", "clerksboards"],
  ["schedulepage", "schedulepage"],
];

const COMPILED = PLATFORM_PATTERNS.map(([platform, pattern]) => [platform, new RegExp(pattern, "i")] as const);

/** The kind of website an address is on, or null when it names none. */
export function platformOf(url: string): string | null {
  return COMPILED.find(([, pattern]) => pattern.test(url))?.[0] ?? null;
}
