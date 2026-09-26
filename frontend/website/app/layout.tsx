/**
 * @file layout.tsx
 * @description Root layout: fonts, metadata, dark theme.
 * @author Reborn1987
 */

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Splash, SPLASH_SKIP_SCRIPT } from '@/components/site/Splash';

import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const TITLE = 'limit — automated orders for fomo (unofficial)';
const DESCRIPTION = 'Set a market-cap target and limit clicks Buy or Sell in your fomo tab when it hits. Dip buys, take profits and stop losses. Unofficial, no private keys.';

export const metadata: Metadata = {
  // Absolute preview URLs need the public address; set NEXT_PUBLIC_SITE_URL when building for a host.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'limit' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: '#09090b', colorScheme: 'dark' };

/** Root layout. */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SKIP_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <Splash />
        {children}
      </body>
    </html>
  );
}
