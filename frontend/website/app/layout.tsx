/**
 * @file layout.tsx
 * @description Root layout: fonts, metadata, dark theme.
 * @author Reborn1987
 */

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'auto fomo — limit orders for fomo (unofficial)',
  description: 'Set a market-cap target and auto fomo clicks Buy or Sell in your fomo tab when it hits. Dip buys, take profits and stop losses. Unofficial, no private keys.',
};

export const viewport: Viewport = { themeColor: '#060510', colorScheme: 'dark' };

/** Root layout. */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
