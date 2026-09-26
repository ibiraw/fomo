/**
 * @file messages.ts
 * @description Messages between the popup and the background worker (over a runtime Port named "popup").
 * @author Reborn1987
 */

import type { ConnectionStatus } from './server-connection';
import type { NewOrder, Order, PriceTick } from './types';

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
  | { readonly type: 'order.cancel'; readonly reqId: string; readonly id: string };

export type BackgroundMessage =
  | { readonly type: 'state'; readonly state: PopupState }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: true }
  | { readonly type: 'reply'; readonly reqId: string; readonly ok: false; readonly error: string };
