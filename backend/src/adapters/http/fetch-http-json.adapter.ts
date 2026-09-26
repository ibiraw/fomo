/**
 * @file fetch-http-json.adapter.ts
 * @description HttpJsonPort adapter using Node's built-in fetch.
 * @author Reborn1987
 */

import { FomoError } from '../../core/errors.js';
import { HttpJsonPort } from '../../ports/http-json.js';

export class FetchHttpJsonAdapter extends HttpJsonPort {
  /** @param headers extra headers sent with every request (e.g. an API key) */
  constructor(private readonly headers: Record<string, string> = {}) {
    super();
  }

  /** GETs and parses JSON with a timeout. */
  async getJson(url: string, timeoutMs: number): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', ...this.headers } });
    if (!res.ok) throw new FomoError(`GET ${url} failed: HTTP ${res.status}`);
    return res.json();
  }
}
