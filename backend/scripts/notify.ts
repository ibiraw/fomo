/**
 * @file notify.ts
 * @description Posts a message (and optionally one file) to the monitoring Telegram chat through the limit bot
 *              (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from .env) — used for the hourly optimization reports and other
 *              owner updates, so everything lands in the same "limit updates" group as the server's alerts.
 *              Usage (from backend/): npx tsx --env-file=.env scripts/notify.ts "message" [path/to/file]
 * @author Reborn1987
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Sends `text` (and `file` as a document with `text` as its caption) to the configured chat. */
async function main(text: string, file?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (run with --env-file=.env)');
  const api = (method: string): string => `https://api.telegram.org/bot${token}/${method}`;
  let res: Response;
  if (file) {
    const form = new FormData();
    form.set('chat_id', chat);
    form.set('caption', text.slice(0, 1024));
    form.set('document', new Blob([readFileSync(file)]), basename(file));
    res = await fetch(api('sendDocument'), { method: 'POST', body: form });
  } else {
    res = await fetch(api('sendMessage'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
  }
  const body = (await res.json()) as { ok: boolean; description?: string };
  // Never print the token: report only Telegram's own description.
  if (!body.ok) throw new Error(`Telegram refused the message: ${body.description ?? res.status}`);
  console.log('sent');
}

const [text, file] = process.argv.slice(2);
if (!text) {
  console.error('usage: npx tsx --env-file=.env scripts/notify.ts "message" [file]');
  process.exit(1);
}
main(text, file).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
