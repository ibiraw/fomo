@AGENTS.md

# frontend/website/

limit showcase site (Mono theme). Next.js 16 static export.

| Path | Purpose |
|------|---------|
| `app/` | layout (splash, share metadata), page, `opengraph-image.tsx` (preview image), `icon.svg` |
| `app/privacy/`, `app/policies/` | Privacy policy; policies (terms, subscription & payments, refunds, risk). Both use `components/site/PolicyBlock.tsx` |
| `components/site/` | Sections (hero, features, how it works, FAQ), GetStarted (#pricing: 3 free orders + $50/30 days; #get: zip download `/limit.zip`, store "coming soon", 8 setup steps), BeforeAfter (#compare, under the hero), Walkthrough, TryIt, Themes, Splash, `use-loop-clock.ts` (shared rAF loop) |
| `lib/releases.ts`, `components/site/WhatsNew.tsx` | `SITE_VERSION` (public version; sections for later features show only once it reaches them — themes 1.2, X post 1.7) and the "What's new" changelog (#updates) |
| `lib/` | `before-after.ts` (fomo vs fomo + limit timeline), `demo.ts` (walkthrough timeline), `order-kind.ts`, `themes.ts` (mirror of extension themes — keep in sync) |
| `single/`, `vite.single.config.ts` | Single-file build of the same components (for Claude artifact publishing) |

## Builds
- `npm run build` → `out/` (static site for Cloudflare Pages / Netlify). Set `NEXT_PUBLIC_SITE_URL` so link previews use absolute URLs.
- `npm run build:artifact` → `dist-artifact/limit.html`, published at https://claude.ai/artifact/XrG5aLS3R9aYvhtwuQ1FJ7
- Next's runtime only hydrates at the site root, which is why the artifact uses the Vite single-file build instead.
