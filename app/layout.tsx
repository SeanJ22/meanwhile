import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans, EB_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./reader.css";
import { titleFor } from "@/lib/brand";
import { PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins";

// All UI text. Loaded as a variable font, which covers the 300–700 range the
// design uses without four separate downloads.
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

// Every numeral, count, identifier, OCD-ID, date and time. Anything a reader
// might compare column-wise or copy.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

/*
  THE RECORD REGISTER, AND THE BRAND WORDMARK (ITEM J, 2026-09-01).

  Weight 500 only. This face is not a body face here: it carries the wordmark
  and the text this product quotes from a public record, and one weight is all
  either of those needs.

  **LOADED THROUGH `next/font/google`, NEVER THROUGH A STYLESHEET `<link>` OR
  AN `@import` TO fonts.googleapis.com — AND THE REASON IS NOT PERFORMANCE.**
  `next/font` downloads the font files at BUILD time and serves them from this
  origin, so no reader's IP address is sent to Google when a page loads. A
  `<link rel="stylesheet">` to Google's CSS, by contrast, hands Google the IP,
  the User-Agent and the Referer of every single person who opens this site,
  on every page view.

  This site's whole claim is that it collects almost nothing about the people
  who read it — `app/transparency/page.tsx` says so in plain words. A
  third-party font request on every page view contradicts that claim, and it
  is the first thing a privacy-minded reporter will check, because it is
  visible in a network panel in about four seconds. The claim and the network
  tab have to agree.

  `tests/font-privacy.test.ts` refuses a Google font host anywhere in the app
  tree, and `scripts/brand-shots-0901.mts` records every host a real page load
  contacts.
*/
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

export const metadata: Metadata = {
  /*
    ITEM J (2026-09-01). `app/opengraph-image.png` and `app/apple-icon.png` are
    metadata-file conventions: Next emits the tags for them automatically, but
    an Open Graph URL has to be ABSOLUTE, and without a `metadataBase` Next
    resolves it against localhost and says so in a build warning.

    The origin comes from `lib/ops/origins.ts` and is never typed out here —
    one constant, three named origins, and `tests/origins.test.ts` sweeps for
    the literal.
  */
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  title: titleFor("Public meetings near you"),
  description:
    "Enter a zip code to see the councils, boards, and commissions meeting near you.",
};

export const viewport: Viewport = {
  themeColor: "#0f1117",
  // The map is full-bleed; let it run under the notch.
  viewportFit: "cover",
};

/*
  Set the theme before first paint.

  hooks/use-stored-theme.ts owns the choice, but no hook — and no effect — runs
  early enough to stop a light-theme reader seeing a flash of the dark palette.
  This is the standard escape hatch: a tiny synchronous script in <head> that
  reads the same key and writes the same attribute. Wrapped in try/catch because
  localStorage throws outright in some privacy modes, and a theme preference is
  never worth breaking the page over.
*/
const THEME_SCRIPT = `try{if(localStorage.getItem("wtp.theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}`;

/*
  `LayoutProps<"/">` — the global Next generates into `.next/types` during a
  build — used to be the annotation here, and `tsc --noEmit` therefore could
  not run on a checkout that had never been built (Prompt C item 1a, 2026-08-20).
  It passed on developer machines only because `.next` was lying around from
  the previous build, which meant every "tsc clean" ever reported was measured
  on a tree carrying generated files. The type it resolved to is this, so
  writing it out costs nothing and makes the type check runnable on a fresh
  clone. `tests/clean-typecheck.test.ts` fails if a generated global comes back.
*/
export default function RootLayout({
  children,
  modal,
}: {
  children: ReactNode;
  /**
   * The approved reader design's Ballot card: `app/@modal/(.)ballot`
   * intercepts a click on Ballot from the map and renders the ballot OVER the
   * map as the one large card. A direct visit to /ballot is still the full
   * page, so every existing deep link keeps working.
   */
  modal: ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} ${ebGaramond.variable} h-full antialiased`}
      // The pre-paint script writes data-theme, so the server-rendered markup
      // and the first client pass legitimately differ on this element.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        {modal}
      </body>
    </html>
  );
}
