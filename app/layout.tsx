import type { Metadata } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import Script from 'next/script';
import AutoClaim from "./components/AutoClaim";
import "./globals.css";

const GA_ID = process.env.GOOGLE_MEASUREMENT_ID;

// Arcade cabinet type: Press Start 2P for marquee headings/logos (used sparingly —
// it's unreadable at body size), VT323 for retro terminal flavor text and stat displays.
const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});
const arcadeFont = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-arcade",
});

const SITE_DESCRIPTION =
  "Tiny games for a better break. Play instantly, try a surprising twist, and make your own mini-game with AI.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ineedadistraction.com"),
  title: "I Need a Distraction — tiny games, happy accidents",
  description: SITE_DESCRIPTION,
  // opengraph-image.tsx at the app root is auto-wired as the default og/twitter image.
  openGraph: {
    title: "I Need a Distraction — tiny games, happy accidents",
    description: SITE_DESCRIPTION,
    url: "https://www.ineedadistraction.com",
    siteName: "I Need a Distraction",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "I Need a Distraction — tiny games, happy accidents",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${pixelFont.variable} ${arcadeFont.variable}`}>
        <body className="antialiased">
          {children}
          <AutoClaim />
          {GA_ID && (
            <>
              <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
              <Script id="ga-init" strategy="afterInteractive">{`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}');
              `}</Script>
            </>
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
