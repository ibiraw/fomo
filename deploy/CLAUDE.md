# deploy/

Hosting for the shared limit server. Full steps: `documentation/DEPLOY.md`.

| File | Purpose |
|------|---------|
| `docker-compose.yml` | `server` (built from `backend/Dockerfile`, data in `./data`) + `tunnel` (Cloudflare Tunnel; no published ports) |
| `server.env.example` | RPC URLs etc. → copy to `server.env` (git-ignored) |
| `.env.example` | `TUNNEL_TOKEN` → copy to `.env` (git-ignored) |
