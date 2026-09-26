/**
 * @file http-json.ts
 * @description HttpJsonPort — fetch JSON documents over HTTP (token metadata files).
 * @author Reborn1987
 */

/** Abstract JSON fetcher. Adapter: FetchHttpJsonAdapter. */
export abstract class HttpJsonPort {
  /** GETs `url` and parses JSON. Rejects on network error, non-2xx status, bad JSON or timeout. */
  abstract getJson(url: string, timeoutMs: number): Promise<unknown>;
}
