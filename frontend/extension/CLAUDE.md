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
| `lib/themes.ts`, `hooks/use-theme.ts`, `components/ThemePicker.tsx` | User themes: override fomo's `--color-*` vars (page) + extension tokens (inline on popup root / shadow host). fomo prints white text on `action`, so `action` must keep >= 3:1 contrast with white (tested) |
| `lib/fomo-dom-config.ts` | **fomo page-layout facts as data** (labels, selectors, classes, failure words): built-in `DEFAULT_FOMO_DOM`, overridable live from the server (`fomoDom` → `storage.local.fomoDom` → content scripts via `followFomoDom`). A fomo redesign: edit the server's `data/fomo-dom.json` (see backend/CLAUDE.md), then update the built-ins in the next release |
| `lib/fomo-dom.ts` | Logic that finds/reads fomo's trade panel using those facts |
| `lib/fomo-health.ts`, `lib/fomo-health-watch.ts` | fomo self-check in every fomo tab: new-version prompt, layout check on token pages (logged in, after the page settles, confirmed before reporting), digit-masked layout snapshot → background → server `layout.status`. Background reloads fomo only in limit's own trade tab. Trade misses caused by the layout return kind `layout` (nothing clicked) and pause instead of failing |
| `lib/trade.ts` | Trade steps: tab → amount → wait quote → submit → confirm by balance drop / failure notice |
| `lib/fomo-tab.ts` | Find/open/navigate the FOMO tab, send trade to content script. The background tab it opens is closed after the trade (kept only when the outcome is unknown); the user's own tabs are never navigated or closed |
| `lib/token-key.ts` | Token keys shared with the server: Solana mint or `<chain>:<0xaddress>` (ethereum, base, bnb, robinhood, arc). Maps keys ↔ fomo paths `/tokens/<chain>/<address>`. Mirror of backend `core/chains/token-key.ts` |
| `lib/sound-packs.ts`, `lib/sounds.ts`, `entrypoints/offscreen/`, `components/OrderSounds.tsx` | Order sounds, 6 themes (Arcade, Chime, Cash register, Soft pop, Degen, Sonar; synthesized with Web Audio, per-pack loudness trim): buy filled / take profit / stop loss / failed. The service worker can't play audio, so it opens a hidden offscreen page (`offscreen` permission) and messages it. On/off, theme and volume in popup Settings (`orderSounds` in storage.local); picking a theme plays a sample, blocked audio shows an error |
| `lib/account.ts`, `components/AccountSection.tsx` | Anonymous account: key made on install (also the backup code; `hello{create:true}`), wallets read silently from fomo.family localStorage (`privy:connections`, `ph_*_posthog` person properties) by the content script and sent with `wallets.set`; the fomo username from the user's own top-bar profile link (`readOwnFomoUsername`, `ul li button a[href^="/profile/"]`) and fomo's unique user id (`readFomoUserId`: posthog `$stored_person_properties.privyId`, "did:privy:…") sent with `profile.set`; the username shows in Settings → Account; Settings → Account shows wallets (editable), backup code (show/copy/restore) and delete. Build with `WXT_SERVER_URL=wss://…` for the hosted server (hides the server-address field) |
| `lib/billing.ts`, `components/UnlockSection.tsx` | Paywall UI: Settings → Unlock (free orders left, progress, pay per chain with copyable address + exact amount, token option once launched) and a banner on the order forms. Hidden when the server has no paywall |
| `lib/server-connection.ts` | WS client: hello, reconnect w/ backoff, request/reply, exec relay |
| `lib/number-input.ts` | Cleans typed/pasted numbers for the order fields (FieldBox, presets, % box): rejects bad keystrokes, expands `$2.5M` / `1,500` / `1e6` (a suffix is never silently dropped), plus the amount limits ($ minimum, max 100%) |
| `lib/format.ts`, `lib/types.ts`, `lib/messages.ts` | Display helpers, shared types (mirror backend), popup⇄background messages |
| `components/ui/` | shadcn components |
| `tests/` | vitest (+ happy-dom); `tests/fake-fomo.ts` simulates FOMO's trade panel; component tests render with plain `react-dom/client` + `act` (no testing library), e.g. `tests/order-inputs.test.ts` |

## Store (Chrome Web Store, unlisted)
- `store/LISTING.md` — listing text, permission justifications, privacy answers, screenshot list.
- Logo: the moon (white crescent on #09090b, dashed orbit ring in fomo's Buy-button blue #516af6); wordmark "limit" with blue dots on the i's (`.wm-i` = dotless ı + dot).
- `store/assets/` — store icon + promo tile (`node scripts/store-assets.mjs`); X profile picture `pfp.svg` → `limit-pfp-1000.png` (full-bleed, mark at 86% so the round crop keeps the ring); X banner `x-banner-1500x500.png` (`npx tsx scripts/x-banner.tsx <out>` in frontend/website, Figtree via Google Fonts); toolbar icons from `assets/icon.svg` (`node scripts/icons.mjs`). `assets/icon-small.svg` is the 16px variant (solid, thicker ring).
- `npm run zip` → `.output/limit-<version>-chrome.zip`. Privacy policy: website `/privacy`.

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
