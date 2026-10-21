# REPAIR BRIEF — spinwave.tech (Impeccable pass #2 of the redesign program, 2026-10-21)

Mode: Persuade. World: **SpinWave's own — DO NOT Glenride it.** Committed identity, extracted from
the live page: Cormorant Garamond + EB Garamond serif, parchment #EDE4D0, olive #5C6B3C, gold #A8894A,
ink-brown text tones. Reynard paintings stay. Copy stays (flag em-dash count in your report; do not rewrite copy).
Working tree only — no commit, no push, no deploy. Pages in scope: index.html, flow.html, how.html,
letter.html, privacy.html.

## Detector baseline (live index.html, 2026-10-21): 16 findings
cramped-padding ×6 · wide-tracking ×4 · low-contrast ×3 · marquee ×1 · repeating-stripes-gradient ×1 · em-dash-overuse ×1 (advisory)

## Fixes (target: zero unexplained findings on every page)
1. **Padding rhythm:** wherever the detector flags cramped padding, increase to a consistent
   spacing scale (min 1rem inline padding on text containers, more on cards/sections). Same fix
   pattern on sibling pages even where the detector can't see it (shared CSS/markup habits).
2. **Tracking:** letter-spacing back to readable — display caps may keep a whisper (≤0.08em);
   body and label text to ≤0.02em or normal. Kill the flagged wide-tracking instances.
3. **Contrast to AA:** compute the actual pairs behind the 3 low-contrast findings and fix by
   darkening the foreground within the same hue family (olive → deeper olive, gold → bronze
   #8A6D2F-class for text use; gold stays as-is for large display/borders only). Report every
   pair and ratio you ship.
4. **Marquee: remove.** Replace the scrolling strip with a static row/line in the same visual
   voice (or delete the element if the content duplicates what's adjacent). No CSS-animation
   text crawls anywhere on the site.
5. **Repeating-stripes gradient: remove.** Use flat parchment/paper-deep tone or a hairline rule instead.
6. **No purple anywhere** (standing absolute). No gradients as decoration; if a gradient is
   load-bearing for a painting treatment, flag it in the report instead of silently keeping it.

## Verification (all required)
- Detector on each of the 5 pages → zero unexplained findings (em-dash advisory may remain, counted).
- Contrast pairs computed and listed.
- All paintings, links, QR, and page structure intact; pages still valid standalone HTML.
- Report: per-page findings before/after, files changed, pairs/ratios, anything you could not fix and why.
