# Deploying the shared limit server

Author: Reborn1987

One small VPS runs the server in Docker. Cloudflare sits in front through a **tunnel**: the VPS opens no ports and its IP
never appears in DNS. Users' extensions connect to `wss://api.<your-domain>`.

Keep it anonymous: use the same new email / Cloudflare account as the website, and never link the `ibiraw` GitHub.

## 1. Accounts to create (you)
| What | Where | Cost |
|---|---|---|
| Domain | Cloudflare dashboard → Domain Registration (buy it once the name is decided) | ~$10/yr |
| VPS | e.g. Hetzner Cloud **CX22** (2 vCPU, 4 GB, Ubuntu 24.04) or DigitalOcean $6 droplet | ~$5/mo |
| Tunnel | Cloudflare → Zero Trust → Networks → Tunnels (free) | $0 |

## 2. Prepare the VPS
SSH in as root, then:
```sh
adduser --disabled-password deploy && usermod -aG sudo deploy
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
ufw default deny incoming && ufw allow OpenSSH && ufw enable   # the tunnel needs no inbound ports
```

## 3. Copy the code (no GitHub link)
From your PC, in the repo folder:
```sh
tar czf limit.tgz --exclude=node_modules --exclude=data --exclude=.env backend deploy
scp limit.tgz deploy@<vps-ip>:~
```
On the VPS: `mkdir -p ~/limit && tar xzf ~/limit.tgz -C ~/limit`

## 4. Configure
```sh
cd ~/limit/deploy
cp server.env.example server.env   # paste the RPC URLs (same as backend/.env on your PC)
cp .env.example .env               # paste TUNNEL_TOKEN
chmod 600 server.env .env
```

## 5. Create the tunnel (Cloudflare)
1. Zero Trust → Networks → Tunnels → **Create a tunnel** → *Cloudflared* → name it `limit`.
2. Choose *Docker* and copy only the token (the long string after `--token`) into `deploy/.env`.
3. **Public hostname**: subdomain `api`, your domain, service `HTTP` → `server:8787`.
4. WebSockets are on by default for tunnels.

## 6. Start
```sh
cd ~/limit/deploy && docker compose up -d --build
docker compose logs --tail 50 server    # expect: "limit server on ws://0.0.0.0:8787 (behind Cloudflare)"
```

## 7. Build the store extension for this server
On your PC:
```sh
cd frontend/extension
WXT_SERVER_URL=wss://api.<your-domain> npm run zip    # PowerShell: $env:WXT_SERVER_URL="wss://api.<your-domain>"; npm run zip
```
Upload `.output/limit-<version>-chrome.zip` (see `frontend/extension/store/LISTING.md`).

## Operating it
- **Update:** re-copy the code (step 3), then `docker compose up -d --build`.
- **Backups:** the whole state is `deploy/data/orders.db` (+ `-wal`/`-shm`). Daily copy, e.g. crontab
  `0 4 * * * cd ~/limit/deploy && tar czf ~/backup-$(date +\%a).tgz data`.
- **Logs** rotate automatically (3 × 10 MB). Order lines show only short account ids, never keys.
- **Limits** (defaults): 25 open orders per account, 20 messages/s per connection, 8 viewed tokens per connection,
  5 new accounts per IP per hour. Change `MAX_ACTIVE_ORDERS_PER_USER` in `server.env`.
- **RPC usage** grows with the number of watched tokens, not users. Watch your Chainstack dashboard as users join.
- **Your own account:** the hosted server starts empty. Your extension makes a new account on it; your local server
  (with your old orders) is separate.
