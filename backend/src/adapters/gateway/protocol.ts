/**
 * @file protocol.ts
 * @description WebSocket message schemas shared by the gateway and its clients (extension, bots).
 * @author Reborn1987
 */

import { z } from 'zod';

import { canonicalTokenKey, isTokenKey } from '../../core/chains/token-key.js';

/** A token key (Solana mint or `<chain>:<0xaddress>`), normalized to its canonical form. */
const TokenKeySchema = z.string().refine(isTokenKey, 'Not a valid token address').transform(canonicalTokenKey);

const ExecutionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), detail: z.string() }),
  z.object({
    ok: z.literal(false),
    kind: z.enum(['layout', 'slippage', 'not_logged_in', 'insufficient_funds', 'ui_error', 'timeout', 'unknown']),
    message: z.string(),
  }),
]);

/** Messages a client may send. `hello.token` is the account key; `create` registers it when unknown. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().max(200), executor: z.boolean(), create: z.boolean().default(false) }),
  z.object({ type: z.literal('order.create'), reqId: z.string(), order: z.unknown() }),
  z.object({ type: z.literal('order.cancel'), reqId: z.string(), id: z.string() }),
  z.object({ type: z.literal('order.list'), reqId: z.string() }),
  z.object({ type: z.literal('token.info'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('price.watch'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('wallet.holds'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('wallets.set'), reqId: z.string(), wallets: z.unknown() }),
  z.object({ type: z.literal('profile.set'), reqId: z.string(), fomoUsername: z.string().max(64).optional(), fomoUserId: z.string().max(80).optional() }),
  z.object({ type: z.literal('account.info'), reqId: z.string() }),
  z.object({ type: z.literal('account.delete'), reqId: z.string() }),
  z.object({ type: z.literal('billing.status'), reqId: z.string() }),
  z.object({ type: z.literal('billing.quote'), reqId: z.string() }),
  z.object({ type: z.literal('billing.claim'), reqId: z.string(), tx: z.string().max(300) }),
  z.object({ type: z.literal('exec.result'), execId: z.string(), result: ExecutionResultSchema }),
  /** A trade the user made with fomo's own Buy/Sell (seen from fomo's "Buying …" / "Selling …" toast), for monitoring. */
  z.object({ type: z.literal('trade.spot'), reqId: z.string(), side: z.enum(['buy', 'sell']), detail: z.string().max(200), mint: TokenKeySchema.optional() }),
  /** The extension's fomo self-check (token page, logged in) and fomo's "new version" prompt. */
  z.object({
    type: z.literal('layout.status'),
    reqId: z.string(),
    /** Self-check result; omitted when only reporting fomo's "new version" prompt. */
    ok: z.boolean().optional(),
    missing: z.array(z.string().max(120)).max(20).default([]),
    newVersion: z.boolean().default(false),
    snapshot: z.string().max(20_000).optional(),
  }),
  z.object({ type: z.literal('pong') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
