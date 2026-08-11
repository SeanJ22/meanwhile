import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Display: Archivo's width axis is what carries the wordmark and notice heads.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

// Body: Public Sans is the typeface the US Web Design System ships. Quiet, and
// native to the subject.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

// Utility: dates, times, OCD-IDs, and the zip comb — anything that reads like
// it came off a docket.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "We the People — public meetings near you",
  description:
    "Enter a zip code to see the councils, boards, and commissions meeting near you.",
};

export const viewport: Viewport = {
  themeColor: "#070f11",
  // The map is full-bleed; let it run under the notch.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
