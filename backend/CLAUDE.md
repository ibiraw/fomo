# backend/

Node 22 + TypeScript (strict). Local server: live prices, order engine, WebSocket gateway for the Chrome extension.

## Layout
| Path | Purpose |
|------|---------|
| `src/index.ts` | Composition root — wires adapters into the core |
| `src/config.ts` | Env validation (zod); creates `data/pairing-token.txt` on first run |
| `src/ports/` | `PriceFeedPort`, `SolanaAccountsPort`, `OrderStorePort`, `TradeExecutorPort` |
| `src/adapters/solana/` | `KitSolanaAccountsAdapter` — @solana/kit over Chainstack HTTP/WSS, auto-reconnect |
| `src/adapters/storage/` | `SqliteOrderStoreAdapter` — node:sqlite, compare-and-set status transitions |
| `src/adapters/gateway/` | `WsGateway` (ws://127.0.0.1:8787) + `protocol.ts` message schemas |
| `src/core/pricing/` | Price feeds behind `CompositePriceFeed` (priority order): `PumpPriceFeed` (curve + PumpSwap), `RaydiumLaunchLabPriceFeed` (bonk.fun curves, hands off to CPMM on graduation), `RaydiumCpmmPriceFeed`, `MeteoraDbcPriceFeed` (fomo's own launchpad curves; sqrt-price based), `JupiterPriceFeed` (polled fallback, tagged "slower"). Shared: `VaultPair` (slot-paired vault updates), `UsdQuotes` (SOL via Pyth, stables $1, others via Jupiter), `PoolDirectory` (DexScreener pool discovery, verified on-chain) |
| `src/core/tokens/` | `TokenInfoService`: name/symbol/X link from Token-2022 or Metaplex metadata, DexScreener socials fallback |
| `src/core/orders/` | `order.ts` (model, validation, trigger check), `OrderEngine` |
| `tests/` | vitest; fakes in `tests/helpers/` |
| `scripts/watch-price.ts` | Live price stream dev tool |

## Commands
- `npm run dev` — start server (prints pairing code)
- `npm test` / `npm run coverage` (80% threshold)
- `npm run typecheck`
- `npm run watch-price -- <mint> [seconds]`

## Order lifecycle
`open → triggered → executing → filled | failed | unknown`, `open/triggered → cancelled`.
- Slippage failure re-arms to `open` until `maxAttempts` (default 3).
- Before executing, the trigger is re-checked against the latest price; if no longer met → back to `open`.
- Timeout / extension disconnect / restart mid-trade → `unknown` (user must check FOMO).
- One trade at a time.

## Gateway protocol (JSON over WS)
Client: `hello{token,executor}`, `order.create{reqId,order}`, `order.cancel{reqId,id}`, `order.list{reqId}`, `token.info{reqId,mint}`, `price.watch{reqId,mint}` (viewer interest, 5 min TTL), `wallet.holds{reqId,mint}` → `{holds: boolean|null}`, `exec.result{execId,result}`, `pong`.
Server: `welcome{orders,ticks}`, `reply{reqId,ok,data|error}`, `order{order}`, `tick{tick}` (≤4/s per mint), `exec.request{execId,order}`, `ping`, `error`.
Only `chrome-extension://` origins or non-browser clients; wrong token → close 4001.

## Notes
- `.env` (RPC URLs) and `data/` (DB + pairing token) are git-ignored.
- Pool prices emit only when both vaults are at the same slot (avoids half-updated spikes).
- On-chain (sub-second): pump.fun curve/PumpSwap, Raydium LaunchLab (constant-product curves, SOL/USD1 quote), Raydium CPMM (any quote with a USD price), Meteora DBC (fomo launchpad; live pools use a newer discriminator than the published IDL — both accepted). Everything else: Jupiter every 1.5s.
- A feed that can't price a token throws `UnsupportedPoolError` and the next feed is tried; other errors are rethrown.
- LaunchLab and CPMM share the "PoolState" discriminator — LaunchLab pools are found by PDA, CPMM pools via DexScreener + layout check.
- Optional env: `FOMO_WALLET` (on-chain trade confirmation), `JUPITER_API_KEY`, `JUPITER_POLL_MS`.
