# Chrome Web Store listing — auto fomo

Author: Reborn1987

Everything to paste into the Chrome Web Store developer dashboard. Visibility: **Unlisted** (only people with the link can install).

## Package
- Upload: `frontend/extension/.output/auto-fomo-<version>-chrome.zip` (build with `npm run zip`).
- Before zipping a store build, set the hosted server URL (see `documentation/DEPLOY.md`).

## Store listing tab
**Name:** auto fomo *(final name not decided — change here, in `wxt.config.ts`, the popup title and the website)*

**Summary** (max 132 characters):
> Limit, take-profit and stop-loss orders for fomo.family. Set a market-cap target; auto fomo clicks Buy or Sell when it hits.

**Description:**
> auto fomo adds the orders fomo.family doesn't have: limit buys, breakout buys, take profits and stop losses — on Solana, Ethereum, Base, BNB Chain, Robinhood Chain and Arc.
>
> How it works
> • A Limit tab appears next to fomo's Buy and Sell buttons.
> • Drag to a market-cap or price target, choose an amount in dollars or a percentage of your position, and place the order.
> • auto fomo watches the price live on-chain. When your target is hit, it clicks fomo's own Buy or Sell button in a background tab — the same thing you would do by hand — and confirms the trade on-chain.
>
> What it never does
> • It never asks for your private keys, seed phrase or fomo password. Trades happen through your own logged-in fomo session.
> • It never navigates or closes the tabs you're using.
>
> Also included
> • See every open order for the token you're viewing, with one-click cancel.
> • Sell orders cancel themselves once you've sold out of a token.
> • Latest post from the token's X account, with its age at a glance.
> • Themes that recolor fomo and the Limit panel.
> • Optional sounds when an order fills or fails.
>
> Keep Chrome open with fomo.family logged in for orders to run.
>
> auto fomo is an independent, unofficial tool. It is not affiliated with, endorsed by or connected to fomo.family or Fomo Labs. Nothing here is financial advice; automated orders can fail or fill at unexpected prices. Use at your own risk.

**Category:** Tools  **Language:** English

**Graphic assets** (in `store/assets/`):
- Store icon 128×128 — `store-icon-128.png` (96×96 artwork + 16px transparent padding)
- Screenshots 1280×800 — `screenshot-1.png` … (see Screenshots below)
- Small promo tile 440×280 — `promo-440x280.png`

## Privacy practices tab
**Single purpose:**
> Place automated limit, take-profit and stop-loss orders on fomo.family by clicking fomo's own trade buttons in the user's logged-in session when a price target is reached.

**Permission justifications:**
| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings (theme, sounds, default tab) and their anonymous account key on their own computer. |
| `tabs` | Finds the user's fomo.family tab for an order's token, or opens a background tab for it when none is open, and closes that background tab after the trade. Also opens the token's X page in a background tab when the user asks for its latest post. |
| `scripting` | Adds the trade helper to fomo.family tabs that were already open before the extension was installed or updated, so orders can run without the user reloading fomo. |
| `alarms` | Wakes the extension every 30 seconds to keep its connection to the order server alive, so orders still trigger when the popup is closed. |
| `offscreen` | Plays the optional order sounds (fill / take profit / stop loss / failed). Extension service workers cannot play audio themselves. |
| Host: `https://fomo.family/*` | Adds the Limit tab to fomo's trade panel, reads the market cap and the user's balance shown on the page, clicks fomo's Buy/Sell buttons when an order triggers, and reads the user's public wallet addresses from their logged-in session. |
| Host: `https://x.com/*` | Reads the latest post of a token's X account (with the user's own X session) when the user opens it in the Limit panel. |

**Remote code:** No, I am not using remote code. *(All code ships in the package; the server only sends data such as prices and trade requests.)*

**Data usage — collected:**
- ☑ Financial and payment information — public wallet addresses and the user's orders (token, target, amount).
- ☑ Website content — market cap and balance read from fomo.family to place and confirm orders.
- ☐ Everything else (personally identifiable info, health, authentication info, personal communications, location, web history, user activity) — not collected.

**Certifications (all three checked):** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** `https://<site domain>/privacy` *(the page exists at `frontend/website/app/privacy`; goes live when the site is deployed)*

## Account tab (developer dashboard)
- Use a new Google account and a separate contact email for this (keeps it anonymous).
- $5 one-time registration fee; 2-step verification required.
- Trader declaration: **non-trader** (not selling it commercially yet) — owner is in Canada.
- Contact email is shown on the listing.

## Screenshots to capture (1280×800)
1. The Limit tab on a fomo token page with the market-cap slider and a take-profit order.
2. The order list on a token (open, filled and cancelled orders).
3. The popup's New order form.
4. Themes: fomo recolored.
5. Settings: sound themes.
Capture with a demo account (no real balances visible).
