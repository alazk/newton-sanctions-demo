import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * One family, the whole page.
 *
 * The design system's sheets are set in a grotesque — labels, values, headings
 * and the sample UI all share it. The demo was running two serifs on top of
 * that (Instrument Serif for verdicts, Newsreader for prose), which is why
 * adopting the system's spacing and sizes barely showed: the tokens changed
 * and the voice did not.
 *
 * Self-hosted by next/font rather than linked from Google — a page whose
 * entire job is one legible verdict should not wait on someone else's CDN to
 * say it.
 */
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * What a link preview should say: one recipient, screened against the live
 * lists, decided by a quorum before the transfer runs.
 */
export const metadata: Metadata = {
  // Absolute URLs for og:image / twitter:image (app/opengraph-image.tsx).
  metadataBase: new URL("https://sanctions-demo.newt.foundation"),
  title: "Newton Sanctions Demo",
  description:
    "Check a wallet before you pay it. The wallet is screened against the RedStone Sanctions Oracle, 463 official lists including OFAC, EU, UN and UK, and the decision is signed by a Newton operator quorum on Ethereum Sepolia.",
  openGraph: {
    title: "Newton Sanctions Demo",
    description:
      "Check a wallet before you pay it. Screened against the RedStone Sanctions Oracle and signed by a Newton operator quorum.",
    type: "website",
    url: "https://sanctions-demo.newt.foundation",
    siteName: "Newton",
  },
  twitter: {
    card: "summary_large_image",
    title: "Newton Sanctions Demo",
    description:
      "Check a wallet before you pay it. Screened against the RedStone Sanctions Oracle and signed by a Newton operator quorum.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
