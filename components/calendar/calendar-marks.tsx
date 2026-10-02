/**
 * Icon-size marks for the three calendar destinations (item 4, 2026-08-15).
 *
 * **What these are, stated plainly because it matters:** simplified,
 * self-drawn marks that identify which app a row sends the reader to. They
 * are NOT Apple's, Google's or Microsoft's official icon assets, and they do
 * not reproduce those companies' trademarks. Each is a calendar tile in the
 * destination's own brand colour with one distinguishing detail — which is
 * what actually does the work at 22px, where nobody reads a logo's fine
 * detail anyway; they read "red one", "the colourful one", "the blue one",
 * and the word beside it.
 *
 * Two reasons it is drawn rather than fetched. The obvious one: a published
 * page here is self-contained and an external asset is a request to somebody
 * else's server on a reader's behalf. The real one: shipping another
 * company's official mark is a claim of association this product does not
 * make and has no licence for, and "everyone does it" is not a licence.
 * Using the official assets would be a deliberate decision with a licence
 * behind it, and this file is where it would land.
 *
 * All three inherit nothing from the theme: a brand colour is the same colour
 * in dark and light, and the tile's face is drawn rather than left
 * transparent so it reads on either background.
 */

const TILE = "M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z";

/** Apple Calendar — the red header band over a white page. */
export function AppleCalendarMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={TILE} fill="#ffffff" stroke="#d8dae0" strokeWidth="1" />
      <path
        d="M3 5.5A2.5 2.5 0 0 1 5.5 3h13A2.5 2.5 0 0 1 21 5.5V8H3z"
        fill="#e8453c"
      />
      <text
        x="12"
        y="18.2"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="600"
        fill="#1a1a2e"
        fontFamily="system-ui, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

/** Google Calendar — the four-colour edge over a white page. */
export function GoogleCalendarMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={TILE} fill="#ffffff" stroke="#d8dae0" strokeWidth="1" />
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v3H3z" fill="#4285f4" />
      <path d="M12 3h6.5A2.5 2.5 0 0 1 21 5.5V6h-9z" fill="#ea4335" />
      <path d="M3 18.5V15h3v6h-.5A2.5 2.5 0 0 1 3 18.5z" fill="#34a853" />
      <path d="M18 15h3v3.5a2.5 2.5 0 0 1-2.5 2.5H18z" fill="#fbbc04" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        fill="#4285f4"
        fontFamily="system-ui, sans-serif"
      >
        31
      </text>
    </svg>
  );
}

/** Outlook — the solid blue tile with a white O. */
export function OutlookCalendarMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d={TILE} fill="#0f6cbd" />
      <ellipse
        cx="12"
        cy="12"
        rx="4.4"
        ry="5.4"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.1"
      />
    </svg>
  );
}
