# FOMO Limit Orders — Build Progress

Author: Reborn1987

## Goal
Limit / take-profit / stop-loss orders for fomo.family (Solana first).
A Chrome extension clicks Buy/Sell in the user's logged-in FOMO tab. No private keys.

## Architecture
| Part | Path | Role |
|------|------|------|
| Price + order server | `backend/` | Node 22 + TypeScript. Live prices from Chainstack RPC, stores orders (SQLite), decides when orders trigger |
| Chrome extension | `frontend/` | MV3. Popup to manage orders; executes trades by clicking in the FOMO tab |
| Telegram bot | later | Talks to the same server |

## Key facts (verified 2026-09-26)
- FOMO has no public API; trades have no confirmation prompt.
- Token page URL: `fomo.family/tokens/solana/<mint>`.
- Buy panel: $ input, $25/$50/$75/$100, Max. Sell panel: $ input, 10/25/50/100%.
- Minimum trade: $2. Trades can fail on slippage.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 1 | Repo skeleton + docs | Done |
| 2 | Price feed: pump.fun curve, PumpSwap pool, Pyth SOL/USD | Done — 22 tests, 100% lines; live MC matches FOMO |
| 3 | Order store + engine + extension gateway (WebSocket) | Done — 53 tests, 99% lines; server boots live |
| 4 | Extension trade executor (content script) | Done — 37 tests; selectors verified on live FOMO |
| 5 | Extension popup UI | Done — builds; awaiting first live load |
| 6 | Live test (user triggers real trades) | Done — $3 buy (filled; UI confirm missed it → added on-chain confirmation) and 100% sell (filled in 2.0s) |
| 7 | Telegram bot | Todo |
| 8 | Showcase website demonstrating the tech | Todo (requested 2026-09-26) |
| 9 | Latest tweet for a token (time + optional preview) | Done — X link from on-chain metadata; latest post read via user's x.com session (minimized window); age colored green→red |
| 10 | On-page Limit tab + FOMO-style form (presets, MC slider, inferred order type) | Done — verified live |
