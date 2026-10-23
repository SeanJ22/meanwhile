import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans, EB_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "./reader.css";
import { titleFor } from "@/lib/brand";
import { PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins";
import { READER_START_SCRIPT } from "@/lib/reader/bootstrap";

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
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/*
  Loaded through `next/font/google`, never a stylesheet `<link>` or `@import` to fonts.googleapis.com:
  `next/font` serves the files from this origin, so no reader's IP reaches Google.
*/
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

export const metadata: Metadata = {
  /* An Open Graph URL must be absolute; the origin comes from `lib/ops/origins.ts`, never typed out here. */
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

/* Written out rather than `LayoutProps<"/">`, which exists only after a build, so `tsc --noEmit` runs on a fresh clone. */
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
        <script dangerouslySetInnerHTML={{ __html: READER_START_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        {modal}
      </body>
    </html>
  );
}
