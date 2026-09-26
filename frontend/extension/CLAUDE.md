# frontend/extension/

Chrome MV3 extension built with WXT. Connects to the local backend (ws://127.0.0.1:8787) as the trade executor.

## Layout
| Path | Purpose |
|------|---------|
| `entrypoints/background.ts` | Service worker: server connection, popup state, runs trades in the FOMO tab, keepalive alarm |
| `entrypoints/fomo.content.ts` | Content script on fomo.family: `fomo.ping`, `fomo.trade` |
| `entrypoints/fomo-panel.content/` | Injects the native-looking **Limit** tab next to Buy/Sell and mounts `components/panel/LimitView` (shadow root) |
| `lib/fomo-inject.ts` | Limit tab + show/hide CSS (visibility is on our wrapper `[data-fomo-limit-view]`, since `:host !important` beats page CSS) |
| `entrypoints/popup/` | React popup (`App.tsx`) |
| `components/orders/` | Shared UI: PairingForm, NewOrderForm, OrderList, Segmented (no dropdowns: portals escape the shadow root) |
| `hooks/use-background.ts` | Popup/panel ⇄ background port |
| `assets/theme.css` | Shared theme (vars on `:root, :host`) |
| `lib/fomo-dom.ts` | **All FOMO page-structure knowledge** (selectors, balance reading). Update here if FOMO redesigns |
| `lib/trade.ts` | Trade steps: tab → amount → wait quote → submit → confirm by balance drop / failure notice |
| `lib/fomo-tab.ts` | Find/open/navigate the FOMO tab, send trade to content script |
| `lib/server-connection.ts` | WS client: hello, reconnect w/ backoff, request/reply, exec relay |
| `lib/format.ts`, `lib/types.ts`, `lib/messages.ts` | Display helpers, shared types (mirror backend), popup⇄background messages |
| `components/ui/` | shadcn components |
| `tests/` | vitest (+ happy-dom); `tests/fake-fomo.ts` simulates FOMO's trade panel |

## Commands
- `npm run build` → load `.output/chrome-mv3` via chrome://extensions → Load unpacked
- `npm run dev` — WXT dev mode
- `npx vitest run --coverage` (80% threshold), `npx tsc --noEmit`

## FOMO page facts (observed 2026-09-26)
- Panel = smallest ancestor of the "Buy" tab containing `input[placeholder="0"]`.
- Inactive tab has class `bg-bg-secondary`.
- Balance = first "$x" element after the `$100` (buy) / `100%` (sell) preset.
- Sell % presets only fill the amount ("Fetching quote..."), they don't submit.
- Submit button (`py-2 text-center`) reads "Buy <sym>"/"Sell <sym>" when ready; "Minimum amount $2" / "Fetching quote..." otherwise.
- Notifications: `div.bg-bg-primary.rounded-xl.outline` — "Buying $3.00 X", "Selling 1.2M X". Failure text not yet observed.
- Positions under $2 cannot be sold ("Position is worth $1.88; the $2.00 minimum applies.").
