/**
 * @file messages.ts
 * @description Messages between the popup and the background worker (over a runtime Port named "popup").
 * @author Reborn1987
 */

import type { AccountView, Wallets } from './account';
import type { BillingStatus } from './billing';
import type { ConnectionStatus } from './server-connection';
import type { NewOrder, Order, PriceTick } from './types';

/** Token details from the server (mirror of backend TokenInfo). */
export interface TokenInfo {
  readonly mint: string;
  readonly name: string;
  readonly symbol: string;
  readonly twitter: { readonly kind: 'profile' | 'community' | 'tweet'; readonly url: string; readonly handle: string | null } | null;
  readonly website: string | null;
}

/** Where a token was launched (v1.8; mirror of backend Launchpad). */
export interface LaunchpadInfo {
  readonly id: 'pump' | 'launchlab' | 'meteora-dbc' | 'four-meme' | 'flap';
  readonly name: string;
  /** Still on the launchpad's bonding curve (false: graduated to a DEX). */
  readonly onCurve: boolean;
}

/** Holder metrics (v1.9; mirror of backend TokenMetrics). */
export interface TokenMetricsInfo {
  /** % of supply held by the 10 largest real holders (pools, curves, burns left out); null when unknown. */
  readonly topTenPct: number | null;
  readonly devWallet: string | null;
  readonly devHoldsPct: number | null;
  readonly note: 'too-old' | 'dev-unknown' | null;
}

export const POPUP_PORT = 'popup';
/** Hosted server address baked in at build time (WXT_SERVER_URL); local server otherwise. */
export const HOSTED_SERVER_URL: string | null = import.meta.env.WXT_SERVER_URL || null;
export const DEFAULT_SERVER_URL = HOSTED_SERVER_URL ?? 'ws://127.0.0.1:8787';

/** Everything the popup renders. */
export interface PopupState {
  readonly status: ConnectionStatus;
  readonly serverUrl: string;
  readonly hasToken: boolean;
  /** The logged-in account (null until the server welcomes us). */
  readonly account: AccountView | null;
  /** Unlock status; null when the server has no paywall. */
  readonly billing: BillingStatus | null;
  readonly orders: Order[];
  readonly ticks: Record<string, PriceTick>;
}

export type PopupRequest =
  | { readonly type: 'settings.save'; readonly reqId: string; readonly serverUrl: string }
  | { readonly type: 'account.key'; readonly reqId: string }
  | { readonly type: 'account.restore'; readonly reqId: string; readonly key: string }
  | { readonly type: 'account.new'; readonly reqId: string }
  | { readonly type: 'account.delete'; readonly reqId: string }
  | { readonly type: 'wallets.set'; readonly reqId: string; readonly wallets: Wallets }
  | { readonly type: 'billing.quote'; readonly reqId: string }
  | { readonly type: 'billing.claim'; readonly reqId: string; readonly tx: string }
  | { readonly type: 'order.create'; readonly reqId: string; readonly order: NewOrder }
  | { readonly type: 'order.cancel'; readonly reqId: string; readonly id: string }
  | { readonly type: 'token.info'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'token.launchpad'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'token.metrics'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'price.watch'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'wallet.holds'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'x.latest'; readonly reqId: string; readonly url: string; readonly force?: boolean };

/** Sent by the fomo content script when it reads the user's wallets (page storage) and/or username (top bar). */
export interface WalletsDetectedMessage {
  readonly type: 'fomo.wallets';
  readonly wallets: Wallets;
  /** The logged-in user's fomo username, when the top bar shows it. */
  readonly fomoUsername?: string | null;
  /** fomo's unique user id, when fomo's storage has it. */
  readonly fomoUserId?: string | null;
}

export type BackgroundMessage =
  | { readonly type: 'state'; readonly state: PopupState }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: true; readonly data?: unknown }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: false; readonly error: string };
