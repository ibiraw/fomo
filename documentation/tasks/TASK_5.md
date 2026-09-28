# TASK 5 — Staged releases, friends, and new token insights

Author: Reborn1987 · Started 2026-09-28

## Goal
The public gets limit in versions, as if it is being built live; friends get everything early by their limit ID.

| Version | Adds | State |
|---|---|---|
| 1.0 | Limit, breakout, take profit, stop loss on every chain | Public 2026-09-28 |
| 1.2 | Themes + order sounds | Built, hidden |
| 1.7 | The token's latest X post | Built, hidden |
| 1.8 | Which launchpad a token came from | To build |
| 1.9 | Dev holdings / dev sold, top 10 holders' share | To build |

## How it works
- Server: `DATA_DIR/access.json` = `{"publicVersion":"1.0","earlyAccess":["LM-XXXXXX"],"freeUntil":{"LM-XXXXXX":"2026-11-01"}}`,
  re-read every 3 s (`FileAccessConfigAdapter`), validated (`core/releases/releases.ts`). Each login gets
  `release{version,features,early}`; edits are pushed live (`release` + `billing`). The owner (`legacy`) is always early.
- Friends pay like everyone unless listed in `freeUntil` (free through the end of that day, UTC; paying during it adds
  30 days after it ends; it never counts as a payment).
- Extension: stores the release (`storage.local.release`); hides theme picker, sounds, X post card; themes and sounds
  don't apply and X isn't read until the release has them. Defaults to v1.0 until the server says otherwise.
- Website: `frontend/website/lib/releases.ts` `SITE_VERSION` gates sections; "What's new" lists released versions.

## Release a version (e.g. 1.2)
1. VPS: set `"publicVersion": "1.2"` in `~/limit/deploy/data/access.json` (live within seconds, no restart).
2. Website: `SITE_VERSION = '1.2'` + a CHANGELOG entry dated that day, rebuild, ship with `out/limit.zip`.

## Add a friend
Their limit ID (popup → Settings → Account, `LM-XXXXXX`) → add to `earlyAccess` (and `freeUntil` if free).

## Steps
- [x] Server: releases, access file, billing free periods, gateway `release` — tests
- [x] Extension: release storage + gating — tests
- [x] Website: v1.0 only + What's new; zip never cached by Cloudflare
- [ ] v1.8 launchpad (early access only)
- [ ] v1.9 token metrics (early access only)
