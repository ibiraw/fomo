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
    kind: z.enum(['slippage', 'not_logged_in', 'insufficient_funds', 'ui_error', 'timeout', 'unknown']),
    message: z.string(),
  }),
]);

/** Messages a client may send. */
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string(), executor: z.boolean() }),
  z.object({ type: z.literal('order.create'), reqId: z.string(), order: z.unknown() }),
  z.object({ type: z.literal('order.cancel'), reqId: z.string(), id: z.string() }),
  z.object({ type: z.literal('order.list'), reqId: z.string() }),
  z.object({ type: z.literal('token.info'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('price.watch'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('wallet.holds'), reqId: z.string(), mint: TokenKeySchema }),
  z.object({ type: z.literal('exec.result'), execId: z.string(), result: ExecutionResultSchema }),
  z.object({ type: z.literal('pong') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
