# TASK 3 — EVM chains

Author: Reborn1987

## Scope
Limit / take-profit / stop-loss orders for fomo's EVM tokens on Ethereum, Base, BNB, Robinhood Chain and Arc
(Monad later — no RPC yet). Requested 2026-09-26.

1. Token keys: Solana stays `<mint>`; EVM is `<chain>:<0xaddress>` with fomo's URL slugs (`ethereum`, `base`, `bnb`, `robinhood`, `arc`).
2. `EvmRpcPort` + adapter (HTTP calls, WebSocket log subscriptions) per chain.
3. Live on-chain prices: Uniswap v2 / PancakeSwap v2 (Sync), Uniswap v3 / PancakeSwap v3 and Uniswap v4 (Swap events carry sqrtPriceX96).
4. Launchpad bonding curves (tokens not on a DEX yet): four.meme and flap.sh.
5. Quote tokens → USD on-chain (stables = $1, others chained through their own pools); DexScreener fallback.
6. Router feed / confirmer: dispatch by chain. On-chain trade confirmation + holdings guard via ERC-20 `balanceOf` of `FOMO_EVM_WALLET`.
7. Extension: accept `/tokens/<chain>/<address>` pages everywhere it accepts Solana ones.

## Done when
- Tests pass with >= 80% coverage. ✅ (158 backend tests, 96% statements; 82 extension tests)
- Live price/MC for a sample token per chain matches fomo. ✅ (8 tokens on all 5 chains, incl. a four.meme and a flap curve, match DexScreener)
- A user-triggered live trade on an EVM token fills and is confirmed on-chain. ⏳
