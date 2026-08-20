/**
 * **The one placeholder address, everywhere.** (F01-continued session 2,
 * item 17, 2026-08-19.)
 *
 * ## The defect
 *
 * The author, on device: *"the 'where can I vote' pill's placeholder address
 * is a Tucson address. A reader in New Jersey reading a Tucson placeholder
 * learns the product was built for somewhere else."*
 *
 * He is right, and the reason it matters is not tidiness. This product's
 * completeness bar is **the stranger's** — `CLAUDE.md`'s stranger test says a
 * person in Tucson should be able to learn everything about Newbury, NH from
 * this product alone, and the same rule read the other way says nothing on
 * the surface may quietly announce whose product it is. A placeholder is a
 * small thing that answers a large question: *is this for me?*
 *
 * ## Why a constant rather than a corrected string
 *
 * A corrected string is one edit away from being a Phoenix address next time
 * somebody needs an example. A constant with an **allowlist of one** behind
 * it — `tests/placeholder-address.test.ts` asserts equality, not the absence
 * of a blocklist of real towns — cannot drift back: a new region-specific
 * example fails the suite whether or not anyone thought to add that region to
 * a list of banned ones. A blocklist of real addresses is unbounded and a
 * blocklist that misses one reads as a pass.
 *
 * ## It is a PLACEHOLDER, never a lookup
 *
 * It must never be geocoded, submitted, or resolved to a location. That is
 * structural here rather than a rule anyone has to remember: it is rendered
 * as an HTML `placeholder` attribute on a CONTROLLED input, so it is never
 * the input's `value`, and the submit handler reads `address.trim()` from
 * state with a `length < 3` guard. There is no path on which the placeholder
 * text becomes a request body — verified rather than assumed, and pinned by
 * the same test.
 */
export const PLACEHOLDER_ADDRESS = "123 Main St, Anywhere, USA";
