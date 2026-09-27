/**
 * @file connection-health.ts
 * @description Port for streaming-connection health: adapters with self-healing sockets report drops and
 *              re-establishment, so monitoring can alert only on outages that last.
 * @author Reborn1987
 */

/** Health sink for one connection (e.g. one chain's RPC WebSocket). */
export interface ConnectionHealth {
  /** The connection (or a subscription on it) failed; the adapter is retrying. */
  down(err: unknown): void;
  /** A (re)subscription succeeded. */
  up(): void;
}
