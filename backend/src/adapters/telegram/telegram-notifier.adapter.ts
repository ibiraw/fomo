/**
 * @file telegram-notifier.adapter.ts
 * @description NotifierPort over the Telegram Bot API (sendMessage to one chat) in HTML mode: addresses are
 *              tap-to-copy, usernames link to fomo profiles (telegram-format.ts). If Telegram ever rejects the markup,
 *              the message is re-sent as plain text so delivery never gets stuck. Telegram's 429 answers carry
 *              `retry_after`, surfaced as NotifierRateLimitError so the relay waits exactly that long.
 * @author Reborn1987
 */

import { stripHtml, telegramHtml } from '../../core/monitoring/telegram-format.js';
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

  /** Telegram HTML for one line. */
  override format(line: string): string {
    return telegramHtml(line);
  }

  /** Posts an HTML message (lines already formatted); falls back to plain text if the markup is rejected. */
  async send(text: string): Promise<void> {
    const post = (payload: Record<string, unknown>) => this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, disable_web_page_preview: true, ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    let res = await post({ text, parse_mode: 'HTML' });
    if (res.ok) return;
    let body = (await res.json().catch(() => ({}))) as { description?: string; parameters?: { retry_after?: number } };
    if (res.status === 400 && /parse entities|can't parse/i.test(body.description ?? '')) {
      res = await post({ text: stripHtml(text) });
      if (res.ok) return;
      body = (await res.json().catch(() => ({}))) as typeof body;
    }
    if (res.status === 429) throw new NotifierRateLimitError((body.parameters?.retry_after ?? 5) * 1000);
    // Never include the token in errors (it is part of the URL).
    throw new Error(`Telegram sendMessage failed (${res.status}): ${body.description ?? 'no description'}`);
  }
}
