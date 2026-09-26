# TASK 1 — Repo skeleton + price feed

Author: Reborn1987

## Scope
1. Backend project: Node 22, TypeScript strict, vitest, ports & adapters layout.
2. `PriceFeedPort` + `ChainstackPriceFeedAdapter`:
   - pump.fun bonding curve (pre-graduation)
   - PumpSwap pool (post-graduation)
   - Pyth SOL/USD for USD conversion
   - Unsupported pool types raise `UnsupportedPoolError` (no stubs)
3. Output per tick: mint, price USD, market cap USD, timestamp.
4. Validate live against the MC shown on FOMO.

## Done when
- Tests pass with >= 80% coverage.
- Live price for a pump.fun token matches FOMO's MC within ~1%.
