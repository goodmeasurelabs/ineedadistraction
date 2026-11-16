import type { Metadata } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import Script from 'next/script';
import AutoClaim from "./components/AutoClaim";
import AgentBanner from "./components/AgentBanner";
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
  "The break button: one press gives you a tiny game, about 2 minutes, that ends on a score you can share. Plus a daily challenge. Free, no sign-up, no sound.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ineedadistraction.com"),
  title: "I Need a Distraction — the break button for tiny games",
  description: SITE_DESCRIPTION,
  // opengraph-image.tsx at the app root is auto-wired as the default og/twitter image.
  openGraph: {
    title: "I Need a Distraction — the break button for tiny games",
    description: SITE_DESCRIPTION,
    url: "https://www.ineedadistraction.com",
    siteName: "I Need a Distraction",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "I Need a Distraction — the break button for tiny games",
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
          <AgentBanner />
          {children}
          <AutoClaim />
          {GA_ID && (
            <>
              <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
              {/* Visiting any page with ?notrack=1 turns analytics off in that browser
                  (?notrack=0 turns it back on), so the people building the site do
                  not count as players. */}
              <Script id="ga-init" strategy="afterInteractive">{`
                try {
                  var notrack = new URLSearchParams(location.search).get('notrack');
                  if (notrack === '1') localStorage.setItem('inad:notrack', '1');
                  if (notrack === '0') localStorage.removeItem('inad:notrack');
                  if (localStorage.getItem('inad:notrack') === '1') window['ga-disable-${GA_ID}'] = true;
                } catch (e) {}
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
