/**
 * @file use-background.ts
 * @description React hook connecting the popup to the background worker: live state + a request helper.
 * @author Reborn1987
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { POPUP_PORT, type BackgroundMessage, type PopupRequest, type PopupState } from '@/lib/messages';

type Pending = Map<string, { resolve: () => void; reject: (e: Error) => void }>;

/** Distributive Omit so each PopupRequest variant keeps its own fields. */
type WithoutReqId<T> = T extends unknown ? Omit<T, 'reqId'> : never;

/** Live background state (null until the first message) and a promise-based `send`. */
export function useBackground(): { state: PopupState | null; send: (req: WithoutReqId<PopupRequest>) => Promise<void> } {
  const [state, setState] = useState<PopupState | null>(null);
  const portRef = useRef<Browser.runtime.Port | null>(null);
  const pending = useRef<Pending>(new Map());
  const seq = useRef(0);

  useEffect(() => {
    const port = browser.runtime.connect({ name: POPUP_PORT });
    portRef.current = port;
    port.onMessage.addListener((msg: BackgroundMessage) => {
      if (msg.type === 'state') return setState(msg.state);
      const p = pending.current.get(msg.reqId);
      if (!p) return;
      pending.current.delete(msg.reqId);
      if (msg.ok) p.resolve();
      else p.reject(new Error(msg.error));
    });
    return () => port.disconnect();
  }, []);

  const send = useCallback((req: WithoutReqId<PopupRequest>): Promise<void> => {
    const port = portRef.current;
    if (!port) return Promise.reject(new Error('Extension background not reachable'));
    const reqId = `p${++seq.current}`;
    return new Promise((resolve, reject) => {
      pending.current.set(reqId, { resolve, reject });
      port.postMessage({ ...req, reqId } as PopupRequest);
    });
  }, []);

  return { state, send };
}
