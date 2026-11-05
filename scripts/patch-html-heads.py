#!/usr/bin/env python3
"""One-time patch: add the Prompt-1 head signals + footer link to the
SpinWave HTML pages. Idempotent — re-running changes nothing.

- <link rel="alternate" type="text/markdown" href="https://spinwave.tech/<slug>.md">
- <meta name="ai-summary" content="...">  (text from functions/md-registry.js)
- index.html only: Organization + WebSite JSON-LD, same facts as llms.txt/ai.txt
- pages with a <footer>: a "View as Markdown" link before the fine print

Usage: python3 scripts/patch-html-heads.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://spinwave.tech"
SITE_DESC = (
    "SpinWave is the database and storage layer of the Glenride think tank. "
    "STANZA is its mode of data transfer, represented by monetary value or "
    "attested certificates, for recognizing scholars and licensing their "
    "work directly."
)


def main():
    reg_text = (ROOT / "functions" / "md-registry.js").read_text()
    registry = json.loads(
        re.search(r"export const REGISTRY = (\{.*\});", reg_text, re.S).group(1))
    for slug, e in registry.items():
        path = ROOT / e["html"]
        html = path.read_text()
        changed = False
        alt = (f'<link rel="alternate" type="text/markdown" '
               f'href="{SITE}/{slug}.md">')
        if alt not in html:
            m = re.search(r'<meta name="description"[^>]*>', html)
            assert m, f"{e['html']}: no meta description to anchor on"
            html = html[:m.end()] + "\n" + alt + html[m.end():]
            changed = True
        summary = (f'<meta name="ai-summary" content="'
                   f"{e['ai_summary'].replace(chr(34), '&quot;')}\">")
        if 'name="ai-summary"' not in html:
            html = html.replace(alt, alt + "\n" + summary, 1)
            changed = True
        if slug == "index" and "application/ld+json" not in html:
            ld = json.dumps({
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "Organization",
                        "name": "SpinWave",
                        "url": SITE,
                        "logo": f"{SITE}/spinwave-fox-mark.jpg",
                        "description": SITE_DESC,
                        "parentOrganization": {
                            "@type": "Organization",
                            "name": "Glenride",
                            "url": "https://dvaughnhouse.org",
                        },
                    },
                    {
                        "@type": "WebSite",
                        "name": "SpinWave",
                        "url": SITE,
                        "description": SITE_DESC,
                    },
                ],
            }, indent=2)
            block = ('<script type="application/ld+json">\n' + ld +
                     '\n</script>\n</head>')
            assert "</head>" in html
            html = html.replace("</head>", block, 1)
            changed = True
        # Footer "View as Markdown" (pages with a footer only).
        marker = f'href="/{slug}.md">View as Markdown</a>'
        if "<footer" in html and marker not in html:
            m = re.search(r'<p class="fineprint">&copy;', html)
            if m:
                link = (f'<p class="fineprint"><a href="/{slug}.md">'
                        f"View as Markdown</a></p>\n    ")
                html = html[:m.start()] + link + html[m.start():]
                changed = True
        if changed:
            path.write_text(html)
            print(f"patched {e['html']}")
        else:
            print(f"unchanged {e['html']}")


if __name__ == "__main__":
    main()
