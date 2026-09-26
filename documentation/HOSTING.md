# Hosting the limit site (Cloudflare Pages)

Author: Reborn1987

Goal: a public link that doesn't trace back to you.

## 1. Anonymous account
1. Create a new email address used only for this project (e.g. Proton Mail).
2. Sign up at https://dash.cloudflare.com/sign-up with that email. Don't use your name.

## 2. Build
```bash
cd frontend/website
NEXT_PUBLIC_SITE_URL=https://limit.pages.dev npm run build   # use the project name you pick in step 3
```
This creates the `out/` folder (the whole site).

## 3. Upload (no Git needed)
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Project name: e.g. `limit` → your site will be `https://limit.pages.dev`.
3. Drag the **contents of `out/`** into the upload box → **Deploy**.

## 4. Updating later
Rebuild, then in the project → **Create deployment** → upload `out/` again.

## Notes
- Don't connect the GitHub repo (`ibiraw/fomo`) — that would link the site to your GitHub name.
- If you rename the project, rebuild with the new `NEXT_PUBLIC_SITE_URL` so link previews point to the right address.
- Check the link preview after deploying: paste the URL in a private Discord/Telegram chat.
