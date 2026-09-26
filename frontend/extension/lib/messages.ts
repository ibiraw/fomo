/**
 * @file messages.ts
 * @description Messages between the popup and the background worker (over a runtime Port named "popup").
 * @author Reborn1987
 */

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

export const POPUP_PORT = 'popup';
export const DEFAULT_SERVER_URL = 'ws://127.0.0.1:8787';

/** Everything the popup renders. */
export interface PopupState {
  readonly status: ConnectionStatus;
  readonly serverUrl: string;
  readonly hasToken: boolean;
  readonly orders: Order[];
  readonly ticks: Record<string, PriceTick>;
}

export type PopupRequest =
  | { readonly type: 'settings.save'; readonly reqId: string; readonly serverUrl: string; readonly token: string }
  | { readonly type: 'order.create'; readonly reqId: string; readonly order: NewOrder }
  | { readonly type: 'order.cancel'; readonly reqId: string; readonly id: string }
  | { readonly type: 'token.info'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'price.watch'; readonly reqId: string; readonly mint: string }
  | { readonly type: 'x.latest'; readonly reqId: string; readonly url: string; readonly force?: boolean };

export type BackgroundMessage =
  | { readonly type: 'state'; readonly state: PopupState }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: true; readonly data?: unknown }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: false; readonly error: string };
