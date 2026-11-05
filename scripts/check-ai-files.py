#!/usr/bin/env python3
"""Drift check for the SpinWave AI-readable surface.

Fails (exit 1) when any public HTML page has no markdown renderer, when
llms.txt / llms-full.txt / sitemap.xml / robots.txt / ai.txt drift from the
registry, or when a page is missing its <link rel=alternate> / ai-summary.
Run:  python3 scripts/check-ai-files.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://spinwave.tech"
failures = []


def fail(msg):
    failures.append(msg)
    print(f"FAIL: {msg}")


def main():
    reg_text = (ROOT / "functions" / "md-registry.js").read_text()
    m = re.search(r"export const REGISTRY = (\{.*\});", reg_text, re.S)
    registry = json.loads(m.group(1))
    html_files = sorted(p.name for p in ROOT.glob("*.html"))
    reg_html = sorted(e["html"] for e in registry.values())
    if html_files != reg_html:
        fail(f"HTML pages without/without registry: files={html_files} "
             f"registry={reg_html}")

    llms = (ROOT / "llms.txt").read_text()
    full = (ROOT / "llms-full.txt").read_text()
    sitemap = (ROOT / "sitemap.xml").read_text()
    robots = (ROOT / "robots.txt").read_text()
    ai = (ROOT / "ai.txt").read_text()
    headers = (ROOT / "_headers").read_text()

    for slug, e in registry.items():
        md_path = ROOT / f"{slug}.md"
        if not md_path.exists():
            fail(f"missing {slug}.md")
            continue
        md = md_path.read_text()
        if not md.startswith(f"# {e['title']}"):
            fail(f"{slug}.md does not start with its page title")
        if f"Canonical: {e['canonical']}" not in md:
            fail(f"{slug}.md canonical mismatch")
        if f"Last updated: {e['lastmod']}" not in md:
            fail(f"{slug}.md lastmod mismatch (registry {e['lastmod']})")
        if f"{SITE}/{slug}.md" not in llms:
            fail(f"llms.txt missing {slug}.md link")
        if f"<!-- source: {e['canonical']} -->" not in full:
            fail(f"llms-full.txt missing source {e['canonical']}")
        if f"<loc>{e['canonical']}</loc>" not in sitemap:
            fail(f"sitemap.xml missing {e['canonical']}")
        if f"<lastmod>{e['lastmod']}</lastmod>" not in sitemap:
            fail(f"sitemap.xml lastmod mismatch for {e['canonical']}")
        html = (ROOT / e["html"]).read_text()
        alt = (f'<link rel="alternate" type="text/markdown" '
               f'href="{SITE}/{slug}.md">')
        if alt not in html:
            fail(f"{e['html']} missing markdown alternate link")
        if 'name="ai-summary"' not in html:
            fail(f"{e['html']} missing ai-summary meta")
        if e["ai_summary"] not in html:
            fail(f"{e['html']} ai-summary text does not match registry")

    if ".md" in sitemap:
        fail("sitemap.xml must not list .md URLs")
    for bot in ("OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot",
                "Claude-User", "PerplexityBot", "Perplexity-User"):
        if bot not in robots:
            fail(f"robots.txt does not name {bot}")
    for line in ("Disallow: /api/", "Disallow: /auth/",
                 f"Sitemap: {SITE}/sitemap.xml"):
        if line not in robots:
            fail(f"robots.txt missing '{line}'")
    for bot in ("GPTBot", "ClaudeBot", "Google-Extended",
                "Applebot-Extended", "CCBot", "Bytespider"):
        if re.search(rf"^User-agent: {bot}$", robots, re.M):
            fail(f"robots.txt newly allows training crawler {bot} "
                 "(needs an explicit decision)")
    if "name: SpinWave" not in ai or f"url: {SITE}" not in ai:
        fail("ai.txt identity does not match llms.txt")
    if llms.split("\n")[0] != "# SpinWave":
        fail("llms.txt must start with '# SpinWave'")
    if "SpinWave is the database and storage layer" not in llms:
        fail("llms.txt description drifted from site description")
    if "/*" not in headers and "/*.md" not in headers:
        fail("_headers missing .md section")

    index = (ROOT / "index.html").read_text()
    ld = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', index, re.S)
    if not ld:
        fail("index.html missing JSON-LD")
    else:
        try:
            data = json.loads(ld[0])
            graph = data.get("@graph", [data])
            types = {g.get("@type") for g in graph}
            if not {"Organization", "WebSite"} <= types:
                fail(f"index.html JSON-LD lacks Organization/WebSite: {types}")
            org = next(g for g in graph if g.get("@type") == "Organization")
            if org.get("url") != SITE or org.get("name") != "SpinWave":
                fail("index.html JSON-LD Organization identity mismatch")
        except Exception as exc:  # noqa: BLE001
            fail(f"index.html JSON-LD is not valid JSON: {exc}")

    # Token facts must match status.js exactly wherever they are repeated.
    status = (ROOT / "status.js").read_text()
    contract = re.search(r'contract: "([^"]+)"', status).group(1)
    token_md = (ROOT / "token.md").read_text()
    if contract not in token_md or contract not in llms:
        fail("STANZA contract from status.js missing from token.md/llms.txt")
    if "100,000,000,000" not in token_md:
        fail("token.md missing the 100B supply from status.js")
    if "no trade has ever executed" not in token_md.lower():
        fail("token.md must state plainly that no trade has ever executed")

    if not (ROOT / "functions" / "_middleware.js").exists():
        fail("functions/_middleware.js missing")
    if "text/markdown" not in (ROOT / "functions" / "_middleware.js").read_text():
        fail("middleware does not handle text/markdown")

    if failures:
        print(f"\n{len(failures)} check(s) failed.")
        return 1
    print(f"OK: {len(registry)} pages, llms/sitemap/robots/ai.txt/JSON-LD "
          "all in sync.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
