/**
 * **RULING 28 — absence is ONE BURIED ANNOTATION PER CONTEST, never a
 * per-field indicator** (Prompt D item 1d, 2026-08-20).
 *
 * A field with no data renders nothing: no row, no label, no placeholder, no
 * greyed line, no dash, no "still looking for". Cards in a contest may be
 * different lengths and that is correct. The one disclosure that survives is
 * this: an asterisk on the contest heading, and a footnote below the cards in
 * small secondary text.
 *
 * WHAT IT SAYS, and why it is contest-level. The asymmetry a reader meets on a
 * ballot is not that one field is missing — it is that the person already
 * holding the office has a published record and the people running against
 * them mostly do not. That is a fact about the contest, so it is stated once
 * per contest rather than repeated down the side of every short card. Naming it
 * once is the honest disclosure; naming it per field was noise that made the
 * short cards look like findings about the candidates.
 *
 * LEVEL REGISTER. This is a claim surface — it is about real people and our
 * coverage of them — so it is plain and neutral, never cute.
 *
 * The marker is deliberately NOT a link. The footnote is a few centimetres
 * below it inside the same card, and a jump link to something already on
 * screen is reader friction with nothing to buy it.
 */

/** The exact sentence, in one place, so a test can pin it. */
export const INCUMBENCY_FOOTNOTE =
  "An incumbent is likely to have more information available here than the people running against them.";

/** The asterisk that sits on the contest heading. */
export function IncumbencyMarker() {
  return (
    <sup data-incumbency-marker="" className="ml-0.5 font-mono t-caption text-muted">
      *
    </sup>
  );
}

/** The footnote, below the cards, in small secondary text. */
export function IncumbencyFootnote() {
  return (
    <p
      data-incumbency-footnote=""
      className="mt-2.5 t-caption leading-relaxed text-muted"
    >
      * {INCUMBENCY_FOOTNOTE}
    </p>
  );
}
