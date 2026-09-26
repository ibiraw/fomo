# backend/

Node 22 + TypeScript (strict). Price feed + (next) order engine for FOMO limit orders.

## Layout
| Path | Purpose |
|------|---------|
| `src/ports/` | Abstract interfaces: `PriceFeedPort`, `SolanaAccountsPort` |
| `src/adapters/solana/` | `KitSolanaAccountsAdapter` — @solana/kit over Chainstack HTTP/WSS, auto-reconnect |
| `src/core/pricing/` | Decoders (pump curve, PumpSwap pool, SPL token, Pyth), PDAs, math, `PumpPriceFeed` |
| `src/core/errors.ts` | Typed errors (`UnsupportedPoolError`, `AccountDecodeError`, ...) |
| `tests/` | vitest; `tests/helpers/fake-accounts.ts` builds fake account bytes |
| `scripts/watch-price.ts` | Live price stream dev tool |

## Commands
- `npm test` / `npm run coverage` (80% threshold)
- `npm run typecheck`
- `npm run watch-price -- <mint> [seconds]`

## Notes
- `.env` holds `SOLANA_RPC_HTTP` / `SOLANA_RPC_WSS` (git-ignored).
- Pool prices are emitted only when both vaults are at the same slot (avoids half-updated spikes).
- Only pump.fun tokens (curve + canonical PumpSwap pool), SOL or USDC quote. Others throw `UnsupportedPoolError`.
