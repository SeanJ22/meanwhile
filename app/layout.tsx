import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { titleFor } from "@/lib/brand";

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

export const metadata: Metadata = {
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // The pre-paint script writes data-theme, so the server-rendered markup
      // and the first client pass legitimately differ on this element.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
