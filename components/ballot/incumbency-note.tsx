/**
 * Contest-level absence note: an asterisk on the contest heading and one
 * footnote below the cards, instead of any per-field indicator. The marker is
 * not a link.
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
