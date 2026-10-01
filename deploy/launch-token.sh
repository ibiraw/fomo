#!/usr/bin/env bash
# @file launch-token.sh
# @description One-shot $LIMIT launch: checks the CA on-chain, then puts it everywhere.
#   bash deploy/launch-token.sh <CA> --check   only the on-chain checks (mint exists, decimals, can limit price it)
#   bash deploy/launch-token.sh <CA>           checks, then: website CA (hero strip + pricing box) → deploy site,
#                                              server PAY_TOKEN/PAY_TOKEN_SYMBOL/UNLOCK_TOKEN_PRICE_USD → restart,
#                                              X post image (motion design/limit-video/x-posts/out/live-ca-final.png)
#   Run from the repo root (fomo/). Needs ~/.ssh/limit_vps and backend/.env (RPC URLs) on this PC.
# @author Reborn1987
set -euo pipefail

CA="${1:?usage: launch-token.sh <CA> [--check]}"
MODE="${2:-}"
VPS="deploy@161.35.15.165"
KEY="$HOME/.ssh/limit_vps"
ROOT="$(pwd)"
POSTS="$ROOT/../motion design/limit-video/x-posts"
PRICE_USD=30

[[ "$CA" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || { echo "✖ '$CA' is not a Solana address (base58, 32-44 chars)"; exit 1; }

echo "== 1. on-chain checks =="
cd "$ROOT/backend"
npx tsx --env-file=.env scripts/check-mint.mts "$CA"
echo "-- pricing (20 s): limit must stream a price for token payments --"
timeout 25 npm run --silent watch-price -- "$CA" 20 2>&1 | tail -5 || echo "⚠ no price stream yet: token payments will wait and retry every 30 s (the server keeps running)"
[[ "$MODE" == "--check" ]] && { echo "== check only: nothing changed =="; exit 0; }

echo "== 2. website =="
cd "$ROOT/frontend/website"
sed -i "s|^  ca: '[^']*',|  ca: '$CA',|" lib/token.ts
grep -q "ca: '$CA'" lib/token.ts || { echo "✖ could not set the CA in lib/token.ts"; exit 1; }
npx tsc --noEmit
NEXT_PUBLIC_SITE_URL=https://limit.family npm run build >/dev/null
cp "$(ls -t ../extension/.output/limit-*-chrome.zip | head -1)" out/limit.zip
grep -q "$CA" out/index.html || { echo "✖ CA missing from the built page"; exit 1; }
tar czf /tmp/site.tgz -C out . && scp -q -i "$KEY" /tmp/site.tgz "$VPS:~/site.tgz"
ssh -i "$KEY" "$VPS" "tar -xzf ~/site.tgz -C ~/limit/deploy/site && rm ~/site.tgz" && rm /tmp/site.tgz
echo "✔ site deployed"

echo "== 3. server: pay in \$LIMIT ($PRICE_USD USD / 30 days) =="
ssh -i "$KEY" "$VPS" "cd ~/limit/deploy && cp server.env server.env.bak-\$(date +%s) \
  && sed -i '/^PAY_TOKEN=/d;/^PAY_TOKEN_SYMBOL=/d;/^UNLOCK_TOKEN_PRICE_USD=/d' server.env \
  && printf 'PAY_TOKEN=%s\nPAY_TOKEN_SYMBOL=LIMIT\nUNLOCK_TOKEN_PRICE_USD=$PRICE_USD\n' '$CA' >> server.env \
  && n=\$(docker compose exec -T server node -e \"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/orders.db',{readOnly:true});console.log(db.prepare(\\\"select count(*) n from orders where status in ('executing','triggered')\\\").get().n)\" 2>/dev/null | tail -1) \
  && for i in 1 2 3 4 5 6; do [ \"\$n\" = 0 ] && break; sleep 10; n=\$(docker compose exec -T server node -e \"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/orders.db',{readOnly:true});console.log(db.prepare(\\\"select count(*) n from orders where status in ('executing','triggered')\\\").get().n)\" 2>/dev/null | tail -1); done \
  && docker compose up -d --force-recreate server >/dev/null 2>&1 && sleep 20 && docker compose logs server --since 1m 2>&1 | grep -E 'paywall on|pay token|limit server on|pay:token' | cut -c1-160"
echo "✔ server restarted"

echo "== 4. X post =="
cd "$POSTS"
sed "s/__CA__/$CA/" live-ca.html > live-ca-final.html
python render-update.py live-ca-final >/dev/null && echo "✔ $POSTS/out/live-ca-final.png"

echo "== done: commit with  git add frontend/website/lib/token.ts && git commit -m 'feat: \$LIMIT is live' && git push =="
