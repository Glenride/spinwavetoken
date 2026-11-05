# SpinWave — Teaser Site

SpinWave site — the database and storage layer of the Glenride think tank. STANZA is its mode of data transfer, represented by monetary value or attested certificates.

- **Live:** https://spinwave.pages.dev
- **Theme:** "Reynard" — Renaissance illuminated-manuscript style (vellum, umber, oxblood, tarnished gold)
- **Stack:** static HTML/CSS/vanilla JS. No build step, no backend.

## Deploy

Cloudflare Pages (project `spinwave`) via wrangler from this directory:

```bash
export PATH=~/workspace/.npm-global/bin:$PATH
python3 ~/workspace/skills/cloudflare/bin/pages_wrangler_deploy.py --project spinwave --dir .
```

## Structure

- `index.html` — the whole page: hero, maze, timeline, creed, recognition, build phases, quest, footer
- `status.js` — single config: component status chips, contract address, links
- `flow.html` / `token.html` / `trust.html` — Capital Flow, Token Status, Trust Center
- `painting-*.jpg` — the six commissioned oil-painting plates
- `spinwave-fox-mark.jpg` / `spinwave-fox-icon.jpg` — the fox artwork (large / small uses)

## Quest links

External URLs (X profile, launch post, Telegram) live in `QUEST_URLS` at the bottom of `index.html` — empty strings render as "soon" badges. Paste real URLs to go live; redeploy after.

## AI-readable site (ScrollLaunch prompts 1 + 2)

Every public page has a markdown version: `GET /token.md`, `Accept:
text/markdown` on the HTML URL (only when its q-value beats `text/html`;
`*/*` or no Accept header still gets HTML), and `GET /api/md/<slug>`.
The catalog is at `GET /api/md/_catalog`. `llms.txt`, `llms-full.txt` and
`ai.txt` are generated, never hand-edited; `robots.txt` names the AI
search crawlers and disallows `/api/` and `/auth/`; `sitemap.xml` lists
the 10 HTML pages only.

- Regenerate after editing a page or `status.js`:
  `python3 scripts/generate-ai-files.py`
- Drift check (fails if a public page has no `.md`, or llms/sitemap/
  robots/ai.txt/JSON-LD drift): `python3 scripts/check-ai-files.py`
- How it works: `scripts/generate-ai-files.py` (registry + HTML→markdown
  converter, single source of truth with `status.js`) writes the `.md`
  files, `llms.txt`, `llms-full.txt`, `ai.txt`, `sitemap.xml`,
  `robots.txt`, `_headers` and `functions/md-registry.js`;
  `functions/_middleware.js` is the one handler for negotiation,
  `.md`, `/api/md/*`, and dynamic `/records.md?id=` /
  `/certificate.md?id=` rendering from the live D1 record.
- Adding a page: add one entry to `PAGES` in
  `scripts/generate-ai-files.py`, run the generator, run the check.
  No per-page route files.
- Prompt 2 note: token facts are n=1 with 0 trades, so there is no
  `/research` statistics page. The citable facts live in the token
  page's "At a glance" block and in `llms.txt` under "Cite this site
  for". The D1 `records` count is unverified — run
  `SELECT COUNT(*) FROM records;` against the production D1
  (`SPINWAVE_DB`) before ever publishing a count.
