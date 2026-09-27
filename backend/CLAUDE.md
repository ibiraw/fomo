# backend/

Node 22 + TypeScript (strict). Shared server: live prices (shared by everyone), per-account orders, WebSocket gateway the extensions log into.

## Layout
| Path | Purpose |
|------|---------|
| `src/index.ts` | Composition root — wires adapters into the core |
| `src/config.ts` | Env validation (zod); creates `data/pairing-token.txt` on first run |
| `src/ports/` | `PriceFeedPort`, `SolanaAccountsPort`, `EvmRpcPort`, `OrderStorePort`, `TradeExecutorPort`, `TradeConfirmerPort` |
| `src/evm-chain.ts` | Composition for one EVM chain (used by index.ts and `watch-evm-price`) |
| `src/adapters/evm/` | `ViemEvmRpcAdapter` — batched HTTP eth_call + WebSocket `logs` subscriptions (re-subscribes with backoff) |
| `src/core/chains/` | Token keys (`<mint>` for Solana, `<chain>:<0xaddress>` for EVM; fomo URL slugs), `ChainRouterPriceFeed`, `ChainRouterConfirmer` |
| `src/core/evm/` | Per chain: `LaunchpadPriceFeed` (four.meme on BNB, flap.sh on BNB/Base/Robinhood; trade events carry the price; hands off to pools on graduation) → `EvmPoolPriceFeed` (v2 Sync / v3 + PancakeSwap v3 Swap / Uniswap v4 Swap via StateView) → `DexScreenerPriceFeed` (polled, "slower"). `EvmUsdQuotes` (stables $1, others chained on-chain, loop-safe via AsyncLocalStorage path), `Erc20Reader`, `EvmWalletConfirmer`, `evm-addresses.ts` (verified contract addresses) |
| `src/adapters/solana/` | `KitSolanaAccountsAdapter` — @solana/kit over Chainstack HTTP/WSS, auto-reconnect |
| `src/adapters/storage/` | `SqliteOrderStoreAdapter` (compare-and-set transitions, `user_id` per order) and `SqliteAccountStoreAdapter` (secret hashes + wallets) — same node:sqlite file |
| `src/core/accounts/` | `AccountService` (login/create by key, wallets, legacy owner), `WalletConfirmers` (per-account on-chain confirmers, cached) |
| `src/adapters/gateway/` | `WsGateway` (ws://127.0.0.1:8787) + `protocol.ts` message schemas |
| `src/core/pricing/` | Price feeds behind `CompositePriceFeed` (priority order): `PumpPriceFeed` (curve + PumpSwap), `RaydiumLaunchLabPriceFeed` (bonk.fun curves, hands off to CPMM on graduation), `RaydiumCpmmPriceFeed`, `MeteoraDbcPriceFeed` (fomo's own launchpad curves; sqrt-price based; hands off to DAMM v2), `MeteoraDammV2PriceFeed` (sqrt-price pools, any quote token with a USD price), `JupiterPriceFeed` (polled fallback, tagged "slower"). Shared: `VaultPair` (slot-paired vault updates), `UsdQuotes` (SOL via Pyth, stables $1, others via Jupiter), `PoolDirectory` (DexScreener pool discovery, verified on-chain) |
| `src/core/tokens/` | `TokenInfoService`: name/symbol/X link from Token-2022 or Metaplex metadata, DexScreener socials fallback |
| `src/core/orders/` | `order.ts` (model, validation, trigger check), `OrderEngine` |
| `tests/` | vitest; fakes in `tests/helpers/` |
| `scripts/watch-price.ts` | Live price stream dev tool |
| `scripts/fuzz-inputs.ts` | Input fuzzer: every message type with junk, hostile, SQL-injection and edge values; checks no crash / hang / "Internal error", cross-account isolation and DB integrity — test server only |
| `scripts/load-test.ts` | Limit + load test for the gateway — run only against a separate test server (see Load testing) |

## Commands
- `npm run dev` — start server (prints pairing code)
- `npm test` / `npm run coverage` (80% threshold)
- `npm run typecheck`
- `npm run watch-price -- <mint> [seconds]`
- `npm run watch-evm-price -- <chain>:<0xaddress> [seconds]`

## Order lifecycle
`open → triggered → executing → filled | failed | unknown`, `open/triggered → cancelled`.
- Slippage failure re-arms to `open` until `maxAttempts` (default 3).
- Before executing, the trigger is re-checked against the latest price; if no longer met → back to `open`.
- Timeout / extension disconnect / restart mid-trade → `unknown` (user must check FOMO).
- One trade at a time.

## Accounts
- The extension makes a random key (≥ 32 base64url chars) and sends it in `hello`; the server stores only its SHA-256. `create: true` registers unknown keys (max `accountsPerIpPerHour` per IP; behind Cloudflare set `GATEWAY_TRUST_PROXY=true`).
- Orders, wallets, executor and trade queue are per account; accounts trade in parallel, one trade at a time each. Cap: `MAX_ACTIVE_ORDERS_PER_USER` (default 25).
- **Legacy owner:** orders from before accounts belong to account id `legacy`, whose key is the old pairing code (`data/pairing-token.txt`) and whose wallets were seeded from `FOMO_WALLET` / `FOMO_EVM_WALLET` on first start.

## Paywall (`src/core/billing/`, `src/billing-setup.ts`)
- Off unless `PAYWALL_ENABLED=true` (needs `PAY_SOLANA_TREASURY`, `PAY_EVM_TREASURY`). `FREE_ORDERS` (3) free: only fills use one up; each waiting order holds one (so the trial never fills more than 3). Then **monthly**: each `UNLOCK_PRICE_USD` (50) of credit adds `ACCESS_PERIOD_DAYS` (30) after the later of now and the current paid-up date (`paid_access` table; settled on each payment and at startup). Lapsed accounts get no new free orders; their waiting orders still run. `unlocks` = permanent grants (the owner, `legacy`, at start).
- Accepted: official USDC on Solana/Ethereum/Base/BNB (18 dec)/Arc, USDG on Robinhood (it has no real USDC; look-alike "USDC" tokens there are ignored) — exact addresses in `payment-assets.ts`. Arc logs one USDC transfer twice (0x3600… 6 dec + system 0xff…fe 18 dec); payment id `<chain>:<tx>:<sender>` credits it once.
- Platform token later: `PAY_TOKEN=<key>`; priced live via the feeds; `UNLOCK_TOKEN_PRICE_USD` (35) of token counts as the full price (credit × 50/35); price locked in the quote for 24 h.
- Matching: sender = an account's fomo wallet → that account; else the payment code in the last digits (USDC: 50.00xxxx, token: N.xxxx); else unmatched (review `payments WHERE user_id IS NULL`). Credits add up; a period is bought at 98% of the price. Every full price then buys a period (multiples buy several); anything beyond whole periods is a tip (not carried, not shown). Exchange withdrawals (exchange's wallet, fee-reduced amount) are unmatched until the user claims them with `billing.claim{tx}` (tx id or explorer link; only unassigned payments, compare-and-set). Payments are final/non-refundable.
- Watchers poll every 15 s from stored cursors (EVM: Transfer logs to the treasury in 2k-block chunks, 2 confirmations; Solana: treasury token-account signatures newer than a stored **slot** → parsed balance changes; a signature cursor broke once the RPC pruned that transaction — "Transaction … not found" every poll). Verified live on Base and Solana. `BillingService.receive` returns `{recorded, userId}`; re-read payments (`recorded: false`) are not re-announced.

## Monitoring (`src/core/monitoring/`)
- Every account (`LM-XXXXXX` short id, shown as `LM-XXXXXX (@fomoname)` once the extension has read the fomo username — `accounts.fomo_username`, v1.3.0), order placement/outcome, payment, claim, subscription change, server start and error (≤ 1 per source per 5 min) is written to the `activity` table (permanent log) and relayed to Telegram by `ActivityRelay` (batched, marks sent, backs off, honours 429 `retry_after`). Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`; without them it only logs to the DB.
- Account deletion cancels open orders but keeps order history.
- RPC socket drops (Solana `rpc`, EVM `rpc:<chain>`) are not sent as errors: adapters report down/up to `OutageTracker` (`ConnectionHealth` port), which alerts only after 2 min down and then posts the recovery. Empty-update glitches are console-only.
- Console errors go through `ErrorLog`: the first of each context+message is dumped in full, repeats within 60 s log one line (a dropped RPC socket fails every subscription at once).

## Gateway protocol (JSON over WS)
Client: `hello{token,executor,create?}`, `order.create{reqId,order}`, `order.cancel{reqId,id}`, `order.list{reqId}`, `token.info{reqId,mint}`, `price.watch{reqId,mint}` (viewer interest, 5 min TTL; newest `viewedTokens` per connection), `wallet.holds{reqId,mint}` → `{holds: boolean|null}`, `wallets.set{reqId,wallets:{solana,evm}}`, `profile.set{reqId,fomoUsername}`, `account.info{reqId}`, `account.delete{reqId}`, `billing.status{reqId}`, `billing.quote{reqId}`, `billing.claim{reqId,tx}`, `exec.result{execId,result}`, `pong`.
Server: `welcome{account,orders,ticks,billing}`, `billing{status}` (on change), `reply{reqId,ok,data|error}`, `order{order}` (owner only), `tick{tick}` (≤4/s per mint, only to clients viewing it or with orders on it), `exec.request{execId,order}` (owner's executor), `ping`, `error`.
Close codes: 4001 bad/unknown key or account limit, 4003 account deleted, 4008 too many messages. Only `chrome-extension://` origins or non-browser clients.

## Load testing
- Separate server: `data/loadtest/.env` = `.env` minus Telegram/paywall, plus `GATEWAY_PORT=8799`, `DATA_DIR=data/loadtest`, `PAYWALL_ENABLED=false`. Start `npx tsx --env-file=data/loadtest/.env src/index.ts`, then `npx tsx scripts/load-test.ts ws://127.0.0.1:8799 data/loadtest <users> <ordersPerUser>` (`SKIP_LIMITS=1` for load only). Wipe `data/loadtest/orders.db*` between runs.
- 2026-09-27 result (Windows dev box, 3 live tokens, everyone placing at the same instant): 2,000 users / 10,000 orders all OK, ~330 orders/s, list p50 100 ms, server RSS ~155 MB. All limit checks pass.
- Hot paths must never load all orders: per-tick evaluation reads only open orders on that mint (`idx_orders_mint_status`), a new order is checked alone, and the holdings guard queries open sells per (account, mint).
- 2026-09-27 fuzz: 2,318/2,318 checks. Non-token addresses give readable errors: Solana `getMintSupply` maps RPC invalid-params to `AccountNotFoundError`; EVM `readContract` treats empty `0x` results as "No contract"; empty (SOL-dusted) accounts at pump/LaunchLab PDAs count as absent.
- Every socket has an `error` listener (a frame over 64 KB used to crash the server) and must log in within 10 s.

## Remote access (until the VPS)
- Quick tunnel: `data/bin/cloudflared.exe tunnel --no-autoupdate --url http://127.0.0.1:8787` (official signed binary, log in `data/tunnel.log`); random `https://*.trycloudflare.com` that changes on every restart. Build the remote extension with `WXT_SERVER_URL=wss://<that host> npm run zip`. `GATEWAY_TRUST_PROXY=true` so per-IP limits see CF-Connecting-IP. Measured ~100 ms round trip vs 1 ms local.
- Several devices on one account: trades go to the executor that connected last; if it disconnects, the most recent other connected device takes over.

## Notes
- `.env` (RPC URLs) and `data/` (DB + pairing token) are git-ignored.
- Pool prices emit only when both vaults are at the same slot (avoids half-updated spikes).
- On-chain (sub-second): pump.fun curve/PumpSwap, Raydium LaunchLab (constant-product curves, SOL/USD1 quote), Raydium CPMM (any quote with a USD price), Meteora DBC (fomo launchpad; live pools use a newer discriminator than the published IDL — both accepted). Everything else: Jupiter every 1.5s.
- A feed that can't price a token throws `UnsupportedPoolError` and the next feed is tried; other errors are rethrown.
- LaunchLab and CPMM share the "PoolState" discriminator — LaunchLab pools are found by PDA, CPMM pools via DexScreener + layout check.
- Optional env: `FOMO_WALLET` / `FOMO_EVM_WALLET` (legacy owner's wallets, first start only), `JUPITER_API_KEY`, `JUPITER_POLL_MS`, `GATEWAY_TRUST_PROXY`, `MAX_ACTIVE_ORDERS_PER_USER`.
- EVM env (each chain needs both): `ETH_RPC_HTTP/WSS`, `BASE_…`, `BNB_…`, `ROBINHOOD_…`, `ARC_…`; `FOMO_EVM_WALLET` (same address on every EVM chain) enables EVM confirmation, sell checks and auto-cancel.
- EVM pools are found via DexScreener `token-pairs/v1` (its `tokens/v1` returns only a token's main pair). Listings whose contract reverts are skipped.
- v4 orientation: the other currency may be native (0x0, 18 decimals) even when DexScreener lists the wrapped token; both readings are priced and the one matching DexScreener's `priceNative` wins.
- Arc's native gas token is USDC (0x3600… ERC-20, 6 decimals). Chainstack caps eth_getLogs at 10k blocks.
- Holdings guard: open sells are cancelled when the account's wallet reads a zero balance twice in a row (second read ~5 s later); no "seen held" state, so it works right after restarts.
