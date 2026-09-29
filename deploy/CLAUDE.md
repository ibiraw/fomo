# deploy/

Hosting for the shared limit server and the website. Full steps: `documentation/DEPLOY.md`.
Live on a DigitalOcean droplet (user `deploy`, folder `~/limit/deploy`), reached only through the Cloudflare Tunnel.

| File | Purpose |
|------|---------|
| `docker-compose.yml` | `server` (built from `backend/Dockerfile`, data in `./data`) + `web` (nginx, static site in `./site`) + `tunnel` (Cloudflare Tunnel; no published ports) |
| `nginx.conf` | Website routing (`/policies` → `policies.html`), asset caching, security headers; `/limit.zip` requests are logged to `./logs/downloads.log` (time, method, status, bytes, Cloudflare country — no IPs), which the server reads (`DOWNLOAD_LOG`) to tell the owner about each download ("from Toronto, Ontario, CA"). Region and city need Cloudflare's Managed Transform "Add visitor location headers" (owner's dashboard; without it they log as `-` and only the country shows). Lines are `|`-separated. Check the download with `curl -r 0-0` (206) or `curl -I` (HEAD): neither is counted |
| `server.env.example` | RPC URLs etc. → copy to `server.env` (git-ignored) |
| `.env.example` | `TUNNEL_TOKEN` → copy to `.env` (git-ignored) |
| `backup.sh` | Daily consistent SQLite backup of `data/orders.db` (keeps 14 days) plus `access.json`; also prunes Docker build cache older than 3 days |
