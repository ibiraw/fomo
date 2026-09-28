# deploy/

Hosting for the shared limit server and the website. Full steps: `documentation/DEPLOY.md`.
Live on a DigitalOcean droplet (user `deploy`, folder `~/limit/deploy`), reached only through the Cloudflare Tunnel.

| File | Purpose |
|------|---------|
| `docker-compose.yml` | `server` (built from `backend/Dockerfile`, data in `./data`) + `web` (nginx, static site in `./site`) + `tunnel` (Cloudflare Tunnel; no published ports) |
| `nginx.conf` | Website routing (`/policies` → `policies.html`), asset caching, security headers |
| `server.env.example` | RPC URLs etc. → copy to `server.env` (git-ignored) |
| `.env.example` | `TUNNEL_TOKEN` → copy to `.env` (git-ignored) |
| `backup.sh` | Daily consistent SQLite backup of `data/orders.db` (keeps 14 days) |
