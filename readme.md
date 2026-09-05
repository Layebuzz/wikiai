# WikiAI v2 — The Most Comprehensive AI Library

AI tools, **MCP servers**, and **agent skills** — one searchable, open catalog.
Live at **https://wikiai.layebuzz.workers.dev** · Source: [github.com/Layebuzz/wikiai](https://github.com/Layebuzz/wikiai)

## Catalog

| Bank | File | Entries |
| --- | --- | --- |
| AI Tools | `data/tools.json` | 3,010 |
| MCP Servers | `data/mcps.json` | 87 (seed) |
| Agent Skills | `data/skills.json` | 58 (seed) |

Every bank is a plain JSON array — the site is a static front-end with **no build step** and **no database**. The JSON files are also the public API:

- `/api/tools.json`, `/api/mcps.json`, `/api/skills.json` (redirected to `/data/*.json`)

## Design system

The UI implements the **HeroUI theme model** ([heroui.com/en/themes](https://heroui.com/en/themes?fontFamily=public-sans)):

- **Type**: Public Sans (body + display), with IRANSansXV fallback for Persian text
- **Tokens**: semantic CSS variables — `--accent` (black in light mode, white in dark), `--surface`, `--separator`, `--foreground`, status colors — in `styles.css`
- **Shape**: 12px medium radius, pill tabs/chips, soft elevation shadows
- **Themes**: light + dark (`data-theme="dark"`), persisted, respects OS preference

## Stack

Vanilla JS + custom CSS (zero dependencies). Deployed to **Cloudflare Workers** as static assets.

## Local development

```bash
node scripts/serve.mjs 8899   # static server (no deps)
npm run dev                   # or wrangler dev (local Workers preview)
```

## Deploy

```bash
npm install            # installs wrangler
npx wrangler login     # one-time auth
npm run deploy         # deploys to wikiai.layebuzz.workers.dev
```

Config: `wrangler.toml` (worker name `wikiai`, static assets), `_headers`, `_redirects`.

## Adding entries

The admin panel (`/admin/`, password-protected) lets you browse and add entries locally — including a **Search GitHub** tool that finds MCP/AI repositories and adds them to the current bank — then **Export JSON** and commit it to the matching `data/*.json` file. Open a PR or push and redeploy.

Note: the admin password is checked client-side (SHA-256) since the site is fully static; anyone with repo access can read `admin/admin.js`. For a hard gate, add a Worker that checks a secret server-side.

## Roadmap to "most comprehensive"

- **Crawlers**: port the v1 Netlify cron (Aixploria) to a Cloudflare Cron Trigger writing to KV, plus feeds from the official MCP registry, Smithery, and PulseMCP (see `cron-worker/` plan)
- **Models bank**: a 4th tab for foundation models (context windows, pricing per token)
- **Collections**: user-curated lists, e.g. "RAG stack", "coding agents"
- **Compare**: side-by-side comparison of tools/MCPs/skills

## License

MIT. Data is crowd-curated from public sources; verify before relying on it.