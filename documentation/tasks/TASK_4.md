# TASK 4 — Chrome Web Store (unlisted) + one hosted server

Author: Reborn1987

## Decisions (2026-09-26)
- One shared server on a cheap VPS (Docker), Cloudflare in front (hides the server IP, provides TLS).
- Accounts are automatic: the extension creates a random secret on install; a backup code in Settings restores it.
- Wallet addresses are read silently from the user's logged-in fomo page — never by opening the deposit screen in front of them.
- Name stays "auto fomo" for now (final name undecided). Listing starts **Unlisted**.
- Owner is in Canada; no domain yet (buy one on the anonymous Cloudflare account when the name is settled).

## Where fomo keeps the wallet addresses (verified 2026-09-26, read-only)
| Source (fomo.family localStorage) | Holds | Notes |
|---|---|---|
| `privy:connections` | EVM address (`address`, `connectorType`, `walletClientType`) | Privy's login store — the most stable source for EVM |
| `ph_…_posthog` → `$stored_person_properties.solanaAddress` / `.evmAddress` | Solana + EVM | fomo's own labels, but analytics storage: ad-blockers can remove it |
Fallback: read the deposit screen in the extension's hidden background tab; last resort: paste in Settings.

## Status
- Phase 1 ✅ (listing, icons, promo tile, privacy page, zip). Screenshots still to capture (after phase 3 UI).
- Phase 3 ✅ extension: automatic account + backup code/restore/delete, silent wallet detection, hosted URL via `WXT_SERVER_URL` — 95 extension tests.
- Phase 2 ✅ multi-user server — 175 backend tests, 96.7% coverage. Live migration: 43 existing orders → `legacy` account, owner's extension logs in with the old pairing code.

## Phases
1. **Store package** — "auto fomo" name/version, real icons, privacy policy page on the website, listing copy + permission
   justifications, screenshots (1280×800), `npm run zip`.
2. **Multi-user server** — accounts (hashed secret), per-user orders/wallets/executor connection, wallet sync from the
   extension, per-user limits (open orders, request rate), shared price feeds; tests.
3. **Extension for the hosted server** — default server URL from build config, automatic account + backup/restore code,
   silent wallet detection, pairing screen removed for store builds.
4. **Deploy** — Dockerfile + compose, Cloudflare Tunnel, `documentation/DEPLOY.md` (VPS, domain, secrets, backups).

## Done when
- Unlisted listing submitted with all assets; extension works against the hosted server for two separate test accounts.
