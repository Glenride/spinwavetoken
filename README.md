# SpinWave — Teaser Site

Prelaunch teaser site for **$SPIN**, the utility token of the Glenride scholarly manuscript & data repository.

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
