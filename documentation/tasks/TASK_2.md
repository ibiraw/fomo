# TASK 2 — Order engine + extension gateway

Author: Reborn1987

## Scope
1. Order model: buy/sell, trigger on price or market cap (above/below), amount $ (min $2) or %.
2. `OrderStorePort` + SQLite adapter with atomic compare-and-set transitions.
3. `OrderEngine`: trigger on ticks, one trade at a time, slippage re-arm, restart recovery.
4. `WsGateway`: local WebSocket server, pairing-token auth, origin check, commands, execution relay.
5. Composition root `src/index.ts` + env config.

## Done when
- Tests pass with >= 80% coverage. ✅ (53 tests, 99% lines)
- Server boots against Chainstack. ✅
