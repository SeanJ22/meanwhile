/**
 * The name the product wears on its own surfaces — B01, interim, 2026-08-17.
 *
 * ## Why it changed
 *
 * "We the People" was the repo name by default. B01's own words: it carries
 * partisan branding baggage and is unsearchable. The author's interim ruling
 * is **Meanwhile** — on every ON-SITE surface, "internal-but-on-site"
 * included. The REPO name is unchanged, deliberately: renaming a repository
 * breaks every URL that points at it, and the outbound `User-Agent` this
 * product sends to public bodies carries that repo URL as its contact route,
 * so it stays as it is. A body that has our identifier in its logs from last
 * week must find the same identifier this week.
 *
 * ## Why it is a constant and not ten string literals
 *
 * The name was written out longhand in eight files and ten places, and that is
 * exactly why this rename is a task at all rather than an edit. Interim means
 * it is expected to move again; a name that lives in one place moves once.
 *
 * `tests/brand.test.ts` asserts no reader surface carries the old name and
 * that nothing hardcodes the new one where the constant belongs.
 */

/** What a reader sees this product called. */
export const PRODUCT_NAME = "Meanwhile";

/**
 * A page title, in the shape every page already used.
 *
 * `titleFor("What this site collects")` → `"What this site collects —
 * Meanwhile"`.
 */
export function titleFor(page: string): string {
  return `${page} — ${PRODUCT_NAME}`;
}
