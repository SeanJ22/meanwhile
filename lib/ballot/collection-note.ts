/**
 * **THE COLLECTION DISCLOSURE, DECLARED ONCE FOR THE TWO SURFACES THAT SAY IT.**
 * (Extracted 2026-08-21 for RULING 51. It was declared inside
 * `app/ballot/page.tsx` from 2026-08-20, when the ballot page was the only
 * surface that rendered it.)
 *
 * ## The author's own words, and they are shorter than ours
 *
 * His note on `PE01`, verbatim: *"We should simply say \"What we have found,
 * we are displaying here.\" That's it."* The first version shipped earlier the
 * same day as two sentences; he read it on the live deploy and cut it to one.
 * The second sentence was explaining the first, which is the product talking
 * about itself rather than telling a reader anything, and "That's it" is the
 * whole instruction: say it once and stop.
 *
 * ## Why it now lives here rather than in the page
 *
 * RULING 51 (2026-08-21, his note on `PE04`): *"That one line should be listed
 * once in the ballot section and once again on their battlecard."* Two
 * surfaces, one instance each. A second surface saying the same sentence from
 * its own string literal is a sentence that can drift — he has rewritten this
 * one once already, and the rewrite has to reach both places or the product
 * says two different things about its own coverage. One module, two importers.
 *
 * ## What this is NOT, and the distinction is load-bearing
 *
 * It is a PAGE-LEVEL and SURFACE-LEVEL statement, never a per-card one. RULING
 * 42 and RULING 44 deleted every per-card completeness marker; this sentence
 * says the same thing about every card at once and singles nobody out. A
 * battlecard is one surface a reader opens, not a card in a column of cards,
 * which is why it may carry it and a card may not.
 *
 * LEVEL REGISTER, and unhedged. This is a claim surface — it is about our own
 * coverage of real people — so it is plain, and it does not apologize.
 */
export const COLLECTION_NOTE = "What we have found, we are displaying here.";
