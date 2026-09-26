/**
 * @file telegram-notifier.adapter.ts
 * @description NotifierPort over the Telegram Bot API (sendMessage to one chat). Telegram's 429 answers carry
 *              `retry_after`, surfaced as NotifierRateLimitError so the relay waits exactly that long.
 * @author Reborn1987
 */

import { NotifierPort, NotifierRateLimitError } from '../../ports/activity.js';

/** Minimal fetch (injectable for tests). */
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class TelegramNotifierAdapter extends NotifierPort {
  /** @param token bot token from @BotFather @param chatId chat to post into @param fetchFn HTTP client */
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {
    super();
  }

  /** Posts a plain-text message. */
  async send(text: string): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
    if (res.status === 429) throw new NotifierRateLimitError((body.parameters?.retry_after ?? 5) * 1000);
    // Never include the token in errors (it is part of the URL).
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body.description ?? 'no description'}`);
  }
}
