/**
 * Self-drawn calendar-tile marks identifying each destination app; not the
 * companies' official icons. Brand colours do not follow the theme.
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
