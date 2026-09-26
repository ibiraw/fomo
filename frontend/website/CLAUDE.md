@AGENTS.md

# frontend/website/

auto fomo showcase site (Mono theme). Next.js 16 static export.

| Path | Purpose |
|------|---------|
| `app/` | layout (splash, share metadata), page, `opengraph-image.tsx` (preview image), `icon.svg` |
| `components/site/` | Sections (hero, features, how it works, holders, FAQ), Walkthrough, TryIt, Themes, Splash |
| `lib/` | `demo.ts` (walkthrough timeline), `order-kind.ts`, `themes.ts` (mirror of extension themes — keep in sync) |
| `single/`, `vite.single.config.ts` | Single-file build of the same components (for Claude artifact publishing) |

## Builds
- `npm run build` → `out/` (static site for Cloudflare Pages / Netlify). Set `NEXT_PUBLIC_SITE_URL` so link previews use absolute URLs.
- `npm run build:artifact` → `dist-artifact/autofomo.html`, published at https://claude.ai/artifact/XrG5aLS3R9aYvhtwuQ1FJ7
- Next's runtime only hydrates at the site root, which is why the artifact uses the Vite single-file build instead.
