/**
 * @file fetch-http-json.adapter.ts
 * @description HttpJsonPort adapter using Node's built-in fetch.
 * @author Reborn1987
 */

import { FomoError } from '../../core/errors.js';
import { HttpJsonPort } from '../../ports/http-json.js';

export class FetchHttpJsonAdapter extends HttpJsonPort {
  /** GETs and parses JSON with a timeout. */
  async getJson(url: string, timeoutMs: number): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new FomoError(`GET ${url} failed: HTTP ${res.status}`);
    return res.json();
  }
}
