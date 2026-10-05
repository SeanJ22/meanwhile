/**
 * Icon-size marks for the contact pill row (items 2 and 8, 2026-08-16).
 *
 * **The calendar-chooser standard applies** (see `calendar-marks.tsx`): these
 * are simplified, self-drawn glyphs that identify which channel a pill opens.
 * They are NOT the platforms' official brand assets and they do not reproduce
 * anyone's trademark. Shipping another company's official mark is a claim of
 * association this product does not make and has no licence for.
 *
 * Unlike the calendar tiles, these are MONOCHROME and draw in
 * `currentColor` — a pill is a tappable fact in the app's own register, and
 * five brand colours in one row would make the row read as an advertisement
 * rather than as a way to reach an office.
 */

const S = { width: 15, height: 15, viewBox: "0 0 24 24", "aria-hidden": true } as const;

export function XMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M17.6 3h3.3l-7.2 8.2L22 21h-6.6l-5.2-6.6L4.3 21H1l7.7-8.8L1.3 3H8l4.7 6.1zm-1.2 16h1.8L7.7 4.8H5.7z" />
    </svg>
  );
}

export function FacebookMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H16.7V3.6A21 21 0 0 0 14.3 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V13h2.7v8z" />
    </svg>
  );
}

export function YouTubeMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.75-1.77C18.3 5 12 5 12 5s-6.3 0-7.85.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.75 1.77C5.7 19 12 19 12 19s6.3 0 7.85-.43a2.5 2.5 0 0 0 1.75-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8M10 15V9l5.2 3z" />
    </svg>
  );
}

export function InstagramMark() {
  return (
    <svg
      {...S}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MastodonMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M12 2c4.4 0 8 2.1 8 6.4v5.2c0 2.5-1.9 4.2-4.6 4.5-1.6.2-3.2.2-4.8.1v1.1c0 1.6 1 2 2.4 2.1 1.4.1 3-.1 3-.1l.1 2s-2 .4-4 .3c-3.2-.1-4.9-1.6-5.3-3.8A18 18 0 0 1 6.6 17c0-4 .2-6.7.2-6.7C7 6 10 4.4 12 4.4zm3.6 6.5c0-1.3-.7-2-2-2-1.2 0-2 .5-2.4 1.4l-.5 1-.5-1c-.4-.9-1.2-1.4-2.4-1.4-1.3 0-2 .7-2 2v4.3h1.9V8.9c0-.6.3-.9.8-.9.6 0 .9.4.9 1.1v2.4h1.9V9.1c0-.7.3-1.1.9-1.1.5 0 .8.3.8.9v3.9h1.9z" />
    </svg>
  );
}

export function LinkedInMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M4.5 9h3.2v10.5H4.5zM6.1 4a1.85 1.85 0 1 1 0 3.7 1.85 1.85 0 0 1 0-3.7M9.8 9h3v1.45c.45-.85 1.55-1.7 3.2-1.7 3.2 0 3.8 2.1 3.8 4.85v5.9h-3.2v-5.2c0-1.25 0-2.85-1.75-2.85S13 14.1 13 15.4v4.1H9.8z" />
    </svg>
  );
}

export function TikTokMark() {
  return (
    <svg {...S} fill="currentColor">
      <path d="M16.6 3h-3.1v11.9a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.2a5.7 5.7 0 1 0 4.9 5.6V9.1a7.3 7.3 0 0 0 4.2 1.4V7.4a4.3 4.3 0 0 1-4.2-4.4z" />
    </svg>
  );
}

/**
 * The mark for a platform's `iconKey`. A key with no mark of its own (a
 * platform added in Admin) draws the generic globe, so its pill still shows.
 */
export function SocialMark({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case "x": return <XMark />;
    case "facebook": return <FacebookMark />;
    case "youtube": return <YouTubeMark />;
    case "instagram": return <InstagramMark />;
    case "mastodon": return <MastodonMark />;
    case "linkedin": return <LinkedInMark />;
    case "tiktok": return <TikTokMark />;
    default: return <GlobeMark />;
  }
}

export function PhoneMark() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 3.7 2 2 0 0 1 3.1 1.5h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.6 2.8a2 2 0 0 1-.5 2.1L7 9.3a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.8.6a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

export function GlobeMark() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5a15 15 0 0 1 0 19 15 15 0 0 1 0-19" />
    </svg>
  );
}

export function OfficialMark() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M4 21V9.5L12 4l8 5.5V21M9 21v-5h6v5" />
    </svg>
  );
}

export function MailMark() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m3 6 9 6.5L21 6" />
    </svg>
  );
}

export function FormMark() {
  return (
    <svg {...S} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
      <path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h4.5" />
    </svg>
  );
}
