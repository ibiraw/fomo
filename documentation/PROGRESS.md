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
| 3 | Order store + engine + extension gateway (WebSocket) | Todo |
| 4 | Extension trade executor (content script) | Todo |
| 5 | Extension popup UI | Todo |
| 6 | Live test (user triggers real trades) | Todo |
| 7 | Telegram bot | Todo |
| 8 | Showcase website demonstrating the tech | Todo (requested 2026-09-26) |
